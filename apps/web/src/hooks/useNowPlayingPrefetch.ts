import { useEffect } from 'react'
import { usePlayer } from '../store/player.js'
import { prefetchLyric } from '../lib/lyricCache.js'
import { preloadCover } from '../lib/imageCache.js'

/**
 * 沉浸播放页数据预载：当前曲目变化时预热封面与歌词，使打开瞬时、无占位闪、无
 * 「歌词加载中」停留。
 *
 * 只订阅 `current`（**不订阅 `position`**，否则会被约 20Hz 的进度回写反复触发）。
 * StrictMode 下 effect 双跑，预载函数天然幂等。
 */
export function useNowPlayingPrefetch(): void {
  const current = usePlayer((s) => s.current)
  useEffect(() => {
    if (!current) return
    preloadCover(current.cover)
    void prefetchLyric(current.id)
  }, [current])
}
