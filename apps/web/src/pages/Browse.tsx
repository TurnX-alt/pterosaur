import { useState } from 'react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { useAuth, activeMusicSource } from '../store/auth.js'
import type { Playlist } from '@pterosaur/shared/types'
import { DEFAULT_SOURCE } from '@pterosaur/shared/types'
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
  const navigate = useViewNavigate()
  const [tab, setTab] = useState<Tab>('recommend')
  const status = useAuth((s) => s.status)
  // 发现内容跟随活动账号（未登录用缺省源）。
  const source = activeMusicSource(status) ?? DEFAULT_SOURCE

  const recommend = useAsync<Playlist[]>(
    () => api.recommend(source, 30),
    [source],
    [],
  )
  const playlists = useAsync<Playlist[]>(
    () => api.playlists(source, 30),
    [source],
    [],
  )
  const toplists = useAsync<Playlist[]>(
    () => api.toplists(source),
    [source],
    [],
  )

  // 该源支持哪些分区——不支持的 tab 隐藏。
  const caps = useAsync<{
    recommend: boolean
    playlists: boolean
    toplists: boolean
  }>(() => api.discoverCapabilities(source), [source], {
    recommend: true,
    playlists: true,
    toplists: true,
  })
  const visibleTabs = TABS.filter((t) => caps.data?.[t.key] !== false)
  const activeTab: Tab = visibleTabs.some((t) => t.key === tab)
    ? tab
    : (visibleTabs[0]?.key ?? 'recommend')

  const active =
    activeTab === 'recommend'
      ? recommend
      : activeTab === 'playlists'
        ? playlists
        : toplists

  return (
    <div className="browse">
      <header className="browse__header">
        <h1 className="browse__title">浏览</h1>
        <div className="browse__tabs" role="tablist">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={`browse__tab${activeTab === t.key ? ' browse__tab--active' : ''}`}
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
                subtitle={
                  fmtCount(p.playCount)
                    ? `${fmtCount(p.playCount)} 次播放`
                    : undefined
                }
                onClick={() => navigate(`/playlist/${p.source}/${p.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
