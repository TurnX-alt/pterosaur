import { Play } from 'lucide-react'
import type { Playlist } from '../../shared/types.js'
import { Cover } from './Cover.js'
import './Cards.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick: () => void
  /** 右上角副标签（如播放量） */
  subtitle?: string
}

/** 歌单 / 排行榜卡片（方形封面 + 标题 + 描述）。 */
export function PlaylistCard({ playlist, onClick, subtitle }: PlaylistCardProps) {
  return (
    <button type="button" className="card card--playlist" onClick={onClick}>
      <div className="card__art">
        <Cover src={playlist.cover} alt={playlist.name} radius="md" className="card__cover" />
        <span className="card__play" aria-hidden>
          <Play size={20} fill="currentColor" strokeWidth={0} />
        </span>
      </div>
      <div className="card__body">
        <div className="card__title ellipsis">{playlist.name}</div>
        <div className="card__subtitle ellipsis">{subtitle ?? playlist.description ?? (playlist.creator ? `by ${playlist.creator}` : '')}</div>
      </div>
    </button>
  )
}
