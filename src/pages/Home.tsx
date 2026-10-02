import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Clock, Heart } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useAuth } from '../store/auth.js'
import type { Playlist, Track } from '../../shared/types.js'
import { PlaylistCard } from '../components/PlaylistCard.js'
import { TrackList } from '../components/TrackList.js'
import { Cover } from '../components/Cover.js'
import { Loading, ErrorState } from '../components/States.js'
import './pages.css'

/**
 * 立即收听（首页）。
 *
 * - 顶部问候 + 快捷入口（最近播放 / 我喜欢的音乐）；
 * - 「为你推荐歌单」横向卡片；
 * - 「继续收听」最近播放列表。
 */
export function Home() {
  const navigate = useNavigate()
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playTracks = usePlayer((s) => s.playTracks)
  const status = useAuth((s) => s.status)

  const recommend = useAsync<Playlist[]>(() => api.recommend(12), [], [])
  const [featured, setFeatured] = useState<Track[]>([])

  // 从第一个推荐歌单里取若干曲目作为「精选单曲」
  useEffect(() => {
    const first = recommend.data?.[0]
    if (!first) return
    let cancelled = false
    api
      .playlist(first.id)
      .then(({ tracks }) => {
        if (!cancelled) setFeatured(tracks.slice(0, 8))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [recommend.data])

  const hour = new Date().getHours()
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="home">
      <header className="home__hero">
        <div>
          <h1 className="home__greeting">
            {greeting}
            {status.logged && status.nickname ? `，${status.nickname}` : ''}
          </h1>
        </div>
      </header>

      {/* 快捷入口 */}
      <section className="home__shortcuts">
        <button type="button" className="shortcut" onClick={() => favorites.length && playTracks(favorites, 0)} disabled={!favorites.length}>
          <span className="shortcut__icon shortcut__icon--fav">
            <Heart size={20} fill="currentColor" strokeWidth={0} />
          </span>
          <span className="shortcut__text">
            <strong>我喜欢的音乐</strong>
            <small>{favorites.length} 首</small>
          </span>
        </button>
        <button type="button" className="shortcut" onClick={() => recent.length && playTracks(recent, 0)} disabled={!recent.length}>
          <span className="shortcut__icon shortcut__icon--recent">
            <Clock size={20} strokeWidth={2} />
          </span>
          <span className="shortcut__text">
            <strong>最近播放</strong>
            <small>{recent.length} 首</small>
          </span>
        </button>
      </section>

      {/* 为你推荐歌单 */}
      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">为你推荐</h2>
            <p className="section-subtitle">根据热门与个性化推荐为你挑选</p>
          </div>
          <button type="button" className="section-link" onClick={() => navigate('/browse')}>
            查看全部
          </button>
        </div>
        {recommend.loading ? (
          <Loading text="加载推荐…" />
        ) : recommend.error ? (
          <ErrorState message={recommend.error} onRetry={recommend.reload} />
        ) : (
          <div className="card-grid">
            {recommend.data?.map((p) => (
              <PlaylistCard key={p.id} playlist={p} onClick={() => navigate(`/playlist/${p.id}`)} />
            ))}
          </div>
        )}
      </section>

      {/* 精选单曲 */}
      {featured.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">精选单曲</h2>
          </div>
          <div className="home__featured">
            {featured.map((t, i) => (
              <button key={t.id} type="button" className="featured-item" onClick={() => playTracks(featured, i)}>
                <Cover src={t.cover} alt={t.title} radius="sm" size={48} />
                <span className="featured-item__text">
                  <span className="featured-item__title ellipsis">{t.title}</span>
                  <span className="featured-item__artist ellipsis">{t.artist}</span>
                </span>
                <span className="featured-item__play">
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 继续收听 */}
      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">继续收听</h2>
            <button type="button" className="section-link" onClick={() => navigate('/recent')}>
              查看全部
            </button>
          </div>
          <TrackList tracks={recent.slice(0, 8)} showHeader={false} />
        </section>
      )}
    </div>
  )
}
