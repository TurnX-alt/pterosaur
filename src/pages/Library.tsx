import { useNavigate } from 'react-router-dom'
import { Plus, ListMusic, Heart, Clock } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { usePlayer } from '../store/player.js'
import { Cover } from '../components/Cover.js'
import { Empty } from '../components/States.js'

/**
 * 资料库总览：入口卡片（我喜欢的 / 最近播放）+ 全部本地歌单网格。
 */
export function LibraryPage() {
  const navigate = useNavigate()
  const playlists = useLibrary((s) => s.playlists)
  const favorites = useLibrary((s) => s.favorites)
  const recent = useLibrary((s) => s.recent)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const playTracks = usePlayer((s) => s.playTracks)

  const handleCreate = () => {
    const name = window.prompt('新歌单名称', '我的歌单')
    if (name === null) return
    const id = createPlaylist(name.trim() || '我的歌单')
    navigate(`/playlist/${id}`)
  }

  return (
    <div className="library">
      <header className="library__header">
        <h1 className="library__title">资料库</h1>
        <button type="button" className="library__new" onClick={handleCreate}>
          <Plus size={16} strokeWidth={2.4} />
          新建歌单
        </button>
      </header>

      <section className="section">
        <div className="lib-entries">
          <button type="button" className="lib-entry" onClick={() => navigate('/favorites')}>
            <span className="lib-entry__icon lib-entry__icon--fav">
              <Heart size={22} fill="currentColor" strokeWidth={0} />
            </span>
            <span className="lib-entry__text">
              <strong>我喜欢的音乐</strong>
              <small>{favorites.length} 首</small>
            </span>
          </button>
          <button type="button" className="lib-entry" onClick={() => navigate('/recent')}>
            <span className="lib-entry__icon lib-entry__icon--recent">
              <Clock size={22} strokeWidth={2} />
            </span>
            <span className="lib-entry__text">
              <strong>最近播放</strong>
              <small>{recent.length} 首</small>
            </span>
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">歌单</h2>
        </div>
        {playlists.length === 0 ? (
          <Empty text="还没有自建歌单，点击右上角新建一个吧" icon={<ListMusic size={32} strokeWidth={1.5} />} />
        ) : (
          <div className="card-grid">
            {playlists.map((p) => (
              <button type="button" key={p.id} className="card card--playlist" onClick={() => navigate(`/playlist/${p.id}`)}>
                <div className="card__art">
                  <Cover src={p.tracks[0]?.cover} alt={p.name} radius="md" className="card__cover" />
                  <span
                    className="card__play"
                    aria-hidden
                    onClick={(e) => {
                      e.stopPropagation()
                      if (p.tracks.length) playTracks(p.tracks, 0)
                    }}
                  >
                    <ListMusic size={20} strokeWidth={2} />
                  </span>
                </div>
                <div className="card__body">
                  <div className="card__title ellipsis">{p.name}</div>
                  <div className="card__subtitle ellipsis">{p.tracks.length} 首</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
