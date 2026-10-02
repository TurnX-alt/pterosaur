import { Play, Pause, Heart, MoreHorizontal, Clock } from 'lucide-react'
import type { Track } from '../../shared/types.js'
import { formatTime } from '../../shared/types.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { Cover } from './Cover.js'
import { IconButton } from './IconButton.js'
import { AddToPlaylistMenu } from './AddToPlaylistMenu.js'
import './TrackList.css'

interface TrackListProps {
  tracks: Track[]
  /** 是否显示表头（序号/标题/专辑/时长） */
  showHeader?: boolean
  /** 是否显示序号列 */
  showIndex?: boolean
  /** 空状态文案 */
  emptyText?: string
  /** 附加类名 */
  className?: string
}

/**
 * 曲目列表（Apple Music 风格表格行）。
 *
 * - 单击行：以该列表为队列播放；
 * - 播放中且为当前曲目：显示跳动音柱 + 高亮；
 * - 行内提供喜欢、添加到歌单操作。
 */
export function TrackList({ tracks, showHeader = true, showIndex = true, emptyText = '暂无曲目', className }: TrackListProps) {
  const queue = usePlayer((s) => s.queue)
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const playTracks = usePlayer((s) => s.playTracks)
  const toggle = usePlayer((s) => s.toggle)

  const favorites = useLibrary((s) => s.favorites)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)

  if (!tracks.length) {
    return (
      <div className="track-list__empty">
        <Clock size={28} strokeWidth={1.5} />
        <span>{emptyText}</span>
      </div>
    )
  }

  const handleRowPlay = (index: number) => {
    const track = tracks[index]
    // 若点击的正是当前曲目：切换播放/暂停
    if (current && track.id === current.id && isSameQueue(queue, tracks)) {
      toggle()
      return
    }
    // 否则以本列表为新队列播放
    if (isSameQueue(queue, tracks)) {
      const i = queue.findIndex((t) => t.id === track.id)
      if (i >= 0) {
        usePlayer.getState().playIndex(i)
        return
      }
    }
    playTracks(tracks, index)
  }

  return (
    <div className={`track-list${className ? ` ${className}` : ''}`} role="list">
      {showHeader && (
        <div className="track-list__head">
          {showIndex && <span className="col-index">#</span>}
          <span className="col-title">标题</span>
          <span className="col-album">专辑</span>
          <span className="col-duration">
            <Clock size={14} strokeWidth={2} />
          </span>
          <span className="col-actions" />
        </div>
      )}

      {tracks.map((t, i) => {
        const isCurrent = current?.id === t.id
        const isCurrentPlaying = isCurrent && isPlaying
        const isFav = favorites.some((f) => f.id === t.id)
        return (
          <div
            key={`${t.id}-${i}`}
            className={`track-row${isCurrent ? ' track-row--current' : ''}`}
            role="listitem"
            onClick={() => handleRowPlay(i)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRowPlay(i)
            }}
          >
            {showIndex && (
              <span className="col-index">
                {isCurrentPlaying ? (
                  <span className="eq-bars" aria-hidden>
                    <i /><i /><i /><i />
                  </span>
                ) : isCurrent ? (
                  <Pause size={13} fill="currentColor" className="col-index__pause" />
                ) : (
                  <>
                    <span className="col-index__num">{i + 1}</span>
                    <Play size={13} fill="currentColor" className="col-index__play" />
                  </>
                )}
              </span>
            )}

            <span className="col-title">
              <Cover src={t.cover} alt={t.title} radius="sm" size={40} />
              <span className="col-title__text">
                <span className="col-title__name ellipsis">
                  {t.title}
                  {t.fee === 'vip' && <em className="vip-badge">VIP</em>}
                </span>
                <span className="col-title__artist ellipsis">{t.artist}</span>
              </span>
            </span>

            <span className="col-album ellipsis">{t.album}</span>

            <span className="col-duration">{t.duration ? formatTime(t.duration) : '--:--'}</span>

            <span className="col-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton
                label={isFav ? '取消喜欢' : '喜欢'}
                size="sm"
                active={isFav}
                className="row-action"
                onClick={() => toggleFavorite(t)}
              >
                <Heart size={16} strokeWidth={2} fill={isFav ? 'currentColor' : 'none'} />
              </IconButton>
              <AddToPlaylistMenu track={t}>
                {({ onClick }) => (
                  <IconButton label="添加到歌单" size="sm" className="row-action" onClick={onClick}>
                    <MoreHorizontal size={17} strokeWidth={2} />
                  </IconButton>
                )}
              </AddToPlaylistMenu>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 判断两个队列是否为同一批曲目（顺序与 ID 一致）。 */
function isSameQueue(a: Track[], b: Track[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false
  return true
}
