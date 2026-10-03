import { DiscAlbum } from 'lucide-react'
import { IconButton } from './IconButton.js'
import './RipButton.css'

/** 翻录进度：已处理曲目数 / 总曲目数。 */
export interface RipProgress {
  current: number
  total: number
}

interface RipButtonProps {
  /** 无曲目时置灰（仅在空闲态生效）。 */
  disabled?: boolean
  /** 进行中的进度；`null` 表示空闲，渲染「翻录」图标按钮。 */
  progress: RipProgress | null
  onClick: () => void
}

const RING_SIZE = 48
const RING_R = 20
const RING_STROKE = 3
/** 环周长，用于把进度换算成 dashoffset。 */
const CIRCUMFERENCE = 2 * Math.PI * RING_R

/**
 * 「翻录」按钮。
 *
 * 空闲时是下载图标按钮；进行中**就地**变为环形进度条，环内显示「已完成/总数」。
 * 歌单 / 我喜欢的音乐 / 专辑三页共用，保证翻录反馈一致。
 */
export function RipButton({ disabled, progress, onClick }: RipButtonProps) {
  if (!progress) {
    return (
      <IconButton label="翻录" size="lg" onClick={onClick} disabled={disabled}>
        <DiscAlbum size={19} strokeWidth={2} />
      </IconButton>
    )
  }

  const total = Math.max(0, progress.total)
  const current = Math.min(Math.max(0, progress.current), total)
  const ratio = total > 0 ? current / total : 0
  const center = RING_SIZE / 2

  return (
    <div
      className="rip-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`正在翻录 ${current} / ${total}`}
      title={`正在翻录 ${current} / ${total}`}
      data-testid="rip-progress"
    >
      <svg
        className="rip-progress__svg"
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        width={RING_SIZE}
        height={RING_SIZE}
        aria-hidden
      >
        <circle
          className="rip-progress__track"
          cx={center}
          cy={center}
          r={RING_R}
          fill="none"
          strokeWidth={RING_STROKE}
        />
        <circle
          className="rip-progress__bar"
          cx={center}
          cy={center}
          r={RING_R}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="rip-progress__text">
        {current}/{total}
      </span>
    </div>
  )
}
