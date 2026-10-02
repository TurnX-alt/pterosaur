import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
} from 'lucide-react'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useQueuePanel } from '../store/ui.js'
import { seekTo } from '../hooks/audioElement.js'
import { api } from '../api/client.js'
import { formatTime } from '../../shared/types.js'
import type { Lyric } from '../../shared/types.js'
import { Cover } from './Cover.js'
import { IconButton } from './IconButton.js'
import { Slider } from './Slider.js'
import './NowPlaying.css'

/**
 * 全屏播放页（Apple Music「正在播放」）。
 *
 * 左侧封面（带动态模糊背景），右侧同步歌词 + 控制。
 * 由 store.expanded 控制显隐，Esc 关闭。
 */
export function NowPlaying() {
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const repeat = usePlayer((s) => s.repeat)
  const shuffle = usePlayer((s) => s.shuffle)
  const toggle = usePlayer((s) => s.toggle)
  const next = usePlayer((s) => s.next)
  const prev = usePlayer((s) => s.prev)
  const cycleRepeat = usePlayer((s) => s.cycleRepeat)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const setExpanded = usePlayer((s) => s.setExpanded)

  const favorites = useLibrary((s) => s.favorites)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const isFav = current ? favorites.some((t) => t.id === current.id) : false
  const toggleQueue = useQueuePanel((s) => s.toggleQueue)

  const [lyric, setLyric] = useState<Lyric | null>(null)
  const [lyricLoading, setLyricLoading] = useState(false)

  // 拉取歌词
  useEffect(() => {
    let cancelled = false
    if (!current) {
      setLyric(null)
      return
    }
    setLyricLoading(true)
    setLyric(null)
    api
      .lyric(current.id)
      .then((l) => {
        if (!cancelled) setLyric(l)
      })
      .catch(() => {
        if (!cancelled) setLyric({ lines: [], timed: false })
      })
      .finally(() => {
        if (!cancelled) setLyricLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [current])

  // 当前高亮行下标
  const activeIndex = useMemo(() => {
    if (!lyric?.timed || !lyric.lines.length) return -1
    let idx = -1
    for (let i = 0; i < lyric.lines.length; i++) {
      if (lyric.lines[i].time <= position) idx = i
      else break
    }
    return idx
  }, [lyric, position])

  // 自动滚动到当前行
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el || activeIndex < 0) return
    const line = el.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    if (!line) return
    const target = line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2
    el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex])

  if (!current) return null

  return (
    <div className="nowplaying" role="dialog" aria-modal="true" aria-label="正在播放">
      {/* 动态模糊背景 */}
      <div className="nowplaying__bg" style={{ backgroundImage: `url(${current.cover})` }} aria-hidden />
      <div className="nowplaying__scrim" onClick={() => setExpanded(false)} aria-hidden />

      <div className="nowplaying__inner">
        <header className="nowplaying__header">
          <IconButton label="收起播放页" size="md" onClick={() => setExpanded(false)}>
            <ChevronDown size={24} strokeWidth={2.2} />
          </IconButton>
          <div className="nowplaying__header-title">
            <span>正在播放</span>
            <strong className="ellipsis">{current.album || '单曲'}</strong>
          </div>
          <IconButton label="播放队列" size="md" onClick={toggleQueue}>
            <ListMusic size={20} strokeWidth={2} />
          </IconButton>
        </header>

        <div className="nowplaying__body">
          {/* 左：封面 */}
          <div className="nowplaying__art">
            <Cover
              src={current.cover}
              alt={current.title}
              radius="lg"
              className={`nowplaying__cover${isPlaying ? ' nowplaying__cover--playing' : ''}`}
            />
          </div>

          {/* 右：歌词 + 控制 */}
          <div className="nowplaying__panel">
            <div className="nowplaying__info">
              <h1 className="nowplaying__title ellipsis">{current.title}</h1>
              <p className="nowplaying__artist ellipsis">{current.artist}</p>
            </div>

            {/* 进度 */}
            <div className="nowplaying__progress">
              <Slider
                value={position}
                max={duration || 0}
                onChange={() => {}}
                onCommit={(v) => seekTo(v)}
                disabled={!duration}
                ariaLabel="播放进度"
                size="md"
              />
              <div className="nowplaying__times">
                <span>{formatTime(position)}</span>
                <span>-{formatTime(Math.max(0, duration - position))}</span>
              </div>
            </div>

            {/* 控制 */}
            <div className="nowplaying__controls">
              <IconButton label={shuffle ? '关闭随机' : '随机播放'} size="md" active={shuffle} onClick={toggleShuffle}>
                <Shuffle size={20} strokeWidth={2} />
              </IconButton>
              <IconButton label="上一首" size="lg" onClick={prev}>
                <SkipBack size={26} strokeWidth={2} fill="currentColor" />
              </IconButton>
              <IconButton label={isPlaying ? '暂停' : '播放'} size="lg" primary onClick={toggle} className="nowplaying__play">
                {isPlaying ? <Pause size={28} strokeWidth={2.2} fill="currentColor" /> : <Play size={28} strokeWidth={2.2} fill="currentColor" />}
              </IconButton>
              <IconButton label="下一首" size="lg" onClick={next}>
                <SkipForward size={26} strokeWidth={2} fill="currentColor" />
              </IconButton>
              <IconButton
                label={repeat === 'off' ? '不循环' : repeat === 'all' ? '列表循环' : '单曲循环'}
                size="md"
                active={repeat !== 'off'}
                onClick={cycleRepeat}
              >
                {repeat === 'one' ? <Repeat1 size={20} strokeWidth={2} /> : <Repeat size={20} strokeWidth={2} />}
              </IconButton>
            </div>

            <div className="nowplaying__actions">
              <IconButton label={isFav ? '取消喜欢' : '喜欢'} size="md" active={isFav} onClick={() => toggleFavorite(current)}>
                <Heart size={22} strokeWidth={2} fill={isFav ? 'currentColor' : 'none'} />
              </IconButton>
            </div>

            {/* 歌词 */}
            <div className="nowplaying__lyrics" ref={listRef}>
              {lyricLoading ? (
                <div className="nowplaying__lyrics-empty">歌词加载中…</div>
              ) : !lyric || !lyric.lines.length ? (
                <div className="nowplaying__lyrics-empty">暂无歌词</div>
              ) : lyric.timed ? (
                lyric.lines.map((l, i) => (
                  <p
                    key={`${l.time}-${i}`}
                    data-idx={i}
                    className={`lyric-line${i === activeIndex ? ' lyric-line--active' : ''}${
                      i < activeIndex ? ' lyric-line--past' : ''
                    }`}
                    onClick={() => seekTo(l.time)}
                    role="button"
                    tabIndex={-1}
                  >
                    <span>{l.text || '♪'}</span>
                    {l.translation && <span className="lyric-line__trans">{l.translation}</span>}
                  </p>
                ))
              ) : (
                lyric.lines.map((l, i) => (
                  <p key={i} className="lyric-line lyric-line--plain">
                    {l.text}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
