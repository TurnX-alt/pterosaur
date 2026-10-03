import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import type { SearchResults } from '@pterosaur/shared/types'
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

const EMPTY_RESULTS: SearchResults = { songs: [], artists: [], albums: [], playlists: [] }

/**
 * 搜索结果页。
 *
 * 关键词来自 URL 查询参数 `?q=`，由顶部搜索框导航而来；一次并行拉取
 * 「歌曲 / 艺人 / 专辑 / 歌单」四类，用 tab 分类展示。
 */
export function SearchPage() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const navigate = useViewNavigate()
  const [tab, setTab] = useState<SearchTab>('songs')

  const { data, loading, error, reload } = useAsync<SearchResults>(
    () => (q ? api.searchAll(q, 20) : Promise.resolve(EMPTY_RESULTS)),
    [q],
    EMPTY_RESULTS,
    q ? `search:${q}` : undefined,
  )

  if (!q) {
    return (
      <div className="search">
        <header className="search__header">
          <span className="search__label">搜索</span>
          <h1 className="search__title">输入关键词开始畅听</h1>
        </header>
        <Empty text="在上方搜索框输入歌曲、艺人或专辑名" icon={<SearchX size={32} strokeWidth={1.5} />} />
      </div>
    )
  }

  const results = data ?? EMPTY_RESULTS
  const counts: Record<SearchTab, number> = {
    songs: results.songs.length,
    artists: results.artists.length,
    albums: results.albums.length,
    playlists: results.playlists.length,
  }
  const hasAny = TABS.some((t) => counts[t.key] > 0)

  return (
    <div className="search">
      <header className="search__header">
        <span className="search__label">搜索结果</span>
        <h1 className="search__title">“{q}”</h1>
      </header>

      <div className="search__tabs" role="tablist" aria-label="搜索结果分类">
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
            {!loading && !error && counts[t.key] > 0 && <span className="search__tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <section className="search__results">
        {loading ? (
          <Loading text="搜索中…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasAny ? (
          <Empty text={`没有找到与「${q}」相关的内容`} icon={<SearchX size={32} strokeWidth={1.5} />} />
        ) : tab === 'songs' ? (
          <TrackList tracks={results.songs} emptyText="没有找到相关歌曲" />
        ) : tab === 'artists' ? (
          results.artists.length ? (
            <div className="card-grid">
              {results.artists.map((a) => (
                <ArtistCard key={a.id} artist={a} onClick={() => navigate(`/artist/${a.id}`)} />
              ))}
            </div>
          ) : (
            <Empty text="没有找到相关艺人" />
          )
        ) : tab === 'albums' ? (
          results.albums.length ? (
            <div className="card-grid">
              {results.albums.map((album) => (
                <AlbumCard key={album.id} album={album} onClick={() => navigate(`/album/${album.id}`)} />
              ))}
            </div>
          ) : (
            <Empty text="没有找到相关专辑" />
          )
        ) : results.playlists.length ? (
          <div className="card-grid">
            {results.playlists.map((p) => (
              <PlaylistCard key={p.id} playlist={p} onClick={() => navigate(`/playlist/${p.id}`)} />
            ))}
          </div>
        ) : (
          <Empty text="没有找到相关歌单" />
        )}
      </section>
    </div>
  )
}
