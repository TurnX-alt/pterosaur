import { useState } from 'react'
import { Disc3 } from 'lucide-react'
import './Cover.css'

interface CoverProps {
  src?: string
  alt: string
  /** 圆角风格：sm 用于列表行，md 用于卡片，lg 用于播放页 */
  radius?: 'sm' | 'md' | 'lg' | 'none'
  /** 是否为圆形（艺人头像等） */
  rounded?: boolean
  className?: string
  size?: number | string
  draggable?: boolean
}

/**
 * 封面图。带加载占位、失败兜底（显示唱片图标）。
 */
export function Cover({ src, alt, radius = 'md', rounded, className, size, draggable }: CoverProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const style: React.CSSProperties = {}
  if (size !== undefined) {
    style.width = typeof size === 'number' ? `${size}px` : size
    style.height = style.width
  }

  return (
    <div
      className={[
        'cover',
        `cover--${rounded ? 'circle' : radius}`,
        loaded && !failed ? 'cover--loaded' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={draggable ?? false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover__fallback" role="img" aria-label={alt}>
          <Disc3 size={radius === 'sm' ? 16 : 28} strokeWidth={1.5} />
        </div>
      )}
    </div>
  )
}
