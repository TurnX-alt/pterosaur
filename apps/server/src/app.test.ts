import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { createApp } from './app.js'
import { neteaseAdapter } from './sources/netease.js'
import { qqAdapter } from './sources/qq.js'

const app = createApp()

/**
 * 直接对适配器方法做 spy。适配器是模块级单例对象，`app` 经 `adapterOf` 取到同一对象，
 * 故替换其方法即可拦截上游调用（比 `vi.mock` 模块更稳，且不受「适配器对象在模块求值时
 * 就捕获了真实函数」的影响）。vitest 配置 `restoreMocks: true` 会在每个用例后自动还原。
 */
let qrCheckMock: Mock
let loginStatusMock: Mock
let searchSongsMock: Mock

beforeEach(() => {
  qrCheckMock = vi.spyOn(neteaseAdapter, 'qrCheck')
  loginStatusMock = vi.spyOn(neteaseAdapter, 'loginStatus')
  searchSongsMock = vi.spyOn(neteaseAdapter, 'searchSongs')
})

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
const cookieName = (setCookie: string) =>
  setCookie.slice(0, setCookie.indexOf('='))

describe('扫码登录 803 响应', () => {
  it('只下发会话必需的 cookie，避免大响应头触发网关 502', async () => {
    qrCheckMock.mockResolvedValue({ code: 803, cookies: loginCookies() })
    loginStatusMock.mockResolvedValue({
      logged: true,
      nickname: 'tester',
      vip: true,
    })

    const res = await app.request('/api/auth/qr/check?key=test-key')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data: { code: number; logged?: boolean }
    }
    expect(body.ok).toBe(true)
    expect(body.data.code).toBe(803)
    expect(body.data.logged).toBe(true)

    const setCookies = res.headers.getSetCookie()
    const names = setCookies.map(cookieName)
    // 会话 cookie 只含网易云白名单项
    for (const n of SESSION_COOKIE_NAMES) expect(names).toContain(n)
    // 单活动账号：登入网易云时同时清掉其它源（QQ）的会话 cookie（空值 + Max-Age=0）
    const otherClears = setCookies.filter((c) =>
      /^(uin|qqmusic_uin|qqmusic_key|qm_keyst)=;/.test(c),
    )
    expect(otherClears.length).toBeGreaterThan(0)
    for (const c of otherClears) expect(c).toContain('Max-Age=0')
    // 响应头仍克制（不因透传无关 cookie 而撑大）
    expect(setCookies.join('\n').length).toBeLessThan(2048)
  })

  it('803 下发的 cookie 会被后续请求回读并透传网易云', async () => {
    qrCheckMock.mockResolvedValue({ code: 803, cookies: loginCookies() })
    loginStatusMock.mockResolvedValue({ logged: true, nickname: 'tester' })

    const checkRes = await app.request('/api/auth/qr/check?key=test-key')
    const cookieHeader = checkRes.headers
      .getSetCookie()
      .map((sc) => sc.split(';')[0])
      .join('; ')

    const statusRes = await app.request('/api/auth/status', {
      headers: { cookie: cookieHeader },
    })
    expect(statusRes.status).toBe(200)
    const forwarded = loginStatusMock.mock.calls.at(-1)?.[0]
    expect(forwarded).toContain('MUSIC_U=')
    expect(forwarded).toContain('__csrf=')
    expect(forwarded).toContain('NMTID=')
  })

  it('未登录状态（801）不下发任何 cookie', async () => {
    qrCheckMock.mockResolvedValue({ code: 801, message: '等待扫码' })

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
    searchSongsMock.mockResolvedValue([])

    const res = await app.request('/api/search?keywords=test')
    expect(res.status).toBe(200)
    expect(searchSongsMock.mock.calls.at(-1)?.[2]).toBe(
      'MUSIC_U=default; __csrf=d',
    )
  })

  it('访客本人会话优先于缺省凭证', async () => {
    vi.stubEnv('NETEASE_COOKIE', 'MUSIC_U=default')
    searchSongsMock.mockResolvedValue([])

    await app.request('/api/search?keywords=test', {
      headers: { cookie: 'MUSIC_U=mine; __csrf=m' },
    })
    expect(searchSongsMock.mock.calls.at(-1)?.[2]).toBe(
      'MUSIC_U=mine; __csrf=m',
    )
  })

  it('缺省凭证不影响身份：auth/status 仍为未登录', async () => {
    vi.stubEnv('NETEASE_COOKIE', 'MUSIC_U=default')
    loginStatusMock.mockResolvedValue({ logged: false })

    const res = await app.request('/api/auth/status')
    expect(await res.json()).toEqual({ ok: true, data: { logged: false } })
    // 身份判断没有把缺省凭证透传进去
    expect(loginStatusMock.mock.calls.at(-1)?.[0]).toBeUndefined()
  })
})

describe('多源路由：源段与缺省源', () => {
  it('3 段式 /stream/:source/:id 与 2 段式别名均可用（未知源 404）', async () => {
    vi.spyOn(neteaseAdapter, 'songUrl').mockResolvedValue(null)
    vi.spyOn(qqAdapter, 'songUrl').mockResolvedValue(null)
    expect((await app.request('/stream/netease/123')).status).toBe(403) // 解析失败 → 403
    expect((await app.request('/stream/123')).status).toBe(403) // 2 段别名 → 缺省源
    expect((await app.request('/stream/qq/003rJSwm3TechU')).status).toBe(403) // qq 适配器
    expect((await app.request('/stream/spotify/123')).status).toBe(404) // 未知源
  })

  it('/stream 的 level query 透传给适配器；非法档回退缺省 exhigh', async () => {
    const ne = vi.spyOn(neteaseAdapter, 'songUrl').mockResolvedValue(null)
    await app.request('/stream/netease/123?level=lossless')
    expect(ne).toHaveBeenCalledWith('123', undefined, 'lossless')
    await app.request('/stream/netease/456?level=bogus')
    expect(ne).toHaveBeenLastCalledWith('456', undefined, 'exhigh')
  })

  it('搜索按 source 查询参数分派到对应适配器', async () => {
    searchSongsMock.mockResolvedValue([])
    const qqSearch = vi.spyOn(qqAdapter, 'searchSongs').mockResolvedValue([])

    const ne = await app.request('/api/search?keywords=x')
    expect(ne.status).toBe(200)

    const qq = await app.request('/api/search?keywords=x&source=qq')
    expect(qq.status).toBe(200)
    expect(qqSearch).toHaveBeenCalledWith('x', expect.any(Number), undefined)
  })
})
