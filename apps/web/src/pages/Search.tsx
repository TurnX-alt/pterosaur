import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { useAuth, activeSource } from '../store/auth.js'
import type { MusicSource, SearchResults } from '@pterosaur/shared/types'
import {
  MUSIC_SOURCES,
  DEFAULT_SOURCE,
  isMusicSource,
} from '@pterosaur/shared/types'
import { TrackList } from '../components/TrackList.js'
import { PlaylistCard } from '../components/PlaylistCard.js'
import { ArtistCard, AlbumCard } from '../components/EntityCards.js'
import { Loading, ErrorState, Empty } from '../components/States.js'

type SearchTab = 'songs' | 'artists' | 'albums' | 'playlists'

const TABS: { key: SearchTab; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'artists', label: '艺人' },
  { key: 'albums', label: '专辑' },
  { key: 'playlists', label: '歌单' },
]

/** 源的中文展示名。 */
const SOURCE_LABELS: Record<MusicSource, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  migu: '咪咕音乐',
}

const EMPTY_RESULTS: SearchResults = {
  songs: [],
  artists: [],
  albums: [],
  playlists: [],
}

/**
 * 搜索结果页。
 *
 * 关键词来自 URL 查询参数 `?q=`，源来自 `?source=`（默认网易云）。
 * **按源分组**：一次只查询当前选中源的结果，源切换器置于分类 tab 之上；
 * 不跨源去重（各源内部 id 唯一）。某些源不具备全部搜索能力时，其分类 tab 隐藏。
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const status = useAuth((s) => s.status)
  const rawSource = params.get('source')
  // URL 未显式带源时，默认跟随**活动账号**（未登录则用缺省源）。
  const source: MusicSource = isMusicSource(rawSource)
    ? rawSource
    : (activeSource(status) ?? DEFAULT_SOURCE)
  const navigate = useViewNavigate()
  const [tab, setTab] = useState<SearchTab>('songs')

  const { data, loading, error, reload } = useAsync<SearchResults>(
    () => (q ? api.searchAll(source, q, 20) : Promise.resolve(EMPTY_RESULTS)),
    [q, source],
    EMPTY_RESULTS,
    q ? `search:${source}:${q}` : undefined,
  )

  /** 切换源：写回 URL（默认源不写，保持地址干净），交由 useAsync 重新取数。 */
  const selectSource = (next: MusicSource) => {
    const p = new URLSearchParams(params)
    if (next === DEFAULT_SOURCE) p.delete('source')
    else p.set('source', next)
    setParams(p, { replace: true })
  }

  if (!q) {
    return (
      <div className="search">
        <header className="search__header">
          <span className="search__label">搜索</span>
          <h1 className="search__title">输入关键词开始畅听</h1>
        </header>
        <Empty
          text="在上方搜索框输入歌曲、艺人或专辑名"
          icon={<SearchX size={32} strokeWidth={1.5} />}
        />
      </div>
    )
  }

  const results = data ?? EMPTY_RESULTS
  const caps = results.capabilities
  const counts: Record<SearchTab, number> = {
    songs: results.songs.length,
    artists: results.artists.length,
    albums: results.albums.length,
    playlists: results.playlists.length,
  }
  // 只展示当前源支持的分类（capabilities 缺失视为支持）
  const visibleTabs = TABS.filter((t) => caps?.[t.key] !== false)
  const activeTab = visibleTabs.some((t) => t.key === tab)
    ? tab
    : (visibleTabs[0]?.key ?? 'songs')
  const hasAny = visibleTabs.some((t) => counts[t.key] > 0)

  return (
    <div className="search">
      <header className="search__header">
        <span className="search__label">搜索结果</span>
        <h1 className="search__title">“{q}”</h1>
      </header>

      <div
        className="search__tabs search__sources"
        role="tablist"
        aria-label="音源"
      >
        {MUSIC_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={source === s}
            className={`browse__tab${source === s ? ' browse__tab--active' : ''}`}
            onClick={() => selectSource(s)}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="search__tabs" role="tablist" aria-label="搜索结果分类">
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
            {!loading && !error && counts[t.key] > 0 && (
              <span className="search__tab-count">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      <section className="search__results">
        {loading ? (
          <Loading text="搜索中…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasAny ? (
          <Empty
            text={`没有找到与「${q}」相关的内容`}
            icon={<SearchX size={32} strokeWidth={1.5} />}
          />
        ) : activeTab === 'songs' ? (
          <TrackList tracks={results.songs} emptyText="没有找到相关歌曲" />
        ) : activeTab === 'artists' ? (
          results.artists.length ? (
            <div className="card-grid">
              {results.artists.map((a) => (
                <ArtistCard
                  key={a.id}
                  artist={a}
                  onClick={() =>
                    navigate(
                      `/artist/${a.source}/${a.id}?name=${encodeURIComponent(a.name)}`,
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <Empty text="没有找到相关艺人" />
          )
        ) : activeTab === 'albums' ? (
          results.albums.length ? (
            <div className="card-grid">
              {results.albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => navigate(`/album/${album.source}/${album.id}`)}
                />
              ))}
            </div>
          ) : (
            <Empty text="没有找到相关专辑" />
          )
        ) : results.playlists.length ? (
          <div className="card-grid">
            {results.playlists.map((p) => (
              <PlaylistCard
                key={p.id}
                playlist={p}
                onClick={() => navigate(`/playlist/${p.source}/${p.id}`)}
              />
            ))}
          </div>
        ) : (
          <Empty text="没有找到相关歌单" />
        )}
      </section>
    </div>
  )
}
