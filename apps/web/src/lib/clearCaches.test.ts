import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllAppCaches } from './clearCaches.js'
import { clearMediaCache } from './mediaCache.js'
import { clearLyricCache } from './lyricCache.js'
import { clearCoverRegistry } from './imageCache.js'
import {
  clearAllCaches as clearCacheStorage,
  postToServiceWorker,
} from './pwa.js'
import { clearAsyncCache } from '../hooks/useAsync.js'

vi.mock('./mediaCache.js', () => ({ clearMediaCache: vi.fn() }))
vi.mock('./lyricCache.js', () => ({ clearLyricCache: vi.fn() }))
vi.mock('./imageCache.js', () => ({ clearCoverRegistry: vi.fn() }))
vi.mock('./pwa.js', () => ({
  clearAllCaches: vi.fn().mockResolvedValue(undefined),
  postToServiceWorker: vi.fn(),
}))
vi.mock('../hooks/useAsync.js', () => ({ clearAsyncCache: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(clearMediaCache).mockResolvedValue(undefined)
  vi.mocked(clearCacheStorage).mockResolvedValue(undefined)
})

describe('clearAllAppCaches', () => {
  it('清空媒体池 + 通知 SW + Cache Storage + 内存缓存', async () => {
    await clearAllAppCaches()
    expect(clearMediaCache).toHaveBeenCalledOnce()
    expect(postToServiceWorker).toHaveBeenCalledWith({
      type: 'MEDIA_CACHE_CLEARED',
    })
    expect(clearCacheStorage).toHaveBeenCalledOnce()
    expect(clearLyricCache).toHaveBeenCalledOnce()
    expect(clearCoverRegistry).toHaveBeenCalledOnce()
    expect(clearAsyncCache).toHaveBeenCalledOnce()
  })

  it('媒体池清理抛错也不阻断其余清理', async () => {
    vi.mocked(clearMediaCache).mockRejectedValue(new Error('idb'))
    await expect(clearAllAppCaches()).resolves.toBeUndefined()
    expect(clearCacheStorage).toHaveBeenCalledOnce()
    expect(clearAsyncCache).toHaveBeenCalledOnce()
  })
})
