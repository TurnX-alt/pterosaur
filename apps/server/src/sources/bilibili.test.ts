import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  buildParts,
  canonicalBiliImage,
  collectLoginCookies,
  decodeTitle,
  normalizeBilibiliTrack,
  parseDuration,
  pickAudio,
  rankAudioUrls,
  rawQueryValue,
  searchSongs,
} from './bilibili.js'

describe('decodeTitle（去高亮标签 + 解码实体）', () => {
  it('去掉 <em> 高亮标签并解码常见实体', () => {
    expect(decodeTitle('<em class="keyword">周杰伦</em> 稻香 &amp; 晴天')).toBe(
      '周杰伦 稻香 & 晴天',
    )
    expect(decodeTitle('A &lt;B&gt; &quot;C&quot; &#39;D&#39;')).toBe(
      'A <B> "C" \'D\'',
    )
  })

  it('空串返回空串', () => {
    expect(decodeTitle('')).toBe('')
  })
})

describe('parseDuration', () => {
  it('mm:ss 与 h:mm:ss 均解析为秒', () => {
    expect(parseDuration('12:34')).toBe(754)
    expect(parseDuration('222:28')).toBe(222 * 60 + 28)
    expect(parseDuration('1:02:03')).toBe(3723)
  })

  it('缺失 / 非法返回 0', () => {
    expect(parseDuration(undefined)).toBe(0)
    expect(parseDuration('')).toBe(0)
    expect(parseDuration('abc')).toBe(0)
  })
})

describe('canonicalBiliImage', () => {
  it('协议相对与 http 补为 https', () => {
    expect(canonicalBiliImage('//i0.hdslb.com/bfs/a.jpg')).toBe(
      'https://i0.hdslb.com/bfs/a.jpg',
    )
    expect(canonicalBiliImage('http://i0.hdslb.com/bfs/a.jpg')).toBe(
      'https://i0.hdslb.com/bfs/a.jpg',
    )
  })

  it('i0–iN 镜像主机规范化到固定主机（免缓存碎片）', () => {
    expect(canonicalBiliImage('https://i2.hdslb.com/bfs/a.jpg')).toBe(
      'https://i0.hdslb.com/bfs/a.jpg',
    )
  })

  it('非 hdslb 主机与空值原样 / 空串', () => {
    expect(canonicalBiliImage('https://cdn.example.com/a.jpg')).toBe(
      'https://cdn.example.com/a.jpg',
    )
    expect(canonicalBiliImage(undefined)).toBe('')
    expect(canonicalBiliImage('not a url')).toBe('')
  })
})

describe('normalizeBilibiliTrack', () => {
  it('映射为共享 Track（id=bvid、封面规范化、时长转秒）', () => {
    const t = normalizeBilibiliTrack({
      bvid: 'BV1xx411c7mD',
      aid: 123,
      title: '<em>周杰伦</em> 稻香',
      author: '某 UP 主',
      pic: '//i0.hdslb.com/bfs/cover.jpg',
      duration: '03:45',
    })
    expect(t.source).toBe('bilibili')
    expect(t.id).toBe('BV1xx411c7mD')
    expect(t.title).toBe('周杰伦 稻香')
    expect(t.artist).toBe('某 UP 主')
    expect(t.album).toBe('')
    expect(t.cover).toBe('https://i0.hdslb.com/bfs/cover.jpg')
    expect(t.duration).toBe(225)
    expect(t.fee).toBe('free')
  })

  it('缺 bvid 时回落 aid，缺字段降级', () => {
    const t = normalizeBilibiliTrack({ aid: 999 })
    expect(t.id).toBe('999')
    expect(t.title).toBe('未知视频')
    expect(t.duration).toBe(0)
  })
})

describe('pickAudio（按档位挑码率）', () => {
  const audios = [
    { bandwidth: 43_962, id: 30216 },
    { bandwidth: 102_931, id: 30232 },
    { bandwidth: 203_786, id: 30280 },
  ]

  it('standard 取最低、exhigh 取最高', () => {
    expect(pickAudio(audios, 'standard')?.id).toBe(30216)
    expect(pickAudio(audios, 'exhigh')?.id).toBe(30280)
  })

  it('lossless / hires 在匿名档里取最高（有更高档则自然跟随）', () => {
    expect(pickAudio(audios, 'lossless')?.id).toBe(30280)
    expect(
      pickAudio([...audios, { bandwidth: 1_411_200, id: 30251 }], 'hires')?.id,
    ).toBe(30251)
  })

  it('空列表返回 undefined', () => {
    expect(pickAudio([], 'exhigh')).toBeUndefined()
  })
})

describe('rankAudioUrls（候选 CDN 排序：官方 upos 优先，mcdn 殿后）', () => {
  const mcdn = 'https://xy112x30x129x16xy.mcdn.bilivideo.cn/audio.m4s'
  const upos = 'https://upos-sz-mirrorcoso1.bilivideo.com/audio.m4s'
  const cn = 'https://upos-cn.bilivideo.cn/audio.m4s'
  const edge = 'https://h2i438c.edge.mountaintoys.cn/audio.m4s'

  it('upos 主 CDN 最前、mcdn 最后（第三方边缘居中）', () => {
    expect(rankAudioUrls([mcdn, edge, cn, upos])).toEqual([
      upos,
      cn,
      edge,
      mcdn,
    ])
  })

  it('去重，且同档保持相对顺序', () => {
    expect(rankAudioUrls([mcdn, upos, mcdn])).toEqual([upos, mcdn])
  })

  it('空数组与非法地址不抛错', () => {
    expect(rankAudioUrls([])).toEqual([])
    expect(rankAudioUrls(['not a url', upos])).toEqual([upos, 'not a url'])
  })
})

describe('buildParts（分P 一对多）', () => {
  const view = {
    bvid: 'BV1xx411c7mD',
    title: '视频标题',
    pic: '//i2.hdslb.com/bfs/cover.jpg',
    owner: { name: 'UP 主' },
    pages: [
      { cid: 111, page: 1, part: '第一段', duration: 100 },
      { cid: 222, page: 2, part: '第二段', duration: 200 },
    ],
  }

  it('多P：一页一项，id = `<bvid>:<cid>`，标题 `P<n> · <part>`，封面统一为视频封面', () => {
    const parts = buildParts(view)
    expect(parts).toHaveLength(2)
    expect(parts[0].id).toBe('BV1xx411c7mD:111')
    expect(parts[1].id).toBe('BV1xx411c7mD:222')
    expect(parts[0].title).toBe('P1 · 第一段')
    expect(parts[1].title).toBe('P2 · 第二段')
    expect(parts[0].cover).toBe('https://i0.hdslb.com/bfs/cover.jpg')
    expect(parts[0].artist).toBe('UP 主')
    expect(parts[0].duration).toBe(100)
    expect(parts.every((p) => p.source === 'bilibili')).toBe(true)
  })

  it('单P：一项，标题取视频标题', () => {
    const parts = buildParts({
      ...view,
      pages: [{ cid: 9, page: 1, part: '正片', duration: 60 }],
    })
    expect(parts).toHaveLength(1)
    expect(parts[0].title).toBe('视频标题')
    expect(parts[0].id).toBe('BV1xx411c7mD:9')
  })

  it('缺 bvid / 无 pages → 空数组', () => {
    expect(buildParts(undefined)).toEqual([])
    expect(buildParts({ title: 'x' })).toEqual([])
    expect(buildParts({ bvid: 'BV1', pages: [] })).toEqual([])
  })
})

describe('登录 cookie 收敛（保持原始编码，修「刷新掉登录」）', () => {
  it('rawQueryValue 不解码（%2C 原样保留）', () => {
    expect(
      rawQueryValue('https://x/l?SESSDATA=abc%2Cdef&x=1', 'SESSDATA'),
    ).toBe('abc%2Cdef')
    expect(rawQueryValue('https://x/l', 'SESSDATA')).toBeUndefined()
    expect(rawQueryValue('https://x/l?a=1', 'SESSDATA')).toBeUndefined()
  })

  it('collectLoginCookies：Set-Cookie 优先；缺失的从回跳 URL 补齐且**保持编码**', () => {
    const url =
      'https://www.bilibili.com/ok?SESSDATA=abc%2Cdef&bili_jct=www&gourl=x'
    const out = collectLoginCookies(['DedeUserID=123; Path=/'], url)
    expect(out).toContain('DedeUserID=123; Path=/')
    expect(out).toContain('SESSDATA=abc%2Cdef') // 未解码（解码成逗号会让浏览器拒存）
    expect(out).toContain('bili_jct=www')

    // 已由 Set-Cookie 给出的名字，不再从 URL 重复补
    const out2 = collectLoginCookies(['SESSDATA=fromheader'], url)
    expect(out2.filter((c) => c.startsWith('SESSDATA='))).toEqual([
      'SESSDATA=fromheader',
    ])
  })
})

describe('bGet 匿名解析重试', () => {
  /** 最小响应替身：避开 jsdom 是否提供 `Response` 的环境差异。 */
  const jsonRes = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('前两次网络失败、第三次成功 → 共 3 次请求且最终成功', async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal('fetch', (input: unknown) => {
      if (String(input).includes('/finger/spi'))
        return Promise.resolve(jsonRes({ code: 0, data: { b_3: 'buvid' } }))
      n++
      if (n <= 2) return Promise.reject(new Error('net'))
      return Promise.resolve(jsonRes({ code: 0, data: { result: [] } }))
    })
    const p = searchSongs('x')
    await vi.advanceTimersByTimeAsync(1200) // 覆盖 2 × 333ms
    await expect(p).resolves.toEqual([])
    expect(n).toBe(3)
  })

  it('上游返回非 0 业务码 → 同样重试（与具体错误码无关）', async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal('fetch', (input: unknown) => {
      if (String(input).includes('/finger/spi'))
        return Promise.resolve(jsonRes({ code: 0, data: { b_3: 'buvid' } }))
      n++
      if (n <= 2)
        return Promise.resolve(jsonRes({ code: -412, message: '风控' }))
      return Promise.resolve(jsonRes({ code: 0, data: { result: [] } }))
    })
    const p = searchSongs('x')
    await vi.advanceTimersByTimeAsync(1200)
    await expect(p).resolves.toEqual([])
    expect(n).toBe(3)
  })

  it('持续失败 → 重试至上限后抛错（首次 + 5 次重试 = 6 次请求）', async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal('fetch', (input: unknown) => {
      if (String(input).includes('/finger/spi'))
        return Promise.resolve(jsonRes({ code: 0, data: { b_3: 'buvid' } }))
      n++
      return Promise.reject(new Error('net'))
    })
    const p = searchSongs('x')
    const failed = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(2000) // 覆盖 5 × 333ms
    await failed
    expect(n).toBe(6)
  })
})
