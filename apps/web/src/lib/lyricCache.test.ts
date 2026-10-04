import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lyric } from '@pterosaur/shared/types'

vi.mock('../api/client.js', () => ({ api: { lyric: vi.fn() } }))

import { api } from '../api/client.js'
import { clearLyricCache, getCachedLyric, prefetchLyric, putCachedLyric } from './lyricCache.js'

const lyricMock = api.lyric as unknown as ReturnType<typeof vi.fn>
const sample: Lyric = { lines: [{ time: 0, text: 'hi' }], timed: true }

beforeEach(() => {
  clearLyricCache()
  lyricMock.mockReset()
})

describe('lyricCache', () => {
  it('未缓存返回 null', () => {
    expect(getCachedLyric('a')).toBeNull()
  })

  it('put 后可读', () => {
    putCachedLyric('a', sample)
    expect(getCachedLyric('a')).toBe(sample)
  })

  it('prefetch 拉取并写入缓存', async () => {
    lyricMock.mockResolvedValue(sample)
    await prefetchLyric('a')
    expect(lyricMock).toHaveBeenCalledWith('a')
    expect(getCachedLyric('a')).toBe(sample)
  })

  it('命中缓存不再请求', async () => {
    putCachedLyric('a', sample)
    await prefetchLyric('a')
    expect(lyricMock).not.toHaveBeenCalled()
  })

  it('并发预取同一曲目只发一次请求（in-flight 去重）', async () => {
    lyricMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(sample), 5)))
    await Promise.all([prefetchLyric('a'), prefetchLyric('a')])
    expect(lyricMock).toHaveBeenCalledTimes(1)
    expect(getCachedLyric('a')).toBe(sample)
  })

  it('请求失败不污染缓存，之后可重试', async () => {
    lyricMock.mockRejectedValue(new Error('boom'))
    await prefetchLyric('a')
    expect(getCachedLyric('a')).toBeNull()

    lyricMock.mockResolvedValue(sample)
    await prefetchLyric('a')
    expect(getCachedLyric('a')).toBe(sample)
  })

  it('超过上限按插入顺序淘汰最旧', () => {
    for (let i = 0; i < 70; i++) putCachedLyric(`k${i}`, sample)
    expect(getCachedLyric('k0')).toBeNull()
    expect(getCachedLyric('k69')).toBe(sample)
  })
})
