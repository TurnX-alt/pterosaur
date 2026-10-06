import { useState } from 'react'
import { Disc3 } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { AlbumCard, ArtistCard } from '../components/EntityCards.js'
import { Empty } from '../components/States.js'
import './pages.css'

/**
 * 唱片盒：展示收藏的**艺人 + 专辑**，艺人区在上、专辑区在下。
 *
 * 与「歌单」（自建 + 收藏的歌单）职责分离，保证每处入口功能单一；任一区为空则隐去该区，
 * 两者皆空才显示空态。
 *
 * 列表在**进入时冻结**（读一次 store 快照）：在页内取消收藏后卡片不立即消失（防误触），
 * 下次进入唱片盒才刷新。
 */
export function CratePage() {
  const navigate = useViewNavigate()
  const [savedArtists] = useState(() => useLibrary.getState().savedArtists)
  const [savedAlbums] = useState(() => useLibrary.getState().savedAlbums)
  const isEmpty = savedArtists.length === 0 && savedAlbums.length === 0

  return (
    <div className="crate">
      <header className="crate__header">
        <h1 className="crate__title">唱片盒</h1>
      </header>

      {isEmpty ? (
        <section className="section">
          <Empty
            text="唱片盒还空着，去艺人或专辑页点红心收藏吧"
            icon={<Disc3 size={32} strokeWidth={1.5} />}
          />
        </section>
      ) : (
        <>
          {savedArtists.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">艺人</h2>
              </div>
              <div className="card-grid">
                {savedArtists.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onClick={() =>
                      navigate(
                        `/artist/${artist.source}/${artist.id}?name=${encodeURIComponent(artist.name)}`,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {savedAlbums.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">专辑</h2>
              </div>
              <div className="card-grid">
                {savedAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onClick={() =>
                      navigate(`/album/${album.source}/${album.id}`)
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
