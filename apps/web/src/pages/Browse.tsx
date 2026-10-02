import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import type { Playlist } from '@pterosaur/shared/types'
import { PlaylistCard } from '../components/PlaylistCard.js'
import { Loading, ErrorState } from '../components/States.js'

type Tab = 'recommend' | 'playlists' | 'toplists'

const TABS: { key: Tab; label: string }[] = [
  { key: 'recommend', label: '个性推荐' },
  { key: 'playlists', label: '精品歌单' },
  { key: 'toplists', label: '排行榜' },
]

/** 格式化播放量为「万 / 亿」。 */
function fmtCount(n?: number): string | undefined {
  if (!n) return undefined
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${Math.round(n / 1e4)} 万`
  return String(n)
}

/**
 * 浏览页：个性推荐 / 精品歌单 / 排行榜三个分区，卡片网格展示。
 */
export function Browse() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('recommend')

  const recommend = useAsync<Playlist[]>(() => api.recommend(30), [], [])
  const playlists = useAsync<Playlist[]>(() => api.playlists(30), [], [])
  const toplists = useAsync<Playlist[]>(() => api.toplists(), [], [])

  const active = tab === 'recommend' ? recommend : tab === 'playlists' ? playlists : toplists

  return (
    <div className="browse">
      <header className="browse__header">
        <h1 className="browse__title">浏览</h1>
        <div className="browse__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`browse__tab${tab === t.key ? ' browse__tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <section className="section">
        {active.loading ? (
          <Loading />
        ) : active.error ? (
          <ErrorState message={active.error} onRetry={active.reload} />
        ) : (
          <div className="card-grid">
            {active.data?.map((p) => (
              <PlaylistCard
                key={p.id}
                playlist={p}
                subtitle={fmtCount(p.playCount) ? `${fmtCount(p.playCount)} 次播放` : undefined}
                onClick={() => navigate(`/playlist/${p.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
