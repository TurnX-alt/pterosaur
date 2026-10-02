import { useEffect } from 'react'
import { usePlayer, audioSrc } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { audioEl } from './audioElement.js'

/**
 * 全局唯一的 `<audio>` 引擎。
 *
 * 只挂载一次（在 App 顶层），负责：
 * - 把 store 中的 current/isPlaying/volume 同步到真实 audio 元素；
 * - 把 audio 的时间/结束/错误事件回写到 store；
 * - 处理「曲目自然结束」后的循环/随机推进；
 * - 处理 VIP/版权导致的播放失败。
 *
 * 进度 seek 由 {@link seekTo} 命令式处理，本引擎只单向回写播放位置。
 */
export function useAudioEngine(): void {
  const getState = () => usePlayer.getState()

  // current 变化 -> 换源并重置进度
  const current = usePlayer((s) => s.current)
  useEffect(() => {
    const audio = audioEl.current
    if (!audio) return
    const src = audioSrc(current)
    if (src) {
      const abs = new URL(src, window.location.origin).href
      if (audio.src !== abs) audio.src = abs
      audio.load()
    } else {
      audio.removeAttribute('src')
      audio.load()
    }
  }, [current])

  // isPlaying -> play/pause
  const isPlaying = usePlayer((s) => s.isPlaying)
  useEffect(() => {
    const audio = audioEl.current
    if (!audio || !current) return
    if (isPlaying) {
      audio.play().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        getState().setPlaying(false)
        // 浏览器自动播放策略：静默暂停，等待用户手势，不报错
        if (!/NotAllowedError|user didn't interact|play\(\) failed/i.test(msg)) {
          getState().setPlayError('该曲目暂不可播放，可能需要登录 VIP')
        }
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, current])

  // volume / muted
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  useEffect(() => {
    const audio = audioEl.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  // 事件绑定 + 进度回写（rAF 平滑）
  useEffect(() => {
    const audio = audioEl.current
    if (!audio) return

    let rafId = 0
    let disposed = false

    const onDuration = () => {
      if (disposed) return
      const d = audio.duration
      if (Number.isFinite(d)) getState().setDuration(d)
    }

    const onPlay = () => {
      if (!disposed) getState().setPlaying(true)
    }
    const onPause = () => {
      // ended 触发的 pause 不应覆盖播放态，交由 ended 处理
      if (!disposed && !audio.ended) getState().setPlaying(false)
    }

    const onEnded = () => {
      if (disposed) return
      const s = getState()
      const { index, queue, repeat } = s
      if (repeat === 'one') {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        return
      }
      if (queue.length && index >= 0) s.next()
      else s.setPlaying(false)
    }

    const onError = () => {
      if (disposed) return
      const s = getState()
      const err = audio.error
      if (err) {
        s.setPlaying(false)
        s.setPlayError(err.code === 2 ? '该曲目暂不可播放，可能需要登录 VIP' : `播放出错（code ${err.code}）`)
      }
    }

    const tick = () => {
      if (disposed) return
      const s = getState()
      if (!audio.paused && Math.abs(audio.currentTime - s.position) > 0.05) {
        s.setPosition(audio.currentTime)
      }
      rafId = requestAnimationFrame(tick)
    }

    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('loadedmetadata', onDuration)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    rafId = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('loadedmetadata', onDuration)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [])

  // 切歌即记录到「最近播放」
  useEffect(() => {
    if (current) useLibrary.getState().addRecent(current)
  }, [current])

  // 文档标题
  useEffect(() => {
    document.title = current
      ? `${current.title} - ${current.artist} · Pterosaur`
      : 'Pterosaur · 音乐'
  }, [current])

  // 媒体会话（系统级控制 / 锁屏信息）
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!current) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: current.cover ? [{ src: current.cover, sizes: '600x600', type: 'image/jpeg' }] : [],
    })
    const s = getState()
    navigator.mediaSession.setActionHandler('play', () => s.setPlaying(true))
    navigator.mediaSession.setActionHandler('pause', () => s.setPlaying(false))
    navigator.mediaSession.setActionHandler('previoustrack', () => s.prev())
    navigator.mediaSession.setActionHandler('nexttrack', () => s.next())
  }, [current])
}
