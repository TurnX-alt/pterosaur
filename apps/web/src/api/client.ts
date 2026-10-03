import type {
  Album,
  ApiResult,
  Artist,
  LoginStatus,
  Lyric,
  Playlist,
  SearchResults,
  SyncEnvelope,
  Track,
} from '@pterosaur/shared/types'
import { API_BASE } from '@pterosaur/shared/types'

/** 统一的 GET JSON 请求，解析后端 `ApiResult` 包裹。 */
async function get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { credentials: 'include' })
  const json = (await res.json().catch(() => null)) as ApiResult<T> | null
  if (!json || !json.ok) {
    const err = new Error(json?.error ?? `请求失败（${res.status}）`) as Error & {
      needLogin?: boolean
      status?: number
    }
    err.needLogin = json?.needLogin
    err.status = res.status
    throw err
  }
  return json.data as T
}

/** 带 JSON body 的写请求（POST / PUT），解析后端 `ApiResult` 包裹。 */
async function send<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as ApiResult<T> | null
  if (!json || !json.ok) {
    const err = new Error(json?.error ?? `请求失败（${res.status}）`) as Error & { needLogin?: boolean }
    err.needLogin = json?.needLogin
    throw err
  }
  return json.data as T
}

const post = <T>(path: string, body?: unknown): Promise<T> => send<T>('POST', path, body)
const put = <T>(path: string, body?: unknown): Promise<T> => send<T>('PUT', path, body)

export const api = {
  search: (keywords: string, limit = 30) => get<Track[]>(`${API_BASE}/search`, { keywords, limit }),

  /** 多类型搜索：一次并行返回歌曲 / 艺人 / 专辑 / 歌单。 */
  searchAll: (keywords: string, limit = 20) => get<SearchResults>(`${API_BASE}/search/all`, { keywords, limit }),

  /** 艺人详情：档案 + 热门单曲 + 专辑列表。 */
  artist: (id: string) =>
    get<{ artist: Artist; tracks: Track[]; albums: Album[] }>(`${API_BASE}/artist/${encodeURIComponent(id)}`),

  /** 专辑详情：档案 + 曲目。 */
  album: (id: string) => get<{ album: Album; tracks: Track[] }>(`${API_BASE}/album/${encodeURIComponent(id)}`),

  recommend: (limit = 12) => get<Playlist[]>(`${API_BASE}/discover/recommend`, { limit }),

  toplists: () => get<Playlist[]>(`${API_BASE}/discover/toplists`),

  playlists: (limit = 12, cat = '全部') => get<Playlist[]>(`${API_BASE}/discover/playlists`, { limit, cat }),

  playlist: (id: string) =>
    get<{ playlist: Playlist; tracks: Track[] }>(`${API_BASE}/playlist/${encodeURIComponent(id)}`),

  songs: (ids: string[]) => get<Track[]>(`${API_BASE}/songs`, { ids: ids.join(',') }),

  lyric: (id: string) => get<Lyric>(`${API_BASE}/lyric/${encodeURIComponent(id)}`),

  authStatus: () => get<LoginStatus>(`${API_BASE}/auth/status`),

  qrCreate: () => get<{ key: string; qrimg: string }>(`${API_BASE}/auth/qr`),

  qrCheck: (key: string) => get<LoginStatus & { code?: number }>(`${API_BASE}/auth/qr/check`, { key }),

  login: (phone: string, password: string) => post<LoginStatus>(`${API_BASE}/auth/login`, { phone, password }),

  logout: () => post<LoginStatus>(`${API_BASE}/auth/logout`),

  userPlaylists: (uid?: string) => get<Playlist[]>(`${API_BASE}/user/playlists`, { uid }),

  /** 读取本人 library 的云端副本；`payload` 为 null 表示云端尚无数据。 */
  syncGet: () => get<{ payload: SyncEnvelope | null }>(`${API_BASE}/sync/library`),

  /** 覆盖写入本人 library 的云端副本（LWW）。 */
  syncPut: (envelope: SyncEnvelope) => put<SyncEnvelope>(`${API_BASE}/sync/library`, envelope),
}

export type Api = typeof api
