import { createRequire } from 'node:module'
import type { LoginStatus, Playlist, Track, Lyric } from '@pterosaur/shared/types'
import { parseLrc } from '@pterosaur/shared/lyric'

const require = createRequire(import.meta.url)

/**
 * NeteaseCloudMusicApi 以 CommonJS 导出，键名去掉前导斜杠（如 `cloudsearch`）。
 * 每个函数签名约为 `(query, cookie?) => Promise<{ status, body, cookie? }>`，
 * 但不同版本存在差异，这里用宽松的 `any` 承接并在使用处收敛。
 *
 * 返回的 `cookie` 字段是「原始 Set-Cookie 字符串数组」（如
 * `["MUSIC_U=...; Max-Age=...; Path=/;", "__csrf=...; ..."]`）。
 * 登录成功后我们把这些原样作为 `Set-Cookie` 头下发给浏览器，
 * 浏览器在后续请求自动回传，再透传给网易云即可维持会话。
 */
interface NcmResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  cookie?: string[]
  status?: number
}
type NcmFn = (query: Record<string, unknown>) => Promise<NcmResponse>
const api = require('NeteaseCloudMusicApi') as Record<string, NcmFn>

/**
 * 从 Set-Cookie 数组中提取指定 cookie 的值。
 * 用于在不透传原始头的场景（如判断登录态）读取 MUSIC_U。
 */
export function readCookieValue(cookies: string[] | undefined, name: string): string | undefined {
  if (!cookies) return undefined
  for (const c of cookies) {
    const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    if (m) return m[1]
  }
  return undefined
}

/** 会话必需的网易云 cookie 名单：下发与回传均只处理这几项，避免多余 Set-Cookie 撑大响应头。 */
export const SESSION_COOKIE_NAMES = ['MUSIC_U', '__csrf', 'MUSIC_A', 'NMTID']

/** 把登录相关 cookie（MUSIC_U / __csrf 等）收敛为可直接透传给网易云的字符串。 */
export function cookieHeaderFromSetCookies(cookies: string[] | undefined): string | undefined {
  if (!cookies?.length) return undefined
  const parts: string[] = []
  for (const c of cookies) {
    const kv = c.split(';')[0]?.trim()
    if (!kv) continue
    const name = kv.slice(0, kv.indexOf('='))
    if (SESSION_COOKIE_NAMES.includes(name)) parts.push(kv)
  }
  return parts.length ? parts.join('; ') : undefined
}

/** 网易云返回的原始曲目结构（部分字段）。 */
interface RawSong {
  id: number
  name: string
  fee?: number
  dt?: number
  duration?: number
  ar?: { name: string }[]
  artists?: { name: string }[]
  al?: { name?: string; picUrl?: string; blurPicUrl?: string }
  album?: { name?: string; picUrl?: string; blurPicUrl?: string }
}

/** 网易云返回的原始歌单结构（部分字段）。 */
interface RawPlaylist {
  id: number
  name: string
  picUrl?: string
  coverImgUrl?: string
  description?: string
  trackCount?: number
  playCount?: number
  creator?: { nickname?: string }
}

/** 把封面/图片地址统一改写为 https。 */
function https(url?: string): string {
  if (!url) return ''
  return url.replace(/^http:\/\//, 'https://')
}

/** 由 fee 推断版权标记。网易云：0 免费、1/4/8 等通常为 VIP 或付费。 */
function feeOf(fee?: number): Track['fee'] {
  if (fee === undefined || fee === null) return 'unknown'
  if (fee === 0) return 'free'
  if (fee === 8 || fee === 4 || fee === 1) return 'vip'
  return 'unknown'
}

/** 将网易云原始曲目归一化为共享 Track。 */
export function normalizeTrack(raw: RawSong): Track {
  const artists = (raw.ar ?? raw.artists ?? []).map((a) => a?.name).filter(Boolean)
  const album = raw.al ?? raw.album
  const coverRaw = album?.picUrl ?? album?.blurPicUrl ?? ''
  return {
    id: String(raw.id),
    title: raw.name ?? '未知曲目',
    artist: artists.join(' / ') || '未知艺人',
    album: album?.name ?? '',
    // 封面按需放大，网易云支持 ?param=WxH 缩略参数
    cover: https(coverRaw) ? `${https(coverRaw)}?param=600y600` : '',
    duration: Math.round(((raw.dt ?? raw.duration ?? 0) as number) / 1000),
    fee: feeOf(raw.fee),
  }
}

/** 将网易云原始歌单归一化为共享 Playlist。 */
export function normalizePlaylist(raw: RawPlaylist): Playlist {
  const cover = https(raw.coverImgUrl ?? raw.picUrl ?? '')
  return {
    id: String(raw.id),
    name: raw.name ?? '未命名歌单',
    cover: cover ? `${cover}?param=600y600` : '',
    description: raw.description ?? undefined,
    trackCount: raw.trackCount,
    playCount: raw.playCount,
    creator: raw.creator?.nickname,
  }
}

/**
 * 搜索单曲。
 *
 * @param keywords 关键词
 * @param limit 返回数量上限（默认 30）
 * @param cookie 透传的登录 cookie（可选）
 */
export async function searchSongs(keywords: string, limit = 30, cookie?: string): Promise<Track[]> {
  const res = await api.cloudsearch({ keywords, limit, cookie })
  const songs: RawSong[] = res?.body?.result?.songs ?? []
  return songs.map(normalizeTrack)
}

/** 首页个性化推荐歌单。 */
export async function recommendPlaylists(limit = 12, cookie?: string): Promise<Playlist[]> {
  const res = await api.personalized({ limit, cookie })
  const list: RawPlaylist[] = res?.body?.result ?? []
  return list.map(normalizePlaylist)
}

/** 排行榜列表。 */
export async function toplists(): Promise<Playlist[]> {
  const res = await api.toplist({})
  const list: RawPlaylist[] = res?.body?.list ?? []
  return list.map((raw) => ({
    ...normalizePlaylist(raw),
    trackCount: raw.trackCount ?? (raw as unknown as { size?: number }).size,
  }))
}

/** 精品歌单。 */
export async function topPlaylists(limit = 12, cat = '全部'): Promise<Playlist[]> {
  const res = await api.top_playlist({ limit, cat })
  const list: RawPlaylist[] = res?.body?.playlists ?? []
  return list.map(normalizePlaylist)
}

/** 歌单详情曲目。 */
export async function playlistTracks(id: string, cookie?: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
  const res = await api.playlist_detail({ id, cookie })
  const pl = res?.body?.playlist
  const playlist: Playlist = pl
    ? {
        id: String(pl.id),
        name: pl.name ?? '未命名歌单',
        cover: pl.coverImgUrl ? `${https(pl.coverImgUrl)}?param=600y600` : '',
        description: pl.description ?? undefined,
        trackCount: pl.trackCount,
        playCount: pl.playCount,
        creator: pl.creator?.nickname,
      }
    : { id, name: '歌单', cover: '' }
  const tracks: Track[] = ((pl?.tracks ?? []) as RawSong[]).map(normalizeTrack)
  return { playlist, tracks }
}

/**
 * 解析曲目真实播放地址。
 *
 * @param id 曲目 ID
 * @param cookie 登录 cookie（VIP 曲目必需）
 * @param level 音质（exhigh / lossless / hires 等），默认 exhigh
 * @returns 已改写为 https 的可播放地址；无法播放时返回 null
 */
export async function songUrl(id: string, cookie?: string, level = 'exhigh'): Promise<string | null> {
  try {
    const res = await api.song_url_v1({ id, level, cookie })
    const url: string | null = res?.body?.data?.[0]?.url ?? null
    return url ? https(url) : null
  } catch {
    return null
  }
}

/** 曲目详情（用于补全搜索未覆盖的元数据）。 */
export async function songDetail(ids: string[], cookie?: string): Promise<Track[]> {
  const res = await api.song_detail({ ids: ids.join(','), cookie })
  const songs: RawSong[] = res?.body?.songs ?? []
  return songs.map(normalizeTrack)
}

/** 获取歌词（含翻译）。 */
export async function getLyric(id: string, cookie?: string): Promise<Lyric> {
  try {
    const res = await api.lyric_new({ id, cookie })
    const lrc: string = res?.body?.lrc?.lyric ?? ''
    const tlyric: string | undefined = res?.body?.tlyric?.lyric
    return parseLrc(lrc, tlyric)
  } catch {
    return { lines: [], timed: false }
  }
}

/** 生成二维码 key。 */
export async function qrKey(cookie?: string): Promise<string> {
  const res = await api.login_qr_key({ cookie })
  return res?.body?.data?.unikey ?? ''
}

/** 生成二维码图片（base64 data URI）。 */
export async function qrCreate(key: string, cookie?: string): Promise<string> {
  const res = await api.login_qr_create({ key, qrimg: true, cookie })
  return res?.body?.data?.qrimg ?? ''
}

/**
 * 检查扫码登录状态。
 * @returns code: 800 过期 / 801 等待扫码 / 802 待确认 / 803 成功（附带原始 Set-Cookie 数组）
 */
export async function qrCheck(key: string, cookie?: string): Promise<{ code: number; cookies?: string[]; message?: string }> {
  const res = await api.login_qr_check({ key, cookie })
  return {
    code: res?.body?.code ?? 800,
    cookies: res?.cookie,
    message: res?.body?.message,
  }
}

/** 手机号登录（可选，用于无二维码环境）。 */
export async function loginCellphone(phone: string, password: string): Promise<{ cookies?: string[] } | undefined> {
  const res = await api.login_cellphone({ phone, password })
  if (res?.body?.code !== 200) return undefined
  return { cookies: res?.cookie }
}

/** 查询登录状态。 */
export async function loginStatus(cookie?: string): Promise<LoginStatus> {
  if (!cookie) return { logged: false }
  try {
    const res = await api.login_status({ cookie })
    const profile = res?.body?.data?.profile
    if (!profile) return { logged: false }
    return {
      logged: true,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl ? https(profile.avatarUrl) : undefined,
      userId: profile.userId,
      vip: Boolean(profile.vipType),
    }
  } catch {
    return { logged: false }
  }
}

/** 获取用户歌单。 */
export async function userPlaylists(uid: string, cookie?: string): Promise<Playlist[]> {
  const res = await api.user_playlist({ uid, cookie })
  const list: RawPlaylist[] = res?.body?.playlist ?? []
  return list.map(normalizePlaylist)
}
