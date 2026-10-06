import { useEffect, useState } from 'react'
import { Play, Clock, Heart } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useAuth, activeSource } from '../store/auth.js'
import type { Playlist, Track } from '@pterosaur/shared/types'
import { DEFAULT_SOURCE } from '@pterosaur/shared/types'
import { PlaylistCard } from '../components/PlaylistCard.js'
import { TrackList } from '../components/TrackList.js'
import { coverAt, COVER_SMALL } from '@pterosaur/shared/image'
import { Cover } from '../components/Cover.js'
import { Loading, ErrorState } from '../components/States.js'
import './pages.css'

interface ShortcutProps {
  /** 图标主题色变体 */
  variant: 'fav' | 'recent'
  title: string
  count: number
  icon: React.ReactNode
  /** 点击本体：进入对应页面 */
  onOpen: () => void
  /** 点击悬浮播放按钮：直接播放该集合 */
  onPlay: () => void
}

/**
 * 快捷入口磁贴：点击本体进入页面；悬浮浮现的播放按钮直接播放（不跳转）。
 * 集合为空时播放按钮仍在（保持 hover 反馈一致），但置为禁用态。
 */
function Shortcut({
  variant,
  title,
  count,
  icon,
  onOpen,
  onPlay,
}: ShortcutProps) {
  return (
    <div
      className="shortcut"
      role="button"
      tabIndex={0}
      aria-label={`${title}，${count} 首`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // 仅在磁贴本体获得焦点时响应，避免误触内部播放按钮
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <span className={`shortcut__icon shortcut__icon--${variant}`}>
        {icon}
      </span>
      <span className="shortcut__text">
        <strong>{title}</strong>
        <small>{count} 首</small>
      </span>
      <button
        type="button"
        className="shortcut__play"
        aria-label={`播放${title}`}
        disabled={count === 0}
        onClick={(e) => {
          e.stopPropagation()
          onPlay()
        }}
      >
        <Play size={18} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  )
}

/**
 * 立即收听（首页）。
 *
 * - 顶部问候 + 快捷入口（最近播放 / 我喜欢的音乐）；
 * - 「为你推荐歌单」横向卡片；
 * - 「继续收听」最近播放列表。
 */
export function Home() {
  const navigate = useViewNavigate()
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playTracks = usePlayer((s) => s.playTracks)
  const status = useAuth((s) => s.status)
  // 推荐跟随活动账号（未登录用缺省源）。
  const source = activeSource(status) ?? DEFAULT_SOURCE

  const recommend = useAsync<Playlist[]>(
    () => api.recommend(source, 12),
    [source],
    [],
  )
  const [featured, setFeatured] = useState<Track[]>([])

  // 从第一个推荐歌单里取若干曲目作为「精选单曲」
  useEffect(() => {
    const first = recommend.data?.[0]
    if (!first) return
    let cancelled = false
    api
      .playlist(first.source, first.id)
      .then(({ tracks }) => {
        if (!cancelled) setFeatured(tracks.slice(0, 8))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [recommend.data])

  const hour = new Date().getHours()
  const greeting =
    hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="home">
      <header className="home__hero">
        <div>
          <h1 className="home__greeting">
            {greeting}
            {status[source]?.logged && status[source].nickname
              ? `，${status[source].nickname}`
              : ''}
          </h1>
        </div>
      </header>

      {/* 快捷入口：点击进入对应页面；悬浮的播放按钮直接播放，不跳转 */}
      <section className="home__shortcuts">
        <Shortcut
          variant="fav"
          title="我喜欢的音乐"
          count={favorites.length}
          icon={<Heart size={20} fill="currentColor" strokeWidth={0} />}
          onOpen={() => navigate('/favorites')}
          onPlay={() => playTracks(favorites, 0)}
        />
        <Shortcut
          variant="recent"
          title="最近播放"
          count={recent.length}
          icon={<Clock size={20} strokeWidth={2} />}
          onOpen={() => navigate('/recent')}
          onPlay={() => playTracks(recent, 0)}
        />
      </section>

      {/* 为你推荐歌单 */}
      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">为你推荐</h2>
            <p className="section-subtitle">根据热门与个性化推荐为你挑选</p>
          </div>
          <button
            type="button"
            className="section-link"
            onClick={() => navigate('/browse')}
          >
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
              <PlaylistCard
                key={p.id}
                playlist={p}
                onClick={() => navigate(`/playlist/${p.source}/${p.id}`)}
              />
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
              <button
                key={t.id}
                type="button"
                className="featured-item"
                onClick={() => playTracks(featured, i)}
              >
                <Cover
                  src={coverAt(t.cover, COVER_SMALL)}
                  alt={t.title}
                  radius="sm"
                  size={48}
                />
                <span className="featured-item__text">
                  <span className="featured-item__title ellipsis">
                    {t.title}
                  </span>
                  <span className="featured-item__artist ellipsis">
                    {t.artist}
                  </span>
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
            <button
              type="button"
              className="section-link"
              onClick={() => navigate('/recent')}
            >
              查看全部
            </button>
          </div>
          <TrackList tracks={recent.slice(0, 8)} showHeader={false} />
        </section>
      )}
    </div>
  )
}
