import { useEffect, useState } from 'react'
import { Radio as RadioIcon, Shuffle } from 'lucide-react'
import { api } from '../api/client.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useAuth, activeSource } from '../store/auth.js'
import type { Playlist, Track } from '@pterosaur/shared/types'
import { DEFAULT_SOURCE } from '@pterosaur/shared/types'
import { TrackList } from '../components/TrackList.js'
import { ErrorState } from '../components/States.js'

/**
 * 电台页：以「随机探索」为核心。
 *
 * 点击「开始随机播放」会从一个热门歌单抽取曲目、开启随机模式并立即播放，
 * 模拟电台「不知道下一首是什么」的体验；同时提供最近播放作为快速入口。
 * 曲库跟随**活动账号**；无排行榜的源（如 QQ）退回「热门歌单」。
 */
export function Radio() {
  const playTracks = usePlayer((s) => s.playTracks)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const shuffle = usePlayer((s) => s.shuffle)
  const recent = useLibrary((s) => s.recent)
  const status = useAuth((s) => s.status)
  const source = activeSource(status) ?? DEFAULT_SOURCE

  const [pool, setPool] = useState<Track[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 预载一个「电台曲库」：优先排行榜（热歌/飙升），无排行榜的源退回热门歌单
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const pick = async (): Promise<Playlist> => {
      let target: Playlist | undefined
      try {
        const lists = await api.toplists(source)
        target = lists.find((l) => /热歌|飙升/.test(l.name)) ?? lists[0]
      } catch {
        target = (await api.recommend(source, 1))[0]
      }
      if (!target) throw new Error('没有可用的电台源')
      return target
    }
    pick()
      .then((target) => api.playlist(target.source, target.id))
      .then(({ tracks }) => {
        if (!cancelled) setPool(tracks.slice(0, 50))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source])

  const startRadio = () => {
    if (!pool?.length) return
    if (!shuffle) toggleShuffle()
    const start = Math.floor(Math.random() * pool.length)
    playTracks(pool, start)
  }

  return (
    <div className="browse">
      <header className="browse__header">
        <h1 className="browse__title">电台</h1>
      </header>

      <section className="radio-hero">
        <div className="radio-hero__icon">
          <RadioIcon size={30} strokeWidth={1.8} />
        </div>
        <div className="radio-hero__text">
          <h2>Pterosaur 电台</h2>
          <p>从热门曲目中随机播放，永远不知道下一首是什么。</p>
        </div>
        <button type="button" className="detail__play" onClick={startRadio} disabled={loading || !pool?.length}>
          <Shuffle size={18} strokeWidth={2.2} />
          {loading ? '准备中…' : '开始随机播放'}
        </button>
      </section>

      {error && <ErrorState message={error} />}

      {pool && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">电台曲库</h2>
            <span className="section-subtitle">{pool.length} 首候选曲目</span>
          </div>
          <TrackList tracks={pool} />
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">最近播放</h2>
          </div>
          <TrackList tracks={recent.slice(0, 6)} showHeader={false} />
        </section>
      )}
    </div>
  )
}
