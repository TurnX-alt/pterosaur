import { Play } from 'lucide-react'
import type { Album, Artist } from '@pterosaur/shared/types'
import { usePlayCollection } from '../hooks/usePlayCollection.js'
import { Cover } from './Cover.js'
import './Cards.css'

interface ArtistCardProps {
  artist: Artist
  onClick: () => void
}

/** 艺人卡片：圆形头像 + 名称 + 单曲/专辑数。 */
export function ArtistCard({ artist, onClick }: ArtistCardProps) {
  const meta =
    artist.musicSize || artist.albumSize
      ? [artist.musicSize ? `${artist.musicSize} 首单曲` : '', artist.albumSize ? `${artist.albumSize} 张专辑` : '']
          .filter(Boolean)
          .join(' · ')
      : (artist.alias?.[0] ?? '')
  return (
    <button type="button" className="card card--artist" onClick={onClick}>
      <div className="card__art card__art--circle">
        <Cover src={artist.avatar} alt={artist.name} rounded className="card__cover" />
      </div>
      <div className="card__body">
        <div className="card__title card__title--center ellipsis">{artist.name}</div>
        {meta && <div className="card__subtitle card__subtitle--center ellipsis">{meta}</div>}
      </div>
    </button>
  )
}

interface AlbumCardProps {
  album: Album
  /** 点击卡片本体：进入专辑详情页 */
  onClick: () => void
}

/**
 * 专辑卡片：方形封面 + 名称 + 艺人（· 年份）。
 *
 * - 点击卡片本体：进入专辑详情页；
 * - 悬浮浮现的播放按钮：立即播放该专辑（不进入详情页）。
 */
export function AlbumCard({ album, onClick }: AlbumCardProps) {
  const { playAlbum } = usePlayCollection()
  return (
    <div
      className="card card--album"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // 仅在卡片本体获得焦点时响应，避免误触内部播放按钮
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="card__art">
        <Cover src={album.cover} alt={album.name} radius="md" className="card__cover" />
        <button
          type="button"
          className="card__play"
          aria-label="播放"
          disabled={album.trackCount === 0}
          onClick={(e) => {
            e.stopPropagation()
            void playAlbum(album.id)
          }}
        >
          <Play size={20} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      <div className="card__body">
        <div className="card__title ellipsis">{album.name}</div>
        <div className="card__subtitle ellipsis">
          {album.year ? `${album.artist} · ${album.year}` : album.artist}
        </div>
      </div>
    </div>
  )
}
