import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { LRUCache } from 'lru-cache'
import { adapterOf } from './sources/index.js'
import type { SourceAdapter } from './sources/types.js'
import {
  isMusicSource,
  audioLevelOrDefault,
  MUSIC_SOURCES,
  DEFAULT_SOURCE,
  type MusicSource,
  type ApiResult,
  type LoginStatus,
  type Playlist,
  type Track,
  type Lyric,
  type SyncEnvelope,
  type Artist,
  type Album,
} from '@pterosaur/shared/types'
import { isSyncEnvelope, readLibrary, writeLibrary } from './syncStore.js'

/** 音频地址缓存：id|level|凭证指纹 -> https url。网易云地址有时效，TTL 设短一些。 */
const urlCache = new LRUCache<string, string>({
  max: 2000,
  ttl: 15 * 60 * 1000,
})

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/**
 * 上游 CDN 响应头超时（毫秒）：仅约束连接建立阶段——CDN 挂起时避免请求被拖到
 * undici 默认的 300s body timeout（生产另受 nginx 60s read timeout 限制）。
 * body 阶段不设整体超时：长音频在弱网下慢速下载属正常。
 */
const UPSTREAM_HEADERS_TIMEOUT_MS = 10_000

/** 统一成功响应。 */
function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

/** 统一失败响应。 */
function fail(error: string, needLogin = false): ApiResult<never> {
  return { ok: false, error, needLogin: needLogin || undefined }
}

/** 从 `?source=` 查询参数解析音源；缺省为缺省源（网易云）。 */
function sourceQuery(c: Context): MusicSource {
  const s = c.req.query('source')
  return isMusicSource(s) ? s : DEFAULT_SOURCE
}

/**
 * 解析路由的源：`:source` 段**缺省为缺省源**（兼容 2 段式别名路由，如 `/api/album/:id`）；
 * 非法（如本地歌单 id `pl-…`）或未注册返回 null（调用方回 404）。
 */
function ctxAdapter(
  c: Context,
): { source: MusicSource; adapter: SourceAdapter } | null {
  const raw = c.req.param('source')
  const source =
    raw === undefined ? DEFAULT_SOURCE : isMusicSource(raw) ? raw : null
  if (!source) return null
  const adapter = adapterOf(source)
  return adapter ? { source, adapter } : null
}

/** 从请求头取出**指定源**的会话 cookie 字符串（仅访客本人会话，用于身份判断）。 */
function cookieOf(c: Context, adapter: SourceAdapter): string | undefined {
  const raw = c.req.header('cookie')
  if (!raw) return undefined
  const names = adapter.sessionCookieNames
  const parts = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((kv) => names.includes(kv.slice(0, kv.indexOf('='))))
  return parts.length ? parts.join('; ') : undefined
}

/**
 * 服务端缺省凭证：由 `pnpm log-in --source=<源>` 写入仓库根 `.env`
 * （`NETEASE_COOKIE` / `QQ_COOKIE`）。供**未登录访客**解析会员资源，不代表访客身份。
 */
function defaultCredential(source: MusicSource): string | undefined {
  const key = source === 'netease' ? 'NETEASE_COOKIE' : 'QQ_COOKIE'
  const v = process.env[key]?.trim()
  return v || undefined
}

/**
 * **内容接口**所用凭证：优先访客本人会话，回退到服务端缺省凭证。
 * 只用于搜索 / 播放 / 歌词等内容解析，绝不用于身份判断。
 */
function credentialOf(c: Context, adapter: SourceAdapter): string | undefined {
  return cookieOf(c, adapter) ?? defaultCredential(adapter.id)
}

/** 音频地址缓存键里的凭证指纹：区分匿名 / 不同账号，避免串用解析出的 CDN 地址。 */
function credentialKey(cookie?: string): string {
  if (!cookie) return 'anon'
  return createHash('sha1').update(cookie).digest('hex').slice(0, 12)
}

/**
 * 解析**访客本人**的活动账号身份 `{ source, id }`（最多一个源已登录）；未登录返回 `null`。
 * 身份接口专用——**绝不回退到缺省凭证**，否则会把匿名访客当成运营者账号。
 */
async function requireIdentity(
  c: Context,
): Promise<{ source: MusicSource; id: string } | null> {
  for (const source of MUSIC_SOURCES) {
    const adapter = adapterOf(source)
    if (!adapter) continue
    const st = await adapter.loginStatus(cookieOf(c, adapter))
    if (st.logged && st.userId) return { source, id: st.userId }
  }
  return null
}

/** 云同步的文件键：`<source>-<账号id>`（单活动账号，故与源绑定）。 */
function syncKey(identity: { source: MusicSource; id: string }): string {
  return `${identity.source}-${identity.id}`
}

/**
 * 只把登录响应中会话必需的 Set-Cookie 下发给浏览器（同源；生产 https 下安全存储）。
 * 上游会附带数十条无关 cookie，且部分带 `Domain=…` / `Secure` / `SameSite`——须剥离，
 * 否则浏览器会把这些 cookie 存到上游域而非本域，导致会话建立失败。
 */
function forwardSessionCookies(
  c: Context,
  adapter: SourceAdapter,
  cookies?: string[],
) {
  if (!cookies?.length) return
  const names = adapter.sessionCookieNames
  for (const raw of cookies) {
    const name = raw.slice(0, raw.indexOf('='))
    if (!names.includes(name)) continue
    const cleaned = raw
      .replace(/;\s*Domain=[^;]*/i, '')
      .replace(/;\s*Secure/i, '')
      .replace(/;\s*SameSite=\w+/i, '')
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
  // 2 段式 `/stream/:id` 视为缺省源（兼容旧页面 / 旧 SW 缓存）；3 段式显式带源。
  const rawSource = c.req.param('source')
  const source: MusicSource | null =
    rawSource === undefined
      ? DEFAULT_SOURCE
      : isMusicSource(rawSource)
        ? rawSource
        : null
  const adapter = source ? adapterOf(source) : undefined
  if (!source || !adapter) return c.json(fail('未知音源'), 404)

  const id = c.req.param('id') ?? ''
  const level = audioLevelOrDefault(c.req.query('level'))
  const cookie = credentialOf(c, adapter)

  const cacheKey = `${source}|${id}|${level}|${credentialKey(cookie)}`
  let url = urlCache.get(cacheKey)
  if (!url) {
    const resolved = await adapter.songUrl(id, cookie, level)
    if (resolved) {
      url = resolved
      urlCache.set(cacheKey, resolved)
    }
  }

  if (!url) {
    // VIP 曲目未登录 / 版权受限：返回 403 并置 needLogin
    return c.json(fail('该曲目暂不可播放', true), 403)
  }

  const range = c.req.header('range')
  const upstreamHeaders: Record<string, string> = {
    'User-Agent': UA,
    ...adapter.streamHeaders?.(id),
  }
  if (range) upstreamHeaders['Range'] = range

  const controller = new AbortController()
  const headersTimer = setTimeout(
    () => controller.abort(),
    UPSTREAM_HEADERS_TIMEOUT_MS,
  )
  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (e) {
    return c.json(fail(`音频获取失败：${(e as Error).message}`), 502)
  } finally {
    clearTimeout(headersTimer)
  }

  if (!upstream.ok && upstream.status !== 206) {
    // 地址可能已过期（TTL 内也可能失效）：淘汰缓存项，下次请求重新解析
    urlCache.delete(cacheKey)
    return c.json(fail(`音频源返回 ${upstream.status}`), 502)
  }

  const headers = new Headers()
  headers.set(
    'Content-Type',
    upstream.headers.get('content-type') ?? 'audio/mpeg',
  )
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'no-store')

  const status = upstream.status === 206 ? 206 : 200
  // HEAD 请求不返回 body
  return new Response(c.req.method === 'HEAD' ? null : upstream.body, {
    status,
    headers,
  })
}

export function createApp() {
  const app = new Hono()

  // 同源部署；开发期由 Vite 代理转发，这里放开 CORS 便于本地联调。
  app.use(
    '/api/*',
    cors({ origin: '*', allowHeaders: ['Content-Type'], credentials: true }),
  )

  app.get('/api/health', (c) => c.json(ok({ status: 'ok', time: Date.now() })))

  /* ============================ 发现 / 搜索 ============================ */

  app.get('/api/search', async (c) => {
    const keywords = (c.req.query('keywords') ?? c.req.query('s') ?? '').trim()
    const limit = Number(c.req.query('limit') ?? 30)
    if (!keywords) return c.json(fail('缺少搜索关键词'), 400)
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter) return c.json(fail('未知音源'), 404)
    try {
      const tracks = await adapter.searchSongs(
        keywords,
        Math.min(limit, 60),
        credentialOf(c, adapter),
      )
      return c.json(ok<Track[]>(tracks))
    } catch (e) {
      return c.json(fail(`搜索失败：${(e as Error).message}`), 502)
    }
  })

  /** 多类型搜索：一次并行返回歌曲 / 艺人 / 专辑 / 歌单；缺失的能力返回空数组并标记。 */
  app.get('/api/search/all', async (c) => {
    const keywords = (c.req.query('keywords') ?? '').trim()
    if (!keywords) return c.json(fail('缺少搜索关键词'), 400)
    const limit = Math.min(
      Math.max(Number(c.req.query('limit') ?? 20) || 20, 1),
      50,
    )
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter) return c.json(fail('未知音源'), 404)
    const cookie = credentialOf(c, adapter)
    try {
      const [songs, artists, albums, playlists] = await Promise.all([
        adapter.searchSongs(keywords, 50, cookie),
        adapter.searchArtists
          ? adapter.searchArtists(keywords, limit, cookie)
          : Promise.resolve([] as Artist[]),
        adapter.searchAlbums
          ? adapter.searchAlbums(keywords, limit, cookie)
          : Promise.resolve([] as Album[]),
        adapter.searchPlaylists
          ? adapter.searchPlaylists(keywords, limit, cookie)
          : Promise.resolve([] as Playlist[]),
      ])
      const capabilities = {
        songs: true,
        artists: Boolean(adapter.searchArtists),
        albums: Boolean(adapter.searchAlbums),
        playlists: Boolean(adapter.searchPlaylists),
      }
      return c.json(ok({ songs, artists, albums, playlists, capabilities }))
    } catch (e) {
      return c.json(fail(`搜索失败：${(e as Error).message}`), 502)
    }
  })

  /** 某源支持的发现能力（供前端隐藏不支持的 tab）。 */
  app.get('/api/discover/capabilities', (c) => {
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter) return c.json(fail('未知音源'), 404)
    return c.json(
      ok({
        recommend: Boolean(adapter.recommendPlaylists),
        playlists: Boolean(adapter.topPlaylists),
        toplists: Boolean(adapter.toplists),
      }),
    )
  })

  app.get('/api/discover/recommend', async (c) => {
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter?.recommendPlaylists)
      return c.json(fail('该音源暂不支持推荐'), 501)
    try {
      const list = await adapter.recommendPlaylists(
        Number(c.req.query('limit') ?? 12),
        credentialOf(c, adapter),
      )
      return c.json(ok<Playlist[]>(list))
    } catch (e) {
      return c.json(fail(`获取推荐失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/discover/toplists', async (c) => {
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter?.toplists) return c.json(fail('该音源暂不支持排行榜'), 501)
    try {
      const list = await adapter.toplists(
        Number(c.req.query('limit') ?? 50),
        credentialOf(c, adapter),
      )
      return c.json(ok<Playlist[]>(list))
    } catch (e) {
      return c.json(fail(`获取排行榜失败：${(e as Error).message}`), 502)
    }
  })

  app.get('/api/discover/playlists', async (c) => {
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter?.topPlaylists)
      return c.json(fail('该音源暂不支持精品歌单'), 501)
    try {
      const cat = c.req.query('cat') ?? '全部'
      const limit = Number(c.req.query('limit') ?? 12)
      return c.json(
        ok<Playlist[]>(
          await adapter.topPlaylists(limit, cat, credentialOf(c, adapter)),
        ),
      )
    } catch (e) {
      return c.json(fail(`获取歌单失败：${(e as Error).message}`), 502)
    }
  })

  /** 歌单详情（3 段式带源；2 段式为缺省源别名）。 */
  const playlistHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    if (!ctx.adapter.playlistTracks)
      return c.json(fail('该音源暂不支持歌单页'), 501)
    try {
      const id = c.req.param('id') ?? ''
      const { playlist, tracks } = await ctx.adapter.playlistTracks(
        id,
        credentialOf(c, ctx.adapter),
      )
      return c.json(ok({ playlist, tracks }))
    } catch (e) {
      return c.json(fail(`获取歌单详情失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/playlist/:source/:id', playlistHandler)
  app.get('/api/playlist/:id', playlistHandler)

  const artistHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    if (!ctx.adapter.artistDetail)
      return c.json(fail('该音源暂不支持艺人页'), 501)
    try {
      const name = c.req.query('name')
      return c.json(
        ok(
          await ctx.adapter.artistDetail(
            c.req.param('id') ?? '',
            credentialOf(c, ctx.adapter),
            name,
          ),
        ),
      )
    } catch (e) {
      return c.json(fail(`获取艺人详情失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/artist/:source/:id', artistHandler)
  app.get('/api/artist/:id', artistHandler)

  const albumHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    try {
      return c.json(
        ok(
          await ctx.adapter.albumDetail(
            c.req.param('id') ?? '',
            credentialOf(c, ctx.adapter),
          ),
        ),
      )
    } catch (e) {
      return c.json(fail(`获取专辑详情失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/album/:source/:id', albumHandler)
  app.get('/api/album/:id', albumHandler)

  app.get('/api/songs', async (c) => {
    const ids = (c.req.query('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) return c.json(fail('缺少 ids'), 400)
    const adapter = adapterOf(sourceQuery(c))
    if (!adapter) return c.json(fail('未知音源'), 404)
    if (!adapter.songDetail) return c.json(fail('该音源暂不支持批量曲目'), 501)
    try {
      const tracks = await adapter.songDetail(
        ids.slice(0, 200),
        credentialOf(c, adapter),
      )
      return c.json(ok<Track[]>(tracks))
    } catch (e) {
      return c.json(fail(`获取曲目详情失败：${(e as Error).message}`), 502)
    }
  })

  const lyricHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    try {
      return c.json(
        ok<Lyric>(
          await ctx.adapter.getLyric(
            c.req.param('id') ?? '',
            credentialOf(c, ctx.adapter),
          ),
        ),
      )
    } catch (e) {
      return c.json(fail(`获取歌词失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/lyric/:source/:id', lyricHandler)
  app.get('/api/lyric/:id', lyricHandler)

  /* ============================ 登录 / VIP ============================ */

  const authStatusHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    try {
      return c.json(
        ok<LoginStatus>(
          await ctx.adapter.loginStatus(cookieOf(c, ctx.adapter)),
        ),
      )
    } catch {
      return c.json(ok<LoginStatus>({ logged: false }))
    }
  }
  app.get('/api/auth/:source/status', authStatusHandler)
  app.get('/api/auth/status', authStatusHandler)

  /** 生成二维码：返回 key 与 base64 图片，前端凭 key 轮询 `/qr/check`。 */
  const authQrHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    try {
      const cookie = cookieOf(c, ctx.adapter)
      const key = await ctx.adapter.qrKey(cookie)
      if (!key) return c.json(fail('无法生成登录二维码'), 502)
      const qrimg = await ctx.adapter.qrCreate(key, cookie)
      return c.json(ok({ key, qrimg }))
    } catch (e) {
      return c.json(fail(`生成二维码失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/auth/:source/qr', authQrHandler)
  app.get('/api/auth/qr', authQrHandler)

  /**
   * 轮询扫码状态。803 成功时下发 Set-Cookie 建立会话，并返回登录档案。
   * 其余状态码（800/801/802）仅返回状态，不下发 cookie。
   */
  const authQrCheckHandler = async (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    const key = c.req.query('key')
    if (!key) return c.json(fail('缺少 key'), 400)
    try {
      const { code, cookies, message } = await ctx.adapter.qrCheck(
        key,
        cookieOf(c, ctx.adapter),
      )
      if (code !== 803) {
        return c.json(ok({ code, logged: false, message }))
      }
      const cookieHeader = ctx.adapter.cookieHeaderFromSetCookies(cookies)
      const status = await ctx.adapter.loginStatus(cookieHeader)
      forwardSessionCookies(c, ctx.adapter, cookies)
      // 单活动账号：登入某源时清掉**其它**源的会话 cookie（防御陈旧 cookie，与前端「登录后无入口」双保险）
      for (const other of MUSIC_SOURCES) {
        if (other === ctx.source) continue
        const oa = adapterOf(other)
        if (!oa) continue
        for (const name of oa.logoutCookieNames) {
          c.header('Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax`, {
            append: true,
          })
        }
      }
      return c.json(
        ok<LoginStatus & { code: number; message?: string }>({
          ...status,
          code,
          message,
        }),
      )
    } catch (e) {
      return c.json(fail(`检查登录状态失败：${(e as Error).message}`), 502)
    }
  }
  app.get('/api/auth/:source/qr/check', authQrCheckHandler)
  app.get('/api/auth/qr/check', authQrCheckHandler)

  const authLogoutHandler = (c: Context) => {
    const ctx = ctxAdapter(c)
    if (!ctx) return c.json(fail('未知音源'), 404)
    for (const name of ctx.adapter.logoutCookieNames) {
      c.header('Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax`, {
        append: true,
      })
    }
    return c.json(ok<LoginStatus>({ logged: false }))
  }
  app.post('/api/auth/:source/logout', authLogoutHandler)
  app.post('/api/auth/logout', authLogoutHandler)

  app.get('/api/user/playlists', async (c) => {
    const netease = adapterOf('netease')
    if (!netease?.userPlaylists)
      return c.json(fail('该音源暂不支持用户歌单'), 501)
    const cookie = cookieOf(c, netease)
    const uid = c.req.query('uid')
    try {
      if (!uid) {
        const st = await netease.loginStatus(cookie)
        if (!st.logged || !st.userId) return c.json(fail('未登录', true), 401)
        return c.json(
          ok<Playlist[]>(await netease.userPlaylists(st.userId, cookie)),
        )
      }
      return c.json(ok<Playlist[]>(await netease.userPlaylists(uid, cookie)))
    } catch (e) {
      return c.json(fail(`获取用户歌单失败：${(e as Error).message}`), 502)
    }
  })

  /* ============================ 云同步 ============================ */

  /**
   * 读取本人 library 的云端副本。以访客本人 cookie 判定身份（未登录 401）。
   * 返回 `{ payload }`：`null` 表示云端尚无数据（首次开启同步）。
   */
  app.get('/api/sync/library', async (c) => {
    const identity = await requireIdentity(c)
    if (!identity) return c.json(fail('未登录', true), 401)
    try {
      return c.json(
        ok<{ payload: SyncEnvelope | null }>({
          payload: await readLibrary(syncKey(identity)),
        }),
      )
    } catch (e) {
      return c.json(fail(`读取云同步失败：${(e as Error).message}`), 502)
    }
  })

  /** 覆盖写入本人 library 的云端副本（LWW：调用方负责携带更新的 updatedAt）。 */
  app.put('/api/sync/library', async (c) => {
    const identity = await requireIdentity(c)
    if (!identity) return c.json(fail('未登录', true), 401)
    const body: unknown = await c.req.json().catch(() => null)
    if (!isSyncEnvelope(body)) return c.json(fail('同步载荷非法'), 400)
    try {
      await writeLibrary(syncKey(identity), body)
      return c.json(ok<SyncEnvelope>(body))
    } catch (e) {
      return c.json(fail(`写入云同步失败：${(e as Error).message}`), 400)
    }
  })

  /* ============================ 音频流代理 ============================ */

  app.get('/stream/:source/:id', streamHandler)
  app.on('HEAD', '/stream/:source/:id', streamHandler)
  // 2 段式别名：兼容旧页面 / 旧 SW 外壳缓存（视为缺省源）。
  app.get('/stream/:id', streamHandler)
  app.on('HEAD', '/stream/:id', streamHandler)

  return app
}

export type AppType = ReturnType<typeof createApp>
