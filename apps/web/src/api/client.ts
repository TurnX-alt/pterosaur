import type {
  ApiResult,
  LoginStatus,
  Lyric,
  Playlist,
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

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
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

export const api = {
  search: (keywords: string, limit = 30) => get<Track[]>(`${API_BASE}/search`, { keywords, limit }),

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
}

export type Api = typeof api
