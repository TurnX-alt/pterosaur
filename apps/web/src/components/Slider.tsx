import { useCallback, useRef, useState } from 'react'
import './Slider.css'

interface SliderProps {
  /** 当前值 */
  value: number
  /** 最大值 */
  max: number
  /** 拖拽/点击变更（连续） */
  onChange: (value: number) => void
  /** 拖拽结束（用于一次性提交，如 seek） */
  onCommit?: (value: number) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 悬浮时显示把手 */
  ariaLabel: string
  /** 视觉高度档位 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 可拖拽进度条。支持鼠标与触摸，拖拽期间以本地值渲染，
 * 松手时触发 onCommit，避免与外部状态回写互相打架。
 */
export function Slider({
  value,
  max,
  onChange,
  onCommit,
  disabled,
  ariaLabel,
  size = 'md',
  className,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const [localValue, setLocalValue] = useState(value)

  const shown = dragging ? localValue : value
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0

  const valueFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || max <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * max
    },
    [max],
  )

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    const v = valueFromEvent(e.clientX)
    setDragging(true)
    setLocalValue(v)
    onChange(v)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || disabled) return
    const v = valueFromEvent(e.clientX)
    setLocalValue(v)
    onChange(v)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    const v = valueFromEvent(e.clientX)
    setDragging(false)
    onCommit?.(v)
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  return (
    <div
      ref={trackRef}
      className={[
        'slider',
        `slider--${size}`,
        dragging ? 'slider--dragging' : '',
        hover ? 'slider--hover' : '',
        disabled ? 'slider--disabled' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (disabled) return
        const step = max / 20
        if (e.key === 'ArrowRight') {
          const v = Math.min(max, (dragging ? localValue : value) + step)
          onChange(v)
          onCommit?.(v)
        } else if (e.key === 'ArrowLeft') {
          const v = Math.max(0, (dragging ? localValue : value) - step)
          onChange(v)
          onCommit?.(v)
        }
      }}
    >
      <div className="slider__rail">
        <div className="slider__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="slider__thumb" style={{ left: `${pct}%` }} />
    </div>
  )
}
