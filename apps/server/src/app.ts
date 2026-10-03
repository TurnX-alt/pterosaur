import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { LRUCache } from 'lru-cache'
import {
  searchSongs,
  searchArtists,
  searchAlbums,
  searchPlaylists,
  artistDetail,
  albumDetail,
  recommendPlaylists,
  toplists,
  topPlaylists,
  playlistTracks,
  songUrl,
  songDetail,
  getLyric,
  qrKey,
  qrCreate,
  qrCheck,
  loginCellphone,
  loginStatus,
  userPlaylists,
  cookieHeaderFromSetCookies,
  SESSION_COOKIE_NAMES,
} from './netease.js'
import type { ApiResult, LoginStatus, Playlist, Track, Lyric } from '@pterosaur/shared/types'

/** 音频地址缓存：id|level|hasCookie -> https url。网易云地址有时效，TTL 设短一些。 */
const urlCache = new LRUCache<string, string>({ max: 2000, ttl: 15 * 60 * 1000 })

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 统一成功响应。 */
function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

/** 统一失败响应。 */
function fail(error: string, needLogin = false): ApiResult<never> {
  return { ok: false, error, needLogin: needLogin || undefined }
}

/** 从请求头中取出浏览器回传的网易云会话 cookie 字符串。 */
function cookieOf(c: Context): string | undefined {
  const raw = c.req.header('cookie')
  if (!raw) return undefined
  const parts = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((kv) => SESSION_COOKIE_NAMES.includes(kv.slice(0, kv.indexOf('='))))
  return parts.length ? parts.join('; ') : undefined
}

/**
 * 只把登录响应中会话必需的 Set-Cookie 下发给浏览器（同源；生产 https 下安全存储）。
 * 网易云登录响应会附带数十条无关 cookie（clientlog / feedback 等），全部转发会撑大响应头。
 */
function forwardSessionCookies(c: Context, cookies?: string[]) {
  if (!cookies?.length) return
  for (const raw of cookies) {
    const name = raw.slice(0, raw.indexOf('='))
    if (!SESSION_COOKIE_NAMES.includes(name)) continue
    const cleaned = raw.replace(/;\s*Secure/i, '').replace(/;\s*SameSite=\w+/i, '')
    c.header('Set-Cookie', `${cleaned}; Path=/; SameSite=Lax`, { append: true })
  }
}

/**
 * 音频流代理处理器：`GET|HEAD /stream/:id`。
 *
 * 浏览器 `<audio>` 直接请求本地址；服务端解析真实 CDN 地址、改写为 https，
 * 再按客户端 Range 转发到网易云 CDN，从而规避混合内容与跨域限制。
 */
async function streamHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? ''
  const level = c.req.query('level') ?? 'exhigh'
  const cookie = cookieOf(c)

  const cacheKey = `${id}|${level}|${cookie ? '1' : '0'}`
  let url = urlCache.get(cacheKey)
  if (!url) {
    const resolved = await songUrl(id, cookie, level)
    if (resolved) {
      url = resolved
      urlCache.set(cacheKey, resolved)
    }
  }

  if (!url) {
    // VIP 曲目未登录 / 版权受限：返回 403 并置 needLogin
    return c.json(fail('该曲目暂不可播放（可能需要登录 VIP）', true), 403)
  }

  const range = c.req.header('range')
  const upstreamHeaders: Record<string, string> = { 'User-Agent': UA }
  if (range) upstreamHeaders['Range'] = range

  let upstream: Response
  try {
    upstream = await fetch(url, { headers: upstreamHeaders, redirect: 'follow' })
  } catch (e) {
    return c.json(fail(`音频获取失败：${(e as Error).message}`), 502)
  }

  if (!upstream.ok && upstream.status !== 206) {
    return c.json(fail(`音频源返回 ${upstream.status}`), 502)
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'no-store')

  const status = upstream.status === 206 ? 206 : 200
  // HEAD 请求不返回 body
  return new Response(c.req.method === 'HEAD' ? null : upstream.body, { status, headers })
}

export function createApp() {
  const app = new Hono()

  // 同源部署；开发期由 Vite 代理转发，这里放开 CORS 便于本地联调。
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type'], credentials: true }))

  app.get('/api/health', (c) => c.json(ok({ status: 'ok', time: Date.now() })))

  /* ============================ 发现 / 搜索 ============================ */

  app.get('/api/search', async (c) => {
    const keywords = (c.req.query('keywords') ?? c.req.query('s') ?? '').trim()
    const limit = Number(c.req.query('limit') ?? 30)
    if (!keywords) return c.json(fail('缺少搜索关键词'), 400)
    try {
      const tracks = await searchSongs(keywords, Math.min(limit, 60), cookieOf(c))
      return c.json(ok<Track[]>(tracks))
    } catch (e) {
      return c.json(fail(`搜索失败：${(e as Error).message}`), 502)
    }
  })

  /** 多类型搜索：一次并行返回歌曲 / 艺人 / 专辑 / 歌单。 */
  app.get('/api/search/all', async (c) => {
    const keywords = (c.req.query('keywords') ?? '').trim()
    if (!keywords) return c.json(fail('缺少搜索关键词'), 400)
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 50)
    const cookie = cookieOf(c)
    try {
      const [songs, artists, albums, playlists] = await Promise.all([
        searchSongs(keywords, 50, cookie),
        searchArtists(keywords, limit, cookie),
        searchAlbums(keywords, limit, cookie),
        searchPlaylists(keywords, limit, cookie),
      ])
      return c.json(ok({ songs, artists, albums, playlists }))
    } catch (e) {
      return c.json(fail(`搜索失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/discover/recommend', async (c) => {
    try {
      const list = await recommendPlaylists(Number(c.req.query('limit') ?? 12), cookieOf(c))
      return c.json(ok<Playlist[]>(list))
    } catch (e) {
      return c.json(fail(`获取推荐失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/discover/toplists', async (c) => {
    try {
      return c.json(ok<Playlist[]>(await toplists()))
    } catch (e) {
      return c.json(fail(`获取排行榜失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/discover/playlists', async (c) => {
    try {
      const cat = c.req.query('cat') ?? '全部'
      const limit = Number(c.req.query('limit') ?? 12)
      return c.json(ok<Playlist[]>(await topPlaylists(limit, cat)))
    } catch (e) {
      return c.json(fail(`获取歌单失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/playlist/:id', async (c) => {
    const id = c.req.param('id')
    try {
      const { playlist, tracks } = await playlistTracks(id, cookieOf(c))
      return c.json(ok({ playlist, tracks }))
    } catch (e) {
      return c.json(fail(`获取歌单详情失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/artist/:id', async (c) => {
    const id = c.req.param('id')
    try {
      return c.json(ok(await artistDetail(id, cookieOf(c))))
    } catch (e) {
      return c.json(fail(`获取艺人详情失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/album/:id', async (c) => {
    const id = c.req.param('id')
    try {
      return c.json(ok(await albumDetail(id, cookieOf(c))))
    } catch (e) {
      return c.json(fail(`获取专辑详情失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/songs', async (c) => {
    const ids = (c.req.query('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) return c.json(fail('缺少 ids'), 400)
    try {
      const tracks = await songDetail(ids.slice(0, 200), cookieOf(c))
      return c.json(ok<Track[]>(tracks))
    } catch (e) {
      return c.json(fail(`获取曲目详情失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/lyric/:id', async (c) => {
    const id = c.req.param('id')
    try {
      return c.json(ok<Lyric>(await getLyric(id, cookieOf(c))))
    } catch (e) {
      return c.json(fail(`获取歌词失败：${(e as Error).message}`), 502)
    }
  })

  /* ============================ 登录 / VIP ============================ */

  app.get('/api/auth/status', async (c) => {
    try {
      return c.json(ok<LoginStatus>(await loginStatus(cookieOf(c))))
    } catch {
      return c.json(ok<LoginStatus>({ logged: false }))
    }
  })

  /** 生成二维码：返回 key 与 base64 图片，前端凭 key 轮询 /confirm。 */
  app.get('/api/auth/qr', async (c) => {
    try {
      const cookie = cookieOf(c)
      const key = await qrKey(cookie)
      if (!key) return c.json(fail('无法生成登录二维码'), 502)
      const qrimg = await qrCreate(key, cookie)
      return c.json(ok({ key, qrimg }))
    } catch (e) {
      return c.json(fail(`生成二维码失败：${(e as Error).message}`), 502)
    }
  })

  /**
   * 轮询扫码状态。803 成功时下发 Set-Cookie 建立会话，并返回登录档案。
   * 其余状态码（800/801/802）仅返回状态，不下发 cookie。
   */
  app.get('/api/auth/qr/check', async (c) => {
    const key = c.req.query('key')
    if (!key) return c.json(fail('缺少 key'), 400)
    try {
      const { code, cookies, message } = await qrCheck(key, cookieOf(c))
      if (code !== 803) {
        return c.json(ok({ code, logged: false, message }))
      }
      const cookieHeader = cookieHeaderFromSetCookies(cookies)
      const status = await loginStatus(cookieHeader)
      forwardSessionCookies(c, cookies)
      return c.json(ok<LoginStatus & { code: number }>({ ...status, code }))
    } catch (e) {
      return c.json(fail(`检查登录状态失败：${(e as Error).message}`), 502)
    }
  })

  app.post('/api/auth/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string; password?: string }
    const { phone, password } = body
    if (!phone || !password) return c.json(fail('缺少手机号或密码'), 400)
    try {
      const res = await loginCellphone(phone, password)
      if (!res?.cookies) return c.json(fail('登录失败，请检查手机号与密码'), 401)
      const cookieHeader = cookieHeaderFromSetCookies(res.cookies)
      const status = await loginStatus(cookieHeader)
      forwardSessionCookies(c, res.cookies)
      return c.json(ok<LoginStatus>(status))
    } catch (e) {
      return c.json(fail(`登录失败：${(e as Error).message}`), 502)
    }
  })

  app.post('/api/auth/logout', (c) => {
    c.header('Set-Cookie', 'MUSIC_U=; Path=/; Max-Age=0; SameSite=Lax', { append: true })
    c.header('Set-Cookie', '__csrf=; Path=/; Max-Age=0; SameSite=Lax', { append: true })
    return c.json(ok<LoginStatus>({ logged: false }))
  })

  app.get('/api/user/playlists', async (c) => {
    const cookie = cookieOf(c)
    const uid = c.req.query('uid')
    try {
      if (!uid) {
        const st = await loginStatus(cookie)
        if (!st.logged || !st.userId) return c.json(fail('未登录', true), 401)
        return c.json(ok<Playlist[]>(await userPlaylists(String(st.userId), cookie)))
      }
      return c.json(ok<Playlist[]>(await userPlaylists(uid, cookie)))
    } catch (e) {
      return c.json(fail(`获取用户歌单失败：${(e as Error).message}`), 502)
    }
  })

  /* ============================ 音频流代理 ============================ */

  app.get('/stream/:id', streamHandler)
  app.on('HEAD', '/stream/:id', streamHandler)

  return app
}

export type AppType = ReturnType<typeof createApp>
