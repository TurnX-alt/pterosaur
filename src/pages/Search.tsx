import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import type { Track } from '../../shared/types.js'
import { TrackList } from '../components/TrackList.js'
import { Loading, ErrorState, Empty } from '../components/States.js'

/**
 * 搜索结果页。关键词来自 URL 查询参数 `?q=`，
 * 由顶部搜索框导航而来；q 变化时自动重新搜索。
 */
export function SearchPage() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()

  const { data, loading, error, reload } = useAsync<Track[]>(
    () => (q ? api.search(q, 50) : Promise.resolve([])),
    [q],
    [],
  )

  // 切换关键词时滚动回顶部
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [q])

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

  return (
    <div className="search">
      <header className="search__header">
        <span className="search__label">搜索结果</span>
        <h1 className="search__title">“{q}”</h1>
      </header>

      <section className="section">
        {loading ? (
          <Loading text="搜索中…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.length ? (
          <Empty text={`没有找到与「${q}」相关的曲目`} icon={<SearchX size={32} strokeWidth={1.5} />} />
        ) : (
          <TrackList tracks={data} />
        )}
      </section>
    </div>
  )
}
