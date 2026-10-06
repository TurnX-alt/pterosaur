import { Play, Shuffle, Clock, Trash2 } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { usePlayer } from '../store/player.js'
import { confirmDialog } from '../store/ui.js'
import { TrackList } from '../components/TrackList.js'
import { IconButton } from '../components/IconButton.js'
import { Empty } from '../components/States.js'

/**
 * 最近播放。展示历史曲目（最多 100 条），支持清空。
 */
export function RecentPage() {
  const recent = useLibrary((s) => s.recent)
  const clearRecent = useLibrary((s) => s.clearRecent)
  const playTracks = usePlayer((s) => s.playTracks)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  const handlePlay = (shuffle = false) => {
    if (!recent.length) return
    if (shuffle && !usePlayer.getState().shuffle) toggleShuffle()
    playTracks(recent, shuffle ? Math.floor(Math.random() * recent.length) : 0)
  }

  return (
    <div className="detail">
      <header className="detail__hero">
        <div className="recent-cover" aria-hidden>
          <Clock size={72} strokeWidth={1.6} />
        </div>
        <div className="detail__info">
          <span className="detail__type">播放记录</span>
          <h1 className="detail__name">最近播放</h1>
          <p className="detail__meta">
            <span>{recent.length} 首</span>
          </p>
        </div>
      </header>

      <div className="detail__actions">
        <button
          type="button"
          className="detail__play"
          onClick={() => handlePlay(false)}
          disabled={!recent.length}
        >
          <Play size={18} fill="currentColor" strokeWidth={0} />
          播放
        </button>
        <IconButton
          label="随机播放"
          size="lg"
          onClick={() => handlePlay(true)}
          disabled={!recent.length}
        >
          <Shuffle size={20} strokeWidth={2} />
        </IconButton>
        {recent.length > 0 && (
          <IconButton
            label="清空最近播放"
            size="lg"
            onClick={async () => {
              const ok = await confirmDialog({
                title: '清空最近播放记录？',
                message: `将删除全部 ${recent.length} 条播放记录，此操作无法撤销。`,
                confirmText: '清空',
                danger: true,
              })
              if (ok) clearRecent()
            }}
          >
            <Trash2 size={19} strokeWidth={2} />
          </IconButton>
        )}
      </div>

      <div className="detail__list">
        {recent.length === 0 ? (
          <Empty
            text="还没有播放记录，去发现一些好音乐吧"
            icon={<Clock size={32} strokeWidth={1.5} />}
          />
        ) : (
          <TrackList tracks={recent} />
        )}
      </div>
    </div>
  )
}
