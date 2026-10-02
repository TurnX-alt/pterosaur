import { Shuffle, Repeat, Repeat1, RepeatOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PlayMode } from '../store/player.js'

/**
 * 播放模式的图标与文案（合并「随机 / 循环」为单一按钮）。
 *
 * 每种模式都有专属图标，通过图标本身区分状态——不依赖按钮的 `active`
 * 高亮（顺序播放也有独立图标，而非「未激活的循环图标」）。
 */
export const PLAY_MODE_META: Record<PlayMode, { label: string; icon: LucideIcon }> = {
  order: { label: '顺序播放', icon: RepeatOff },
  'repeat-all': { label: '列表循环', icon: Repeat },
  'repeat-one': { label: '单曲循环', icon: Repeat1 },
  shuffle: { label: '随机播放', icon: Shuffle },
}
