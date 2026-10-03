import { Disc3 } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { AlbumCard } from '../components/EntityCards.js'
import { Empty } from '../components/States.js'
import './pages.css'

/**
 * 唱片盒：**只**展示收藏的专辑。
 *
 * 与「歌单」（自建 + 收藏的歌单）职责分离，保证每处入口功能单一。
 */
export function CratePage() {
  const navigate = useViewNavigate()
  const savedAlbums = useLibrary((s) => s.savedAlbums)

  return (
    <div className="crate">
      <header className="crate__header">
        <h1 className="crate__title">唱片盒</h1>
      </header>

      <section className="section">
        {savedAlbums.length === 0 ? (
          <Empty text="唱片盒还空着，去专辑页点红心收藏吧" icon={<Disc3 size={32} strokeWidth={1.5} />} />
        ) : (
          <div className="card-grid">
            {savedAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} onClick={() => navigate(`/album/${album.id}`)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
