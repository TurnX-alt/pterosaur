import { useCallback } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  Heart,
  ListMusic,
  Maximize2,
  Mic2,
} from 'lucide-react'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useQueuePanel } from '../store/ui.js'
import { seekTo } from '../hooks/audioElement.js'
import { formatTime } from '../../shared/types.js'
import { Cover } from './Cover.js'
import { IconButton } from './IconButton.js'
import { Slider } from './Slider.js'
import './PlayerBar.css'

export function PlayerBar() {
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const repeat = usePlayer((s) => s.repeat)
  const shuffle = usePlayer((s) => s.shuffle)
  const toggle = usePlayer((s) => s.toggle)
  const next = usePlayer((s) => s.next)
  const prev = usePlayer((s) => s.prev)
  const setVolume = usePlayer((s) => s.setVolume)
  const toggleMute = usePlayer((s) => s.toggleMute)
  const cycleRepeat = usePlayer((s) => s.cycleRepeat)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const setExpanded = usePlayer((s) => s.setExpanded)

  const favorites = useLibrary((s) => s.favorites)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const isFav = current ? favorites.some((t) => t.id === current.id) : false

  const queueOpen = useQueuePanel((s) => s.queueOpen)
  const toggleQueue = useQueuePanel((s) => s.toggleQueue)

  // 拖拽进度：本地即时反馈，松手才真正 seek（避免频繁请求音频）
  const handleScrub = useCallback(() => {
    /* 拖拽中的值由 Slider 内部维护，这里无需处理 */
  }, [])

  const handleSeek = useCallback((v: number) => {
    seekTo(v)
  }, [])

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <footer className="playerbar">
      {/* ---------- 左：曲目信息 ---------- */}
      <div className="playerbar__left">
        {current ? (
          <>
            <button
              type="button"
              className="playerbar__cover-btn"
              onClick={() => setExpanded(true)}
              aria-label="展开播放页"
            >
              <Cover src={current.cover} alt={current.title} radius="md" size={56} />
            </button>
            <div className="playerbar__meta">
              <div className="playerbar__title ellipsis">{current.title}</div>
              <div className="playerbar__artist ellipsis">{current.artist}</div>
            </div>
            <IconButton
              label={isFav ? '取消喜欢' : '喜欢'}
              size="sm"
              active={isFav}
              onClick={() => toggleFavorite(current)}
            >
              <Heart size={17} strokeWidth={2} fill={isFav ? 'currentColor' : 'none'} />
            </IconButton>
          </>
        ) : (
          <div className="playerbar__empty">未在播放</div>
        )}
      </div>

      {/* ---------- 中：控制 + 进度 ---------- */}
      <div className="playerbar__center">
        <div className="playerbar__controls">
          <IconButton label={shuffle ? '关闭随机播放' : '开启随机播放'} size="sm" active={shuffle} onClick={toggleShuffle}>
            <Shuffle size={17} strokeWidth={2} />
          </IconButton>
          <IconButton label="上一首" size="md" onClick={prev} disabled={!current}>
            <SkipBack size={20} strokeWidth={2} fill="currentColor" />
          </IconButton>
          <IconButton
            label={isPlaying ? '暂停' : '播放'}
            size="lg"
            primary
            onClick={toggle}
            disabled={!current}
            data-testid="play-toggle"
          >
            {isPlaying ? <Pause size={22} strokeWidth={2.2} fill="currentColor" /> : <Play size={22} strokeWidth={2.2} fill="currentColor" />}
          </IconButton>
          <IconButton label="下一首" size="md" onClick={next} disabled={!current}>
            <SkipForward size={20} strokeWidth={2} fill="currentColor" />
          </IconButton>
          <IconButton
            label={repeat === 'off' ? '不循环' : repeat === 'all' ? '列表循环' : '单曲循环'}
            size="sm"
            active={repeat !== 'off'}
            onClick={cycleRepeat}
          >
            {repeat === 'one' ? <Repeat1 size={17} strokeWidth={2} /> : <Repeat size={17} strokeWidth={2} />}
          </IconButton>
        </div>

        <div className="playerbar__progress">
          <span className="playerbar__time">{formatTime(position)}</span>
          <Slider
            value={position}
            max={duration || 0}
            onChange={handleScrub}
            onCommit={handleSeek}
            disabled={!current || !duration}
            ariaLabel="播放进度"
            size="sm"
          />
          <span className="playerbar__time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ---------- 右：音量 + 队列 + 歌词 + 展开 ---------- */}
      <div className="playerbar__right">
        <IconButton label="歌词" size="sm" onClick={() => setExpanded(true)} disabled={!current}>
          <Mic2 size={17} strokeWidth={2} />
        </IconButton>
        <IconButton label={queueOpen ? '关闭播放队列' : '播放队列'} size="sm" active={queueOpen} onClick={toggleQueue}>
          <ListMusic size={17} strokeWidth={2} />
        </IconButton>
        <IconButton label={muted ? '取消静音' : '静音'} size="sm" onClick={toggleMute} disabled={!current}>
          <VolumeIcon size={17} strokeWidth={2} />
        </IconButton>
        <div className="playerbar__volume">
          <Slider
            value={muted ? 0 : volume}
            max={1}
            onChange={(v) => setVolume(v)}
            ariaLabel="音量"
            size="sm"
          />
        </div>
        <IconButton label="展开播放页" size="sm" onClick={() => setExpanded(true)} disabled={!current}>
          <Maximize2 size={16} strokeWidth={2} />
        </IconButton>
      </div>
    </footer>
  )
}
