/**
 * B 站（哔哩哔哩）音源适配器 —— 「MV」渠道。
 *
 * 定位：**只用于搜索视频并播放其音频**。B 站是 DASH 音视频分轨，取 `dash.audio` 即可，
 * 无需解析视频。它不是可浏览音源，故不在 `MUSIC_SOURCES` 中（见 shared/types 的 `MV_SOURCES`）；
 * `playlistTracks` / 发现类能力一律不实现（路由回 501）。
 *
 * 反爬要点（2026-10 实测）：
 * - 搜索走 `x/web-interface/search/all/v2`（**未被风控**；`x/web-interface/wbi/search/type`
 *   会回 `v_voucher` 人机验证，弃用）；
 * - 取音频：`x/player/pagelist?bvid=` 取 cid → `x/player/playurl?...&fnval=16` 取 `dash.audio`；
 * - 音频直链（`*.bilivideo.*` / `*.mcdn.bilivideo.cn`）取字节**必须带 `Referer: https://www.bilibili.com`**；
 * - 匿名即可拿到 `dash.audio`（实测最高 ~204kbps）；带 SESSDATA（登录后）可提升码率与稳定性。
 */
import QRCode from 'qrcode'
import {
  DEFAULT_AUDIO_LEVEL,
  type Album,
  type AudioLevel,
  type LoginStatus,
  type Lyric,
  type Track,
} from '@pterosaur/shared/types'
import type { QrCheckResult, SourceAdapter } from './types.js'

/** 浏览器 UA（B 站对非浏览器 UA 较敏感）。 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 调接口 / 取字节必需的上游来源页（否则直链 403）。 */
const REFERER = 'https://www.bilibili.com'

/** B 站图片固定镜像主机（i0–iN.hdslb.com 互为镜像，规范化以免缓存碎片，类比 ADR-020）。 */
const BILI_IMAGE_HOST = 'i0.hdslb.com'

/**
 * 会话必需 cookie 名单：登录态透传与登出清理**共用同一份**——
 * 若登出漏清任一项，残留项会让后端 `cookieOf` 返回非空、绕开缺省凭证（见 app.ts `credentialOf`）。
 */
export const BILIBILI_SESSION_COOKIE_NAMES = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'buvid3',
  'bili_ticket',
] as const

/* ============================ 基础请求 ============================ */

interface BiliResponse<T> {
  code: number
  message?: string
  data?: T
}

/**
 * 解析失败自动重试：只要**任何**一次请求失败（网络错误 / 非 2xx / 上游非 0 业务码）就按固定
 * 333ms 间隔重试，**与具体错误码无关**——以免把「播放出错，请检查网络后重试」这类失败透给用户。
 */
const MAX_RETRIES = 5
const RETRY_DELAY_MS = 333

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 带重试的 GET。
 *
 * 网络错误 / 非 2xx / `code !== 0` **一律重试**（不区分具体错误码），最多 {@link MAX_RETRIES} 次；
 * 仍失败则抛出，由各调用点降级（`parts`/`songUrl` 返空、`searchSongs` 交由路由回 502）。
 */
async function bGet<T>(url: string, cookie?: string): Promise<BiliResponse<T>> {
  let lastErr: Error = new Error('bilibili 请求失败')
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: REFERER,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as BiliResponse<T>
      if (json.code !== 0) {
        lastErr = new Error(`bilibili code ${json.code}`)
        continue
      }
      return json
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr
}

/** 进程内缓存 buvid3（匿名反爬标识，实测 6h 内有效），避免每个请求都去取。 */
let buvidCache: { value: string; at: number } | null = null
async function buvid3(): Promise<string | undefined> {
  if (buvidCache && Date.now() - buvidCache.at < 6 * 3600_000)
    return buvidCache.value
  try {
    const res = await bGet<{ b_3?: string }>(
      'https://api.bilibili.com/x/frontend/finger/spi',
    )
    const v = res.data?.b_3
    if (v) {
      buvidCache = { value: v, at: Date.now() }
      return v
    }
  } catch {
    /* 取不到不阻断：多数接口匿名也能用 */
  }
  return buvidCache?.value
}

/** 在访客凭证基础上补一个 buvid3。 */
async function cookieWithBuvid(cred?: string): Promise<string | undefined> {
  const b = await buvid3()
  const parts = [cred, b ? `buvid3=${b}` : undefined].filter(Boolean)
  return parts.length ? parts.join('; ') : undefined
}

/* ============================ 归一化（导出供单测） ============================ */

/** B 站返回的视频条目（部分字段）。 */
export interface RawVideo {
  bvid?: string
  aid?: number
  title?: string
  author?: string
  pic?: string
  /** 形如 `"222:28"` 或 `"12:34"`。 */
  duration?: string
}

/** 去掉搜索结果标题里的 `<em>` 高亮标签并解码常见 HTML 实体。 */
export function decodeTitle(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** `"222:28"` / `"12:34"` → 秒；非法返回 0。 */
export function parseDuration(d?: string): number {
  if (!d) return 0
  const parts = d.split(':').map((x) => Number(x))
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** 封面/头像 URL：补 `https:` 并把 i0–iN 镜像主机规范化到固定主机。 */
export function canonicalBiliImage(url: string | undefined): string {
  if (!url) return ''
  const abs = url.startsWith('//') ? `https:${url}` : url
  try {
    const u = new URL(abs)
    u.protocol = 'https:'
    if (/^i\d+\.hdslb\.com$/.test(u.hostname)) u.hostname = BILI_IMAGE_HOST
    return u.href
  } catch {
    return ''
  }
}

/** 把 B 站视频条目归一化为共享 `Track`（`id` = bvid）。 */
export function normalizeBilibiliTrack(v: RawVideo): Track {
  return {
    source: 'bilibili',
    id: String(v.bvid ?? v.aid ?? ''),
    title: decodeTitle(v.title ?? '') || '未知视频',
    artist: v.author ?? '未知 UP 主',
    album: '',
    cover: canonicalBiliImage(v.pic),
    duration: parseDuration(v.duration),
    fee: 'free',
  }
}

/* ============================ 搜索 ============================ */

interface SearchAllData {
  result?: { result_type?: string; data?: RawVideo[] }[]
}

/**
 * 关键词搜索视频。
 *
 * 走 `search/all/v2`（实测未被风控），取其 `video` 分组。该接口对匿名请求即返回结果。
 * `page` 从 1 起（每页约 20 条），供前端滚动续取下一批。
 */
export async function searchSongs(
  keywords: string,
  limit = 30,
  cred?: string,
  page = 1,
): Promise<Track[]> {
  const cookie = await cookieWithBuvid(cred)
  const res = await bGet<SearchAllData>(
    `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(
      keywords,
    )}&page=${Math.max(1, page)}`,
    cookie,
  )
  const groups = res.data?.result ?? []
  const videos = groups.find((g) => g.result_type === 'video')?.data ?? []
  return videos.slice(0, limit).map(normalizeBilibiliTrack)
}

/* ============================ 取音频（DASH 分轨） ============================ */

/** 各抽象档位对应的目标码率（bps），用于从 `dash.audio[]` 里挑最接近的一条。 */
const LEVEL_TARGET_BPS: Record<AudioLevel, number> = {
  standard: 64_000,
  higher: 132_000,
  exhigh: 192_000,
  lossless: 1_000_000,
  hires: 2_000_000,
}

/** DASH 音频流条目（部分字段）。 */
export interface BiliAudio {
  baseUrl?: string
  backupUrl?: string[]
  bandwidth?: number
  id?: number
}

/** 从多档音频里挑与目标码率最接近的一条（并列取更高码率）。 */
export function pickAudio(
  audios: BiliAudio[],
  level: AudioLevel,
): BiliAudio | undefined {
  const target = LEVEL_TARGET_BPS[level]
  let best: BiliAudio | undefined
  for (const a of audios) {
    if (!best) {
      best = a
      continue
    }
    const bw = a.bandwidth ?? 0
    const bwBest = best.bandwidth ?? 0
    const d = Math.abs(bw - target)
    const dBest = Math.abs(bwBest - target)
    if (d < dBest || (d === dBest && bw > bwBest)) best = a
  }
  return best
}

/**
 * 候选 CDN 排序：**官方 upos 主 CDN（`*.bilivideo.com`）优先**，`mcdn` P2P 边缘节点殿后，并去重。
 *
 * B 站 `playurl` 返回的 `baseUrl` 实测**恒为 `*.mcdn.bilivideo.cn`**（P2P 边缘，用于给真实用户
 * 就近分发），对**数据中心 IP / 非浏览器客户端**极不稳（403 / 连接重置 / 中途 RST）；稳定的官方源
 * 藏在 `backupUrl[]` 里（`upos-sz-*.bilivideo.com`）。故按主机分档重排——取字节阶段再逐个回退，
 * 单节点故障便不会直接判死（否则表现为「概率性播放出错，再点一次就好」）。
 */
export function rankAudioUrls(urls: string[]): string[] {
  const score = (u: string): number => {
    let h: string
    try {
      h = new URL(u).hostname.toLowerCase()
    } catch {
      return 2
    }
    if (/(^|\.)mcdn\.bilivideo\.cn$/.test(h)) return 3 // P2P 边缘：最不稳，殿后
    if (h.endsWith('.bilivideo.com')) return 0 // 官方 upos 主 CDN：首选
    if (h.endsWith('.bilivideo.cn')) return 1 // 官方直连（非 mcdn）
    return 2 // 其它第三方边缘
  }
  return [...new Set(urls)].sort((a, b) => score(a) - score(b))
}

interface PlayurlData {
  dash?: { audio?: BiliAudio[] }
  durl?: { url?: string }[]
}

/**
 * 解析某视频的**音频**直链候选：`pagelist` 取 cid → `playurl(fnval=16)` 取 `dash.audio`，
 * 按档位挑一条，返回其 `baseUrl + backupUrl[]` 的**有序候选**（官方 upos 优先，见
 * {@link rankAudioUrls}），统一改写为 https。**只取音频、不解析视频**。
 *
 * 返回空数组即不可播放（交由路由回 403）。
 */
export async function songUrl(
  id: string,
  cred?: string,
  level: AudioLevel = DEFAULT_AUDIO_LEVEL,
): Promise<string[]> {
  try {
    // id 形如 `<bvid>`（整视频取首P）或 `<bvid>:<cid>`（分P 展开后的具体一页）
    const [bvid, cidRaw] = id.split(':')
    const cookie = await cookieWithBuvid(cred)
    let cid = cidRaw ? Number(cidRaw) : undefined
    if (!cid) {
      const pl = await bGet<{ cid?: number }[]>(
        `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
        cookie,
      )
      cid = pl.data?.[0]?.cid
    }
    if (!cid) return []

    const pu = await bGet<PlayurlData>(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(
        bvid,
      )}&cid=${cid}&fnval=16&fnver=0&fourk=1`,
      cookie,
    )
    const audios = pu.data?.dash?.audio ?? []
    const picked = pickAudio(audios, level)
    // DASH：取该档的 baseUrl + 全部 backupUrl；无 dash 时回落老格式 durl
    const candidates = picked
      ? [picked.baseUrl, ...(picked.backupUrl ?? [])]
      : (pu.data?.durl ?? []).map((d) => d.url)
    return rankAudioUrls(
      candidates
        .filter((u): u is string => typeof u === 'string' && u !== '')
        .map((u) => u.replace(/^http:/, 'https:')),
    )
  } catch {
    return []
  }
}

/** 音频 CDN 要求 `Referer`，否则 403。 */
export function streamHeaders(): Record<string, string> {
  return { Referer: REFERER }
}

/* ============================ 分P 展开 ============================ */

/** `x/web-interface/view` 返回的页（分P）结构（部分字段）。 */
interface RawPage {
  cid?: number
  page?: number
  part?: string
  duration?: number
}

/** `x/web-interface/view` 返回的视频结构（部分字段）。 */
export interface BiliViewData {
  bvid?: string
  title?: string
  pic?: string
  owner?: { name?: string }
  pages?: RawPage[]
}

/**
 * 把 `view` 响应归一化为分P 条目（**纯函数**，供单测）。
 *
 * 每项 `id` 为 **`<bvid>:<cid>`**：`songUrl` 据此直接定位到该分P，无需再查 cid。
 * 多P 时标题取分P 名（`P<n> · <part>`），单P 时取视频标题；封面统一为**视频封面**。
 */
export function buildParts(d: BiliViewData | undefined): Track[] {
  const pages = d?.pages ?? []
  const bvid = d?.bvid
  if (!bvid || !pages.length) return []
  const cover = canonicalBiliImage(d?.pic)
  const artist = d?.owner?.name ?? '未知 UP 主'
  const multi = pages.length > 1
  return pages.map((p) => ({
    source: 'bilibili' as const,
    id: `${bvid}:${p.cid ?? p.page ?? 0}`,
    title: multi
      ? `P${p.page ?? ''}${p.part ? ` · ${p.part}` : ''}`
      : (d?.title ?? '未知视频'),
    artist,
    album: '',
    cover,
    duration: p.duration ?? 0,
    fee: 'free' as const,
  }))
}

/**
 * 解析一个视频的**分P**（单P 视频只有一项）。
 *
 * 走 `x/web-interface/view?bvid=`——**一次请求**即含标题 / 封面 / UP 主与 `pages[]`
 * （每页的 `cid` / `page` / `part` / `duration`），故无需再单独请求 `pagelist`。
 */
export async function parts(id: string, cred?: string): Promise<Track[]> {
  try {
    const bvid = id.split(':')[0]
    const cookie = await cookieWithBuvid(cred)
    const res = await bGet<BiliViewData>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      cookie,
    )
    return buildParts(res.data)
  } catch {
    return []
  }
}

/* ============================ 登录（扫码） ============================ */

/**
 * 生成登录二维码。**返回二维码内容本身（登录 URL）作为 key**。
 *
 * 与网易云不同，B 站的 `key` 与 `url` 来自同一份 generate 响应、且后续 `poll` 只认
 * `qrcode_key`。故让「URL 即 key」：`qrCreate` 直接渲染它、`qrCheck` 从 URL 里解析出
 * `qrcode_key` 去轮询——全程无状态，无需服务端缓存。
 */
export async function qrKey(): Promise<string> {
  const res = await bGet<{ url?: string; qrcode_key?: string }>(
    'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  )
  return res.data?.url ?? ''
}

/**
 * 把二维码内容渲染为 base64 PNG data URI。
 *
 * `margin` 为**静区**（四周留白，单位＝模块数）：QR 规范要求 ≥4，且前端展示框是纯白底 +
 * `object-fit: contain`，留白完全来自图片本身——取 1 会让码几乎填满整框、又大又挤，故用 4。
 */
export async function qrCreate(key: string): Promise<string> {
  return QRCode.toDataURL(key, { margin: 4, width: 240 })
}

/** 二维码内容（登录 URL）——供 CLI 终端渲染。 */
export async function qrLoginUrl(key: string): Promise<string> {
  return key
}

/** 从 Set-Cookie 数组里挑出会话 cookie，收敛为可直接透传的字符串。 */
export function cookieHeaderFromSetCookies(
  cookies?: string[],
): string | undefined {
  if (!cookies?.length) return undefined
  const parts: string[] = []
  for (const c of cookies) {
    const kv = c.split(';')[0]?.trim()
    if (!kv) continue
    const name = kv.slice(0, kv.indexOf('='))
    if ((BILIBILI_SESSION_COOKIE_NAMES as readonly string[]).includes(name))
      parts.push(kv)
  }
  return parts.length ? parts.join('; ') : undefined
}

/** 从 URL 查询串里取**原始（未解码）**参数值——`SESSDATA` 含 `%2C`，解码会破坏其值。 */
export function rawQueryValue(url: string, name: string): string | undefined {
  const q = url.indexOf('?')
  if (q < 0) return undefined
  const hash = url.indexOf('#', q)
  const query = url.slice(q + 1, hash < 0 ? undefined : hash)
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=')
    if (eq > 0 && pair.slice(0, eq) === name) return pair.slice(eq + 1)
  }
  return undefined
}

/**
 * 汇总登录后的会话 cookie：优先取 poll 的 `Set-Cookie`，缺失的再从回跳 URL 的查询串补齐。
 *
 * ⚠️ URL 里的值必须**保持原始百分号编码、不可解码**：B 站 `SESSDATA` 本身含 `%2C`
 * （其 cookie 值就是带 `%2C` 的形态），解码成 `,` 会写出**非法且错误**的 cookie 值——
 * 浏览器按 RFC 6265 拒存（逗号非合法 cookie-value 字符），或即便存下 nav 也不认，
 * 表现为「登录成功但一刷新登录就掉」。
 */
export function collectLoginCookies(
  setCookies: string[],
  url?: string,
): string[] {
  const out = [...setCookies]
  const have = new Set(
    out.map((c) => c.slice(0, c.indexOf('='))).filter(Boolean),
  )
  if (url) {
    for (const name of BILIBILI_SESSION_COOKIE_NAMES) {
      if (have.has(name)) continue
      const raw = rawQueryValue(url, name)
      if (raw != null) out.push(`${name}=${raw}`)
    }
  }
  return out
}

/**
 * 轮询扫码状态。归一为与网易云一致的 code 语义：
 * `0`→803 成功、`86090`→802 已扫码待确认、`86038`→800 已失效、其它（`86101` 未扫码）→801。
 */
export async function qrCheck(key: string): Promise<QrCheckResult> {
  let qrcodeKey = key
  try {
    qrcodeKey = new URL(key).searchParams.get('qrcode_key') ?? key
  } catch {
    /* key 本身可能就是 qrcode_key */
  }
  const res = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(
      qrcodeKey,
    )}`,
    { headers: { 'User-Agent': UA, Referer: REFERER } },
  )
  const json = (await res.json()) as BiliResponse<{
    code?: number
    message?: string
    url?: string
  }>
  const inner = json.data?.code ?? -1
  const message = json.data?.message

  if (inner === 0) {
    const cookies = collectLoginCookies(
      res.headers.getSetCookie?.() ?? [],
      json.data?.url,
    )
    return { code: 803, cookies, message: message ?? '登录成功' }
  }
  const code = inner === 86090 ? 802 : inner === 86038 ? 800 : 801
  return { code, message }
}

/** 查询登录态。 */
export async function loginStatus(cred?: string): Promise<LoginStatus> {
  if (!cred) return { logged: false }
  try {
    const res = await bGet<{
      isLogin?: boolean
      uname?: string
      face?: string
      mid?: number
      vipStatus?: number
    }>('https://api.bilibili.com/x/web-interface/nav', cred)
    const d = res.data
    if (!d?.isLogin) return { logged: false }
    return {
      logged: true,
      nickname: d.uname,
      avatarUrl: d.face ? canonicalBiliImage(d.face) : undefined,
      userId: d.mid != null ? String(d.mid) : undefined,
      vip: Boolean(d.vipStatus),
    }
  } catch {
    return { logged: false }
  }
}

/* ============================ 适配器 ============================ */

/** MV 无专辑页，返回空壳以满足适配器必选面（前端不会走到）。 */
export async function albumDetail(
  id: string,
): Promise<{ album: Album; tracks: Track[] }> {
  return {
    album: { source: 'bilibili', id, name: '', cover: '', artist: '' },
    tracks: [],
  }
}

/** MV 无歌词，返回空歌词（前端显示「暂无歌词」）。 */
export async function getLyric(): Promise<Lyric> {
  return { lines: [], timed: false }
}

/** B 站（MV）音源适配器。 */
export const bilibiliAdapter: SourceAdapter = {
  id: 'bilibili',
  sessionCookieNames: BILIBILI_SESSION_COOKIE_NAMES,
  logoutCookieNames: BILIBILI_SESSION_COOKIE_NAMES,
  searchSongs,
  albumDetail,
  songUrl,
  getLyric,
  loginStatus,
  cookieHeaderFromSetCookies,
  streamHeaders,
  parts,
  qrKey,
  qrCreate,
  qrLoginUrl,
  qrCheck,
}
