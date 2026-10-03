import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./netease.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./netease.js')>()
  return {
    ...actual,
    qrCheck: vi.fn(),
    loginStatus: vi.fn(),
    searchSongs: vi.fn(),
  }
})

import { createApp } from './app.js'
import { qrCheck, loginStatus, searchSongs } from './netease.js'

const app = createApp()

/** 复刻网易云 803 响应的真实形态：一条超长 MUSIC_U + 数十条 clientlog/feedback 类无关 cookie。 */
function loginCookies() {
  const cookies = [
    `MUSIC_U=${'A'.repeat(380)}; Max-Age=15552000; Expires=Wed, 31 Mar 2027 17:41:51 GMT; Path=/;`,
    '__csrf=504f94f752ea5436e36b39b00a974e0a; Max-Age=1296010; Expires=Sat, 17 Oct 2026 17:42:01 GMT; Path=/;',
    'NMTID=00Om2x4LRy61UHuRUpfvZ6ky4cQ6XcAAAGg_bVIbg; Max-Age=315360000; Expires=Mon, 29 Sep 2036 17:41:51 GMT; Path=/;',
    'MUSIC_A=0f1179cb01aa44f29c48f90b78b0485f9bd2b6f6a44e1f2a; Max-Age=315360000; Expires=Mon, 29 Sep 2036 17:41:51 GMT; Path=/;',
    'MUSIC_SNS=; Max-Age=0; Expires=Fri, 02 Oct 2026 17:41:51 GMT; Path=/;',
  ]
  const scopes = [
    'eapi/clientlog',
    'api/clientlog',
    'openapi/clientlog',
    'wapi/clientlog',
    'weapi/clientlog',
    'neapi/clientlog',
    'api/feedback',
    'eapi/feedback',
    'openapi/feedback',
    'wapi/feedback',
    'weapi/feedback',
  ]
  for (const scope of scopes) {
    cookies.push(
      `MUSIC_A_T=1477146889814; Max-Age=2147483647; Expires=Wed, 20 Oct 2094 20:55:58 GMT; Path=/${scope};`,
      `MUSIC_R_T=1477146960737; Max-Age=2147483647; Expires=Wed, 20 Oct 2094 20:55:58 GMT; Path=/${scope};`,
    )
  }
  for (const scope of ['api/login/token/refresh', 'eapi/login/token/refresh']) {
    cookies.push(
      `MUSIC_R_U=00DE2BE5D54B5B01B83CC1A646BD07C2A4F11FAE2FABD5F60793BDF26A15167CC5AA314B4E83A6132F57339D211CF3F8DC18515847E544FC0B1246B3F35439FA1F768D036F7FBDF874AEC4A1D65739F601; Max-Age=15552000; Expires=Wed, 31 Mar 2027 17:41:51 GMT; Path=/${scope};`,
    )
  }
  return cookies
}

/** 会话必需 cookie 白名单：测试独立维护字面量，避免与实现同源导致断言失真。 */
const SESSION_COOKIE_NAMES = ['MUSIC_U', '__csrf', 'MUSIC_A', 'NMTID']
const cookieName = (setCookie: string) => setCookie.slice(0, setCookie.indexOf('='))

describe('扫码登录 803 响应', () => {
  it('只下发会话必需的 cookie，避免大响应头触发网关 502', async () => {
    vi.mocked(qrCheck).mockResolvedValue({ code: 803, cookies: loginCookies() })
    vi.mocked(loginStatus).mockResolvedValue({ logged: true, nickname: 'tester', vip: true })

    const res = await app.request('/api/auth/qr/check?key=test-key')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { code: number; logged?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data.code).toBe(803)
    expect(body.data.logged).toBe(true)

    const setCookies = res.headers.getSetCookie()
    expect(setCookies.map(cookieName).sort()).toEqual([...SESSION_COOKIE_NAMES].sort())
    expect(setCookies.join('\n').length).toBeLessThan(2048)
  })

  it('803 下发的 cookie 会被后续请求回读并透传网易云', async () => {
    vi.mocked(qrCheck).mockResolvedValue({ code: 803, cookies: loginCookies() })
    vi.mocked(loginStatus).mockResolvedValue({ logged: true, nickname: 'tester' })

    const checkRes = await app.request('/api/auth/qr/check?key=test-key')
    const cookieHeader = checkRes.headers
      .getSetCookie()
      .map((sc) => sc.split(';')[0])
      .join('; ')

    const statusRes = await app.request('/api/auth/status', { headers: { cookie: cookieHeader } })
    expect(statusRes.status).toBe(200)
    const forwarded = vi.mocked(loginStatus).mock.calls.at(-1)?.[0]
    expect(forwarded).toContain('MUSIC_U=')
    expect(forwarded).toContain('__csrf=')
    expect(forwarded).toContain('NMTID=')
  })

  it('未登录状态（801）不下发任何 cookie', async () => {
    vi.mocked(qrCheck).mockResolvedValue({ code: 801, message: '等待扫码' })

    const res = await app.request('/api/auth/qr/check?key=test-key')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { code: number } }
    expect(body.ok).toBe(true)
    expect(body.data.code).toBe(801)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('服务端缺省凭证（NETEASE_COOKIE）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未登录访客的内容请求透传缺省凭证', async () => {
    vi.stubEnv('NETEASE_COOKIE', 'MUSIC_U=default; __csrf=d')
    vi.mocked(searchSongs).mockResolvedValue([])

    const res = await app.request('/api/search?keywords=test')
    expect(res.status).toBe(200)
    expect(vi.mocked(searchSongs).mock.calls.at(-1)?.[2]).toBe('MUSIC_U=default; __csrf=d')
  })

  it('访客本人会话优先于缺省凭证', async () => {
    vi.stubEnv('NETEASE_COOKIE', 'MUSIC_U=default')
    vi.mocked(searchSongs).mockResolvedValue([])

    await app.request('/api/search?keywords=test', {
      headers: { cookie: 'MUSIC_U=mine; __csrf=m' },
    })
    expect(vi.mocked(searchSongs).mock.calls.at(-1)?.[2]).toBe('MUSIC_U=mine; __csrf=m')
  })

  it('缺省凭证不影响身份：auth/status 仍为未登录', async () => {
    vi.stubEnv('NETEASE_COOKIE', 'MUSIC_U=default')
    vi.mocked(loginStatus).mockResolvedValue({ logged: false })

    const res = await app.request('/api/auth/status')
    expect(await res.json()).toEqual({ ok: true, data: { logged: false } })
    // 身份判断没有把缺省凭证透传进去
    expect(vi.mocked(loginStatus).mock.calls.at(-1)?.[0]).toBeUndefined()
  })
})
