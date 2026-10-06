/**
 * QQ 音乐音源适配器（**自研最小实现**）。
 *
 * 端点选择（尽量用无需签名的 `c.y.qq.com` 老接口，减小对 `sign` 的依赖）：
 * - 搜索   `client_search_cp`（无签名）
 * - 专辑   `fcg_v8_album_info_cp.fcg`（无签名）
 * - 歌词   `fcg_query_lyric_new.fcg`（无签名，`nobase64=1`）
 * - 取流   `musicu.fcg` 的 `vkey.GetVkeyServer`（**需 `sign`**）
 * - 登录   QQ PT 扫码（ptqrshow → ptqrlogin），成功后换取音乐 key
 *
 * ⚠️ **已知风险（实现期待实测）**：
 * - QQ 自 2024/2025 起把 `sign` 迁移到 JSVMP 虚拟机保护。本文件的 {@link qqSign} 是社区已知的
 *   **经典 `zzc` 算法**；若上游已对该接口强制 VMP 签名，取流会失败（返回 null → 前端「暂不可播放」）。
 * - 取流/登录可能强校验 `guid`、`Referer` 与频控；VIP 音质需登录态。
 * - 抖音——以上均需在**有网络的环境**用真实响应校准。
 */
import { createHash } from 'node:crypto'
import type { Album, Artist, LoginStatus, Lyric, Playlist, Track } from '@pterosaur/shared/types'
import { parseLrc } from '@pterosaur/shared/lyric'
import type { QrCheckResult, SourceAdapter } from './types.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const REFERER = 'https://y.qq.com/'

const ALBUM_API = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg'
const LYRIC_API = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
const PLAYLIST_API = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg'
const DISS_TAG_API = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg'
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const SONG_BASE = 'https://ws.stream.qqmusic.qq.com/'
const LOGIN_QR_SHOW = 'https://ssl.ptlogin2.qq.com/ptqrshow'
const LOGIN_QR_POLL = 'https://ssl.ptlogin2.qq.com/ptqrlogin'
/** QQ 音乐网页应用在 QQ 互联的 appid（公开常量）。 */
const APPID = '716027609'
const PT_3RD_AID = '100497308'
/** 每次启动随机一个 guid：vkey 请求与登录保持一致即可（QQ 仅做弱风控）。 */
const GUID = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000)

/** 会话必需 cookie 名单：下发与回传均只处理这几项。 */
export const QQ_SESSION_COOKIE_NAMES = [
  'uin',
  'qqmusic_uin',
  'qqmusic_key',
  'qm_keyst',
  'tmeLoginType',
  'qq_nick',
  'skey',
  'p_uin',
  'p_skey',
  'psrf_qqunionid',
  'psrf_qqopenid',
  'psrf_access_token_expiresAt',
  'psrf_musickey_createtime',
  'psrf_qqrefresh_token',
  'psrf_qqaccess_token',
  'wxuin',
  'wxskey',
] as const

/* ============================ 签名 ============================ */

/** 经典 `zzc` 签名的混淆常量（20 项）。 */
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
]
const PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]

/**
 * 计算 QQ 音乐接口签名（经典 `zzc` 算法）。
 *
 * 步骤：`SHA1(data)` 取大写 hex（40 位）→ 依索引取字符得 part1/part2 →
 * 20 字节摘要与 {@link SCRAMBLE_VALUES} 逐字节异或后 base64（去 `/+ =`）→ 拼 `zzc{part1}{b64}{part2}` 转小写。
 */
export function qqSign(data: string): string {
  const hex = createHash('sha1').update(data, 'utf8').digest('hex').toUpperCase()
  const part1 = PART_1_INDEXES.map((i) => hex[i]).join('')
  const part2 = PART_2_INDEXES.map((i) => hex[i]).join('')
  const bytes = Buffer.alloc(SCRAMBLE_VALUES.length)
  for (let k = 0; k < SCRAMBLE_VALUES.length; k++) {
    bytes[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16) ^ SCRAMBLE_VALUES[k]
  }
  const b64 = bytes.toString('base64').replace(/[/+=]/g, '')
  return `zzc${part1}${b64}${part2}`.toLowerCase()
}

/** ptqrtoken：`qrsig` 的 32 位滚动哈希（QQ PT 登录用）。 */
export function hash33(s: string): number {
  let e = 0
  for (let i = 0; i < s.length; i++) e += (e << 5) + s.charCodeAt(i)
  return 2147483647 & e
}

/* ============================ HTTP ============================ */

interface QqResponse {
  body: unknown
  /** 原始响应文本（诊断用）。 */
  text: string
  setCookies: string[]
}

/** 发一次请求，返回解析后的 JSON 与 Set-Cookie 数组。 */
async function qqFetch(
  url: string,
  opts: { cookie?: string; body?: string; method?: string; referer?: string } = {},
): Promise<QqResponse> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Referer: opts.referer ?? REFERER,
    Accept: 'application/json, text/plain, */*',
  }
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.body) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body,
  })
  const text = await res.text().catch(() => '')
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  // 开发期诊断：非 JSON 或上游报错时把原文打出来（生产不刷屏）
  if (process.env.NODE_ENV !== 'production' && (typeof body !== 'object' || body === null)) {
    console.warn(`[qq] 非 JSON 响应（HTTP ${res.status}）${url}\n  → ${text.slice(0, 500)}`)
  }
  return { body, text, setCookies: readSetCookies(res) }
}

/** 取出响应头的全部 Set-Cookie。 */
function readSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

/** 从 Set-Cookie 数组中提取某 cookie 的值。 */
export function readCookieValue(cookies: string[] | undefined, name: string): string | undefined {
  if (!cookies) return undefined
  for (const c of cookies) {
    const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    if (m) return m[1]
  }
  return undefined
}

/** 把 Set-Cookie 数组收敛为可直接透传给上游的 Cookie 请求头（仅白名单项）。 */
export function cookieHeaderFromSetCookies(cookies?: string[]): string | undefined {
  if (!cookies?.length) return undefined
  const parts: string[] = []
  for (const c of cookies) {
    const kv = c.split(';')[0]?.trim()
    if (!kv) continue
    const name = kv.slice(0, kv.indexOf('='))
    if ((QQ_SESSION_COOKIE_NAMES as readonly string[]).includes(name)) parts.push(kv)
  }
  return parts.length ? parts.join('; ') : undefined
}

/** 从请求 Cookie 串取 uin（vkey 请求需要）。 */
function uinOf(cookie?: string): string {
  if (!cookie) return '0'
  const m = cookie.match(/(?:^|;\s*)(?:qqmusic_uin|uin|p_uin|wxuin)=([^;]+)/)
  return m ? m[1] : '0'
}

/** 从请求 Cookie 串取 QQ 音乐会话钥匙（`qm_keyst`/`qqmusic_key`），供 `comm.authst`。 */
function musickeyOf(cookie?: string): string {
  if (!cookie) return ''
  const m = cookie.match(/(?:^|;\s*)(?:qqmusic_key|qm_keyst)=([^;]+)/)
  return m ? m[1] : ''
}

/** QQ 的 `g_tk`（由 `p_skey`/`skey` 派生的 32 位翻滚哈希）。 */
function gtkOf(skey: string): number {
  let h = 5381
  for (let i = 0; i < skey.length; i++) h += (h << 5) + skey.charCodeAt(i)
  return h & 0x7fffffff
}

/* ============================ 归一化 ============================ */

interface RawQqSinger {
  id?: number
  mid?: string
  name?: string
}

interface RawQqSong {
  songmid?: string
  mid?: string
  songname?: string
  name?: string
  singer?: RawQqSinger[]
  albummid?: string
  albumname?: string
  album?: { mid?: string; name?: string }
  interval?: number
  /** 版权：新式 `pay_play`/`pay_down`（搜索），老式 `payplay`/`paydownload`（专辑/歌单）。 */
  pay?: { payplay?: number; paydownload?: number; pay_play?: number; pay_down?: number }
}

/** QQ 封面：固定尺寸、稳定主机（`y.gtimg.cn`），便于以 URL 为键的缓存去重（对齐 ADR-020）。 */
export function canonicalQqImage(albumMid: string | undefined): string {
  if (!albumMid) return ''
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
}

/** 由 pay 字段推断版权标记（兼容新式 `pay_play` 与老式 `payplay`）。 */
function qqFeeOf(pay?: RawQqSong['pay']): Track['fee'] {
  if (!pay) return 'unknown'
  const p = pay.payplay ?? pay.pay_play ?? pay.paydownload ?? pay.pay_down
  if (p === 0) return 'free'
  if (p === 1 || p === 8) return 'vip'
  return 'unknown'
}

/** 将 QQ 原始曲目归一化为共享 Track。 */
export function normalizeQqTrack(raw: RawQqSong): Track {
  const mid = raw.songmid ?? raw.mid ?? ''
  const singers = (raw.singer ?? []).filter(Boolean)
  const albumMid = raw.albummid ?? raw.album?.mid ?? ''
  const artistRefs = singers
    .filter((s): s is RawQqSinger & { mid: string; name: string } => !!s?.mid && !!s?.name)
    .map((s) => ({ id: s.mid, name: s.name }))
  return {
    source: 'qq',
    id: mid,
    title: raw.songname ?? raw.name ?? '未知曲目',
    artist: singers.map((s) => s?.name).filter(Boolean).join(' / ') || '未知艺人',
    album: raw.albumname ?? raw.album?.name ?? '',
    cover: canonicalQqImage(albumMid),
    duration: raw.interval ?? 0,
    fee: qqFeeOf(raw.pay),
    artistRefs: artistRefs.length ? artistRefs : undefined,
    albumId: albumMid || undefined,
  }
}

/* ============================ 归一化（专辑 / 歌手 / 歌单） ============================ */

/** 松散读取：按候选键名取第一个非空值（QQ 各接口字段命名不统一，如 `albumMID`/`albumMid`/`albummid`）。 */
function pick<T = unknown>(obj: Record<string, unknown> | undefined, ...keys: string[]): T | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v as T
  }
  return undefined
}

/** 把 `http://` 图片地址改写为 https。 */
function https(url?: string): string {
  return url ? url.replace(/^http:\/\//, 'https://') : ''
}

/** 年份：接受 `pubTime`/`publicTime`（可能为 `YYYY-MM-DD` 或时间戳）。 */
function yearOf(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v)
  const y = /^(\d{4})/.exec(s)
  if (y) return Number(y[1])
  const n = Number(v)
  if (Number.isFinite(n) && n > 0) return new Date(n).getFullYear()
  return undefined
}

/** QQ 歌手头像（稳定主机 + 固定尺寸）。 */
export function canonicalQqSingerImage(singerMid: string | undefined): string {
  if (!singerMid) return ''
  return `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
}

/** 将 QQ 原始专辑归一化为共享 Album。 */
export function normalizeQqAlbum(raw: Record<string, unknown>): Album {
  const mid = pick<string>(raw, 'albumMID', 'albumMid', 'albummid', 'mid', 'album_mid') ?? ''
  return {
    source: 'qq',
    id: mid,
    name: pick<string>(raw, 'albumName', 'albumname', 'name') ?? '未命名专辑',
    cover: canonicalQqImage(mid),
    artist: pick<string>(raw, 'singerName', 'singername', 'singer_name') ?? '未知艺人',
    artistId: pick<string>(raw, 'singerMID', 'singerMid', 'singermid', 'singer_mid'),
    year: yearOf(pick(raw, 'pubTime', 'publicTime', 'publishTime')),
    trackCount: pick<number>(raw, 'songCount', 'song_count', 'total_song_num'),
  }
}

/** 将 QQ 原始歌手归一化为共享 Artist。 */
export function normalizeQqArtist(raw: Record<string, unknown>): Artist {
  const mid = pick<string>(raw, 'singerMID', 'singer_mid', 'singerMid', 'mid') ?? ''
  const alias = pick<string>(raw, 'otherName', 'other_name')
  return {
    source: 'qq',
    id: mid,
    name: pick<string>(raw, 'singerName', 'singer_name', 'name') ?? '未知艺人',
    avatar: canonicalQqSingerImage(mid),
    alias: alias ? [alias] : undefined,
    musicSize: pick<number>(raw, 'songNum', 'song_num'),
    albumSize: pick<number>(raw, 'albumNum', 'album_num'),
  }
}

/** 将 QQ 原始歌单归一化为共享 Playlist（搜索用 `imgurl`/`introduction`，详情用 `logo`/`desc`）。 */
export function normalizeQqPlaylist(raw: Record<string, unknown>): Playlist {
  const creator = raw.creator as Record<string, unknown> | undefined
  return {
    source: 'qq',
    // id 优先 `disstid`：详情接口（getcdinfo）里 `dissid` 是**错的**（如 9138127 而非 9138127385），
    // 搜索来源则只有 `dissid`（且为正确字符串）。
    id: String(pick(raw, 'disstid', 'dissid', 'dissId', 'disstid_str') ?? ''),
    name: pick<string>(raw, 'dissname', 'dissName', 'title') ?? '未命名歌单',
    cover: https(pick<string>(raw, 'imgurl', 'logo', 'picUrl', 'cover', 'diss_cover')),
    description: pick<string>(raw, 'introduction', 'desc', 'description', 'diss_desc'),
    trackCount: pick<number>(raw, 'songnum', 'song_count', 'songCount'),
    playCount: pick<number>(raw, 'visitnum', 'listennum', 'listenCount', 'play_count', 'listen_num'),
    creator: pick<string>(raw, 'nickname') ?? pick<string>(creator, 'name', 'nick'),
  }
}

/** 歌手歌曲 / 歌单曲目条目可能包一层 `musicData`，统一取出内层歌曲对象。 */
function unwrapSong(item: unknown): RawQqSong {
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    if (obj.musicData && typeof obj.musicData === 'object') return obj.musicData as RawQqSong
    return obj as RawQqSong
  }
  return {}
}

/* ============================ 内容 ============================ */

/**
 * 搜索用 comm。`platform: 'h5'` **无需 sign**（实测：`c.y.qq.com/client_search_cp`
 * 已被阉割、返回空结果，须改用 `musicu.fcg` 的 `SearchCgiService`；h5 平台匿名可用）。
 */
const SEARCH_COMM = {
  uin: '0',
  format: 'json',
  inCharset: 'utf-8',
  outCharset: 'utf-8',
  notice: 0,
  platform: 'h5',
  needNewCode: 1,
  ct: 23,
  cv: 0,
}

/** 各搜索类型对应的 `search_type`（h5 实测：0=单曲、1=歌手、2=专辑、**3=歌单**）。 */
const SEARCH_TYPE: Record<'song' | 'singer' | 'album' | 'playlist', number> = {
  song: 0,
  singer: 1,
  album: 2,
  playlist: 3,
}

/**
 * 一次音乐搜索（`musicu.fcg` 的 `SearchCgiService.DoSearchForQQMusicDesktop`）。
 * 返回 `req_0.data.body`（含 `song`/`album`/`singer`/`playlist` 各 `{list}`，仅命中的那类非空）。
 */
async function qqSearchBody(
  keywords: string,
  type: keyof typeof SEARCH_TYPE,
  limit: number,
  cookie?: string,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify({
    comm: SEARCH_COMM,
    req_0: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: {
        remoteplace: 'txt.mqq.all',
        search_type: SEARCH_TYPE[type],
        query: keywords,
        page_num: 1,
        num_per_page: limit,
      },
    },
  })
  const url = `${MUSICU}?format=json&data=${encodeURIComponent(payload)}`
  const { body, text } = await qqFetch(url, { cookie })
  const out = (body as { req_0?: { data?: { body?: Record<string, unknown> } } })?.req_0?.data?.body ?? {}
  // 开发期诊断：所有 list 都空时打印原文（键名不符 / 上游变更 / 被风控）
  const anyList = Object.keys(out).some((k) => Array.isArray((out[k] as { list?: unknown[] })?.list))
  if (process.env.NODE_ENV !== 'production' && !anyList) {
    console.warn(`[qq] 搜索无结果（type=${type}）${url}\n  → ${text.slice(0, 400)}`)
  }
  return out
}

/** 取 `body[key].list`。 */
function listOf(body: Record<string, unknown>, key: string): unknown[] {
  return ((body[key] as { list?: unknown[] } | undefined)?.list ?? []) as unknown[]
}

/** 搜索单曲。 */
export async function searchSongs(keywords: string, limit = 30, cookie?: string): Promise<Track[]> {
  const body = await qqSearchBody(keywords, 'song', limit, cookie)
  return listOf(body, 'song').map((it) => normalizeQqTrack(it as RawQqSong))
}

/** 搜索专辑。 */
export async function searchAlbums(keywords: string, limit = 30, cookie?: string): Promise<Album[]> {
  const body = await qqSearchBody(keywords, 'album', limit, cookie)
  return listOf(body, 'album').map((it) => normalizeQqAlbum(it as Record<string, unknown>))
}

/** 搜索歌手。 */
export async function searchArtists(keywords: string, limit = 30, cookie?: string): Promise<Artist[]> {
  const body = await qqSearchBody(keywords, 'singer', limit, cookie)
  return listOf(body, 'singer').map((it) => normalizeQqArtist(it as Record<string, unknown>))
}

/** 搜索歌单（响应对应 `body.songlist.list`，非 `playlist`）。 */
export async function searchPlaylists(keywords: string, limit = 30, cookie?: string): Promise<Playlist[]> {
  const body = await qqSearchBody(keywords, 'playlist', limit, cookie)
  return listOf(body, 'songlist').map((it) => normalizeQqPlaylist(it as Record<string, unknown>))
}

/* ============================ 发现 ============================ */

/** 按分类/排序取歌单列表（`fcg_get_diss_by_tag`，免签，实测可用）。 */
async function qqPlaylistByTag(categoryId: number, sortId: number, limit: number, cookie?: string): Promise<Playlist[]> {
  const url =
    `${DISS_TAG_API}?categoryId=${categoryId}&sortId=${sortId}&sin=0&ein=${limit}` +
    `&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  const { body } = await qqFetch(url, { cookie })
  const list = (body as { data?: { list?: Record<string, unknown>[] } })?.data?.list ?? []
  return list.map(normalizeQqPlaylist)
}

/**
 * 「为你推荐」：QQ **无免登录的个性化推荐端点**（其推荐需登录/上下文），以**热门歌单**近似。
 * 前端不再为 QQ 标注「个性化」。
 */
export async function recommendPlaylists(limit = 12, cookie?: string): Promise<Playlist[]> {
  return qqPlaylistByTag(10000000, 5, limit, cookie)
}

/** 精品歌单：同接口换排序（`cat` 暂不细分，恒取「全部」分类）。 */
export async function topPlaylists(limit = 12, _cat = '全部', cookie?: string): Promise<Playlist[]> {
  return qqPlaylistByTag(10000000, 2, limit, cookie)
}

/** 专辑详情：档案 + 曲目（`fcg_v8_album_info_cp`，无签名，实测可用）。 */
export async function albumDetail(id: string, cookie?: string): Promise<{ album: Album; tracks: Track[] }> {
  const url = `${ALBUM_API}?albummid=${encodeURIComponent(id)}&format=json&inCharset=utf8&outCharset=utf-8`
  const { body } = await qqFetch(url, { cookie })
  const d = ((body as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
  const album: Album = {
    source: 'qq',
    id: pick<string>(d, 'mid', 'albumMID', 'albumMid') ?? id,
    name: pick<string>(d, 'name', 'albumName', 'albumname') ?? '未命名专辑',
    cover: canonicalQqImage(id),
    artist: pick<string>(d, 'singername', 'singerName', 'singer_name') ?? '未知艺人',
    artistId: pick<string>(d, 'singermid', 'singerMID', 'singerMid'),
    year: yearOf(pick(d, 'aDate', 'publicTime', 'pubTime')),
    trackCount:
      pick<number>(d, 'cur_song_num', 'song_count', 'songCount') ??
      (Array.isArray(d.list) ? (d.list as unknown[]).length : undefined),
  }
  const tracks = ((d.list as unknown[] | undefined) ?? []).map((it) => normalizeQqTrack(unwrapSong(it)))
  return { album, tracks }
}

/**
 * 歌手详情：档案 + 热门单曲 + 专辑。
 *
 * 实测 `music.musichallSinger.SingerInfoInter.GetSingerDetail` **恒返回 104400**（无法按 mid 取），
 * 故改为**按歌手名搜索**（`artist` 页跳转时携带名字 —— 见路由 `?name=`）：
 * 分别搜 歌手 / 单曲 / 专辑，再按 mid 过滤。名字缺失时退化为最小档案。
 */
export async function artistDetail(
  id: string,
  cookie?: string,
  name?: string,
): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }> {
  if (!name) {
    return { artist: { source: 'qq', id, name: id, avatar: canonicalQqSingerImage(id) }, tracks: [], albums: [] }
  }
  const [singers, songs, albums] = await Promise.all([
    searchArtists(name, 20, cookie),
    searchSongs(name, 60, cookie),
    searchAlbums(name, 40, cookie),
  ])
  const artist = singers.find((a) => a.id === id) ?? { source: 'qq', id, name, avatar: canonicalQqSingerImage(id) }
  const tracks = songs.filter((t) => (t.artistRefs ?? []).some((r) => r.id === id))
  const filteredAlbums = albums.filter((a) => a.artistId === id)
  return { artist, tracks, albums: filteredAlbums }
}

/** 歌单详情：档案 + 曲目（`fcg_ucc_getcdinfo`，无签名）。 */
export async function playlistTracks(id: string, cookie?: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
  const url =
    `${PLAYLIST_API}?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}` +
    `&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  const { body } = await qqFetch(url, { cookie })
  const cdlist = ((body as { cdlist?: Record<string, unknown>[] }).cdlist ?? []) as Record<string, unknown>[]
  const cd = cdlist[0] ?? {}
  const playlist = normalizeQqPlaylist(cd)
  const tracks = ((cd.songlist as unknown[] | undefined) ?? []).map((it) => normalizeQqTrack(unwrapSong(it)))
  return { playlist, tracks }
}

/** 歌词（可能 base64，`nobase64=1` 未生效时兜底解码）。 */
export async function getLyric(id: string, cookie?: string): Promise<Lyric> {
  try {
    const url = `${LYRIC_API}?songmid=${encodeURIComponent(id)}&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&platform=yqq`
    const { body } = await qqFetch(url, { cookie })
    const b = body as { lyric?: string; trans?: string } | null
    return parseLrc(decodeMaybeBase64(b?.lyric), decodeMaybeBase64(b?.trans))
  } catch {
    return { lines: [], timed: false }
  }
}

/** 若歌词是 base64（无 `[` 时间轴且符合 base64 字符集）则解码，否则原样返回。 */
function decodeMaybeBase64(s: unknown): string {
  if (typeof s !== 'string' || !s) return ''
  if (s.includes('[')) return s // 已是 LRC 文本
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) return s
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8')
    return decoded.includes('[') ? decoded : s
  } catch {
    return s
  }
}

/**
 * 解析曲目真实播放地址（`musicu.fcg` 的 `vkey.GetVkeyServer`）。
 *
 * **h5 平台无需 sign**（实测）。**不带 `filename`**：QQ 会按内部 `media_mid` 返回正确的文件——
 * 若自行拼 `M500<songmid>.mp3`，当 `songmid ≠ media_mid` 时会解析出**不存在的文件名（404）**，
 * 这正是「歌单/专辑里的歌点了放不出」的根因。付费曲匿名返回空 purl（→ null，前端提示登录）。
 *
 * 注：`level` 参数被忽略——QQ 的按档取流需 `media_mid`，当前统一取默认档（AAC/m4a）。
 */
export async function songUrl(id: string, cookie?: string): Promise<string | null> {
  try {
    const uin = uinOf(cookie)
    const authst = musickeyOf(cookie)
    const payload = JSON.stringify({
      comm: { ...SEARCH_COMM, uin, ...(authst ? { authst } : {}) },
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: { guid: GUID, songmid: [id], songtype: [0], uin, loginflag: 1, platform: '20' },
      },
    })
    const url = `${MUSICU}?format=json&data=${encodeURIComponent(payload)}`
    const { body } = await qqFetch(url, { cookie })
    const data = (body as { req_0?: { data?: { sip?: string[]; midurlinfo?: { purl?: string }[] } } })?.req_0?.data
    const purl = data?.midurlinfo?.[0]?.purl ?? ''
    if (!purl) return null
    const sip = (data?.sip ?? []).find((s) => s.includes('stream.qqmusic.qq.com')) ?? data?.sip?.[0] ?? SONG_BASE
    return `${sip}${purl}`.replace(/^http:\/\//, 'https://')
  } catch {
    return null
  }
}

/* ============================ 登录（QQ PT 扫码） ============================ */

/** qrKey → PNG 字节的临时缓存（ptqrshow 同时产出二维码图片与 qrsig）。 */
const pendingQr = new Map<string, Buffer>()

/**
 * 生成二维码：请求 ptqrshow 拿到 PNG 图片与 `qrsig`，返回 `qrsig` 作为不透明句柄。
 * 图片字节缓存在 {@link pendingQr}，由 {@link qrCreate} 取出。
 */
export async function qrKey(): Promise<string> {
  const url = `${LOGIN_QR_SHOW}?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=${PT_3RD_AID}`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://xui.ptlogin2.qq.com/' },
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const qrsig = readCookieValue(readSetCookies(res), 'qrsig')
  if (!qrsig) return ''
  pendingQr.set(qrsig, buf)
  return qrsig
}

/** 返回缓存的二维码 PNG（base64 data URI）。 */
export async function qrCreate(key: string): Promise<string> {
  const png = pendingQr.get(key)
  if (!png) return ''
  return `data:image/png;base64,${png.toString('base64')}`
}

/** 解析 `ptuiCB('0','0','<url>','0','<msg>','<nick>')`（第 6 参为昵称）。 */
function parsePtuiCB(text: string): { code: number; url: string; message: string; nick: string } {
  const m = text.match(/ptuiCB\(([^)]*)\)/)
  if (!m) return { code: -1, url: '', message: '', nick: '' }
  const args = m[1].split(',').map((a) => a.trim().replace(/^'|'$/g, ''))
  return { code: Number(args[0]), url: args[2] ?? '', message: args[4] ?? '', nick: args[5] ?? '' }
}

/** QQ 互联 OAuth 回跳地址（换取 code 用）。 */
const OAUTH_REDIRECT = 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F'

/** 由 Set-Cookie 数组拼一个请求 Cookie 头（登录多步之间手动携带 cookie）。 */
function cookieHeaderOf(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]?.trim()).filter(Boolean).join('; ')
}

/**
 * 轮询扫码状态，并把 QQ 状态码映射为网易云契约：
 * 0（成功）→803、67（已扫待确认）→802、66（未扫）→801、65（过期）→800。
 *
 * 成功后走**完整 5 步**换取 QQ 音乐会话钥匙（`musickey` → cookie `qm_keyst`/`qqmusic_key`）——
 * 这是解锁**会员曲**的关键，缺它即便“登录成功”也放不出 VIP：
 *   1. `ptqrshow`（{@link qrKey}）；2. `ptqrlogin`（本步，解析 uin/ptsigx）；
 *   3. `ssl.ptlogin2.graph.qq.com/check_sig` → `p_skey`；
 *   4. `graph.qq.com/oauth2.0/authorize` → `code`；
 *   5. `musicu.fcg` `QQConnectLogin.LoginServer.QQLogin` → `musickey`。
 */
export async function qrCheck(key: string): Promise<QrCheckResult> {
  const ptqrtoken = hash33(key)
  const ts = Date.now()
  const url =
    `${LOGIN_QR_POLL}?u1=${encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump')}` +
    `&ptqrtoken=${ptqrtoken}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${ts}` +
    `&js_ver=10233&js_type=1&login_sig=&pt_uistyle=40&aid=${APPID}&daid=383&pt_3rd_aid=${PT_3RD_AID}`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://xui.ptlogin2.qq.com/', Cookie: `qrsig=${key}` },
  })
  const text = await res.text().catch(() => '')
  const { code, url: redirect, message, nick } = parsePtuiCB(text)

  if (code === 65) return { code: 800, message: message || '二维码已过期' }
  if (code === 66) return { code: 801, message: message || '等待扫码' }
  if (code === 67) return { code: 802, message: message || '已扫码，请确认' }
  if (code !== 0 || !redirect) return { code: 801, message: message || '等待扫码' }

  // 收集 QQ PT cookie，并从回跳 URL 解析 uin / ptsigx（回跳可能被 HTML 转义，先还原 &amp;）
  const jar = [...readSetCookies(res)]
  const redir = redirect.replace(/&amp;/g, '&')
  const uinFromUrl = redir.match(/uin=([^&]+)/)?.[1] ?? ''
  const ptsigx = redir.match(/ptsigx=([^&]+)/)?.[1] ?? ''

  // 3) check_sig → p_skey
  let pSkey = ''
  try {
    const csUrl =
      `https://ssl.ptlogin2.graph.qq.com/check_sig?uin=${uinFromUrl}&ptsigx=${ptsigx}&service=ptqrlogin` +
      `&nodirect=0&s_url=${encodeURIComponent(OAUTH_REDIRECT)}&ptlang=2052&daid=383&pt_3rd_aid=${PT_3RD_AID}`
    const cs = await fetch(csUrl, {
      headers: { 'User-Agent': UA, Cookie: cookieHeaderOf(jar), Referer: 'https://xui.ptlogin2.qq.com/' },
    })
    const csCookies = readSetCookies(cs)
    jar.push(...csCookies)
    pSkey = readCookieValue(csCookies, 'p_skey') ?? readCookieValue(jar, 'p_skey') ?? ''
  } catch {
    /* 忽略：无 p_skey 则后续步骤多半失败，但仍返回已收集 cookie */
  }

  // 4) authorize → QQ OAuth code（从 302 Location 取）
  let oauthCode = ''
  try {
    const authUrl =
      `https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=${PT_3RD_AID}` +
      `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT)}&scope=all&g_tk=${gtkOf(pSkey)}&format=json`
    const auth = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeaderOf(jar),
        Referer: 'https://graph.qq.com/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    oauthCode = (auth.headers.get('location') ?? '').match(/[?&]code=([^&]+)/)?.[1] ?? ''
  } catch {
    /* 忽略 */
  }

  // 5) QQLogin → musickey
  let musickey = ''
  let musicid = ''
  try {
    const payload = JSON.stringify({
      comm: { uin: uinFromUrl, format: 'json', ct: 24, cv: 0 },
      req_0: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code: oauthCode } },
    })
    const r5 = await fetch(`${MUSICU}?format=json`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        Cookie: cookieHeaderOf(jar),
        'Content-Type': 'application/json',
      },
      body: payload,
    })
    const j = (await r5.json().catch(() => null)) as
      | { req_0?: { data?: Record<string, unknown> } }
      | null
    const d = j?.req_0?.data ?? {}
    musickey = (d.musickey ?? d.musicKey ?? '') as string
    // 注意：musicid 可能超过 JS 安全整数，优先用 str_musicid
    musicid = String(d.str_musicid ?? d.musicid ?? uinFromUrl)
  } catch {
    /* 忽略：拿不到 musickey 时仍返回会话，但会员曲多半仍不可播 */
  }

  // 组装下发给浏览器的会话 cookie（带 Max-Age → 持久化，与网易云一致；否则仅会话级、关浏览器即失）。
  // uin 依次回退：QQLogin 的 musicid → 回跳 URL → PT cookie，任一可得即视为可用会话。
  const finalUin =
    musicid || uinFromUrl || readCookieValue(jar, 'uin') || readCookieValue(jar, 'p_uin') || ''
  const AGE = 'Max-Age=15552000'
  const session = [...jar]
  if (finalUin) {
    session.push(`uin=${finalUin}; Path=/; ${AGE}`)
    session.push(`qqmusic_uin=${finalUin}; Path=/; ${AGE}`)
  }
  // 昵称来自 PT 登录回调（ptuiCB 第 6 参）——QQ 音乐无免登录的资料接口，故随会话 cookie 携带
  if (nick) session.push(`qq_nick=${encodeURIComponent(nick)}; Path=/; ${AGE}`)
  if (musickey) {
    session.push(`qqmusic_key=${musickey}; Path=/; ${AGE}`)
    session.push(`qm_keyst=${musickey}; Path=/; ${AGE}`)
  }
  session.push(`tmeLoginType=1; Path=/; ${AGE}`)

  const resultMessage = !finalUin
    ? '登录成功但未取到用户标识，会话无法保持'
    : musickey
      ? '登录成功'
      : '登录成功（未取到音乐钥匙，会员曲可能仍不可播）'
  if (process.env.NODE_ENV !== 'production' && (!finalUin || !musickey)) {
    console.warn(
      `[qq] 登录收尾诊断：uin=${finalUin || '(空)'} | musicid=${musicid || '(空)'} | uin(回跳)=${uinFromUrl || '(空)'} | ` +
        `musickey=${musickey ? '有' : '(空)'} | p_skey=${pSkey ? '有' : '(空)'} | oauth code=${oauthCode ? '有' : '(空)'}`,
    )
  }
  return { code: 803, cookies: session, message: resultMessage }
}

/**
 * 查询登录状态：有 uin 即视为已登录。
 *
 * 昵称取会话 cookie `qq_nick`（扫码时由 PT 回调携带，见 {@link qrCheck}），缺失则退化为 `QQ <uin>`；
 * 头像**按 QQ 号直接拼**（`q1.qlogo.cn` 免鉴权，实测 200）——QQ 无免登录的资料查询接口。
 */
export async function loginStatus(cookie?: string): Promise<LoginStatus> {
  const uin = cookie ? cookie.match(/(?:^|;\s*)(?:qqmusic_uin|uin|p_uin)=([^;]+)/)?.[1] : undefined
  if (!uin || uin === '0') return { logged: false }

  const rawNick = cookie?.match(/(?:^|;\s*)qq_nick=([^;]*)/)?.[1]
  let nickname = `QQ ${uin}`
  if (rawNick) {
    try {
      nickname = decodeURIComponent(rawNick) || nickname
    } catch {
      nickname = rawNick || nickname
    }
  }
  const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return { logged: true, nickname, avatarUrl, userId: uin, vip: Boolean(musickeyOf(cookie)) }
}

/* ============================ 适配器 ============================ */

/** 退出登录需清理的 QQ 会话 cookie。 */
export const QQ_LOGOUT_COOKIE_NAMES = ['uin', 'qqmusic_uin', 'qqmusic_key', 'qm_keyst', 'qq_nick'] as const

/** QQ 音乐音源适配器。 */
export const qqAdapter: SourceAdapter = {
  id: 'qq',
  sessionCookieNames: QQ_SESSION_COOKIE_NAMES,
  logoutCookieNames: QQ_LOGOUT_COOKIE_NAMES,
  searchSongs,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  recommendPlaylists,
  topPlaylists,
  albumDetail,
  artistDetail,
  playlistTracks,
  songUrl,
  getLyric,
  qrKey,
  qrCreate,
  qrCheck,
  loginStatus,
  cookieHeaderFromSetCookies,
  streamHeaders: () => ({ Referer: REFERER }),
}
