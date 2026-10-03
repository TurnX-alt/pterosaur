import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  ListMusic,
} from 'lucide-react'
import { usePlayer, currentPlayMode } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { useQueuePanel } from '../store/ui.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { seekTo } from '../hooks/audioElement.js'
import { api } from '../api/client.js'
import { formatTime } from '@pterosaur/shared/types'
import type { Lyric } from '@pterosaur/shared/types'
import { Cover } from './Cover.js'
import { IconButton } from './IconButton.js'
import { Slider } from './Slider.js'
import { PLAY_MODE_META } from './playMode.js'
import './NowPlaying.css'

interface NowPlayingProps {
  /** 是否处于展开态（退出动画期间为 false）。 */
  open: boolean
  /** 是否正在播放退出动画。 */
  exiting: boolean
}

/**
 * 全屏播放页（Apple Music「正在播放」）。
 *
 * 左侧封面（带动态模糊背景），右侧上部同步歌词、下部播放控制。
 * 常驻挂载，由 `open`/`exiting` 驱动进入 / 退出动画；Esc 关闭。
 */
export function NowPlaying({ open, exiting }: NowPlayingProps) {
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const repeat = usePlayer((s) => s.repeat)
  const shuffle = usePlayer((s) => s.shuffle)
  const toggle = usePlayer((s) => s.toggle)
  const next = usePlayer((s) => s.next)
  const prev = usePlayer((s) => s.prev)
  const cyclePlayMode = usePlayer((s) => s.cyclePlayMode)
  const setExpanded = usePlayer((s) => s.setExpanded)
  const navigate = useViewNavigate()

  /** 跳转到专辑 / 艺人页：先收起沉浸页，否则整屏浮层会盖住目标页面。 */
  const openEntity = (to: string) => {
    setExpanded(false)
    navigate(to)
  }

  const favorites = useLibrary((s) => s.favorites)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const isFav = current ? favorites.some((t) => t.id === current.id) : false
  const toggleQueue = useQueuePanel((s) => s.toggleQueue)
  const queueOpen = useQueuePanel((s) => s.queueOpen)

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

  // 自动滚动到当前行（居中）；首句未到时也保证第一行居中而非挤在顶部
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el || !lyric?.timed || !lyric.lines.length) return
    // activeIndex 为 -1 表示播放位置尚未到达第一句：用第一行作为居中参照
    const targetIdx = activeIndex < 0 ? 0 : activeIndex
    const line = el.querySelector<HTMLElement>(`[data-idx="${targetIdx}"]`)
    if (!line) return

    const pad = Math.max(0, (el.clientHeight - line.clientHeight) / 2)
    el.style.paddingTop = `${pad}px`
    el.style.paddingBottom = `${pad}px`

    if (activeIndex < 0) {
      // 第一句还没到时静默滚到顶部——padding 已使第一行居中
      el.scrollTo({ top: 0, behavior: 'instant' })
    } else {
      const elRect = el.getBoundingClientRect()
      const lineRect = line.getBoundingClientRect()
      const delta = lineRect.top - elRect.top - (el.clientHeight - line.clientHeight) / 2
      el.scrollTo({ top: el.scrollTop + delta, behavior: 'smooth' })
    }
  }, [activeIndex, lyric])

  const mode = currentPlayMode(shuffle, repeat)
  const modeMeta = PLAY_MODE_META[mode]
  const ModeIcon = modeMeta.icon

  if (!current) return null

  return (
    <div
      className={`nowplaying${exiting ? ' nowplaying--exit' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="正在播放"
      aria-hidden={!open}
    >
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
            <strong className="ellipsis">
              {current.albumId && current.album ? (
                <button
                  type="button"
                  className="nowplaying__link"
                  onClick={() => openEntity(`/album/${current.albumId}`)}
                >
                  {current.album}
                </button>
              ) : (
                current.album || '单曲'
              )}
            </strong>
          </div>
          <IconButton
            label={isFav ? '取消喜欢' : '喜欢'}
            size="md"
            active={isFav}
            onClick={() => toggleFavorite(current)}
          >
            <Heart size={20} strokeWidth={2} fill={isFav ? 'currentColor' : 'none'} />
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

          {/* 右：歌词（上）+ 控制（下） */}
          <div className="nowplaying__panel">
            <div className="nowplaying__info">
              <h1 className="nowplaying__title ellipsis">{current.title}</h1>
              <p className="nowplaying__artist ellipsis">
                {current.artistRefs?.length ? (
                  current.artistRefs.map((a, i) => (
                    <span key={`${a.id}-${i}`}>
                      {i > 0 && ' / '}
                      <button
                        type="button"
                        className="nowplaying__link"
                        onClick={() => openEntity(`/artist/${a.id}`)}
                      >
                        {a.name}
                      </button>
                    </span>
                  ))
                ) : (
                  current.artist
                )}
              </p>
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

            {/* 控制：语义与底部播放栏一致（模式合并按钮 + 队列按钮） */}
            <div className="nowplaying__controls">
              <IconButton
                label={`播放模式：${modeMeta.label}`}
                size="md"
                onClick={cyclePlayMode}
              >
                <ModeIcon size={20} strokeWidth={2} />
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
                label={queueOpen ? '关闭播放队列' : '播放队列'}
                size="md"
                active={queueOpen}
                onClick={toggleQueue}
              >
                <ListMusic size={20} strokeWidth={2} />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
