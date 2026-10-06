import { flushSync } from 'react-dom'
import {
  supportsViewTransition,
  prefersReducedMotion,
  nextFrame,
} from './viewTransition.js'

/**
 * 主题切换的根转场（View Transitions）。
 *
 * 新主题从 `origin`（主题按钮中心）以圆形「揭示」覆盖旧主题，而非整页瞬时换色或简单渐变。
 * 做法：转场期间把根的 `view-transition-name` 从 `none` 恢复为默认（见 global.css 的
 * `:root:not([data-theme-vt])`），由 `::view-transition-new(root)` 上的 `theme-reveal`
 * 关键帧做 `clip-path: circle()` 扩散；圆心与半径经 `--theme-vt-x/-y/-r` 由本函数注入。
 *
 * 不支持该 API、或用户偏好减少动效时，退化为直接的同步切换。
 */

/** View Transitions API 的最小结构（避免依赖 lib 是否含 `ViewTransition` 类型）。 */
interface ViewTransitionLike {
  finished: Promise<void>
  skipTransition: () => void
}

/** 当前进行中的主题转场（用于连点保护）。 */
let active: ViewTransitionLike | null = null

/**
 * 在圆形揭示转场下切换主题。
 *
 * @param origin 揭示圆心（视口坐标，取主题按钮中心）
 * @param apply  实际切换主题的同步更新（内部以 flushSync 提交）
 */
export function startThemeTransition(
  origin: { x: number; y: number },
  apply: () => void,
): void {
  if (!supportsViewTransition() || prefersReducedMotion()) {
    flushSync(apply)
    return
  }

  const root = document.documentElement
  // 覆盖整个视口所需半径（圆心到最远角）
  const r = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  )
  root.style.setProperty('--theme-vt-x', `${origin.x}px`)
  root.style.setProperty('--theme-vt-y', `${origin.y}px`)
  root.style.setProperty('--theme-vt-r', `${r}px`)
  // 必须在 startViewTransition 之前就绪：旧快照拍摄时 CSS 需已命名根、并摘掉 .app-content 的命名
  root.dataset.themeVt = 'on'

  // 连点：丢弃上一段未完成的转场，避免两段叠加
  active?.skipTransition()

  const doc = document as Document & {
    startViewTransition: (cb: () => void) => ViewTransitionLike
  }
  let transition: ViewTransitionLike
  try {
    // 回调同步提交（不 await 任何东西：await rAF 会在转场期间死锁）
    transition = doc.startViewTransition(() => {
      flushSync(apply)
    })
  } catch {
    // 抛错（如文档非 fully-active）：清掉瞬态标记与揭示变量，回退为直接切换，避免永久残留
    delete root.dataset.themeVt
    clearRevealVars(root)
    flushSync(apply)
    return
  }
  active = transition

  // finished 在 skipTransition 时会以 AbortError reject，两分支都要清理；
  // 且只清理「仍是当前这段」的标记，避免被已 skip 的旧转场误删。
  //
  // 标记的清除**推迟到下一帧**：`finished` 解析时伪树仍在拆除，此刻改样式会触发快照重建
  // （内容区封面落在旧几何、滚动/点击后才复位），故等拆除完毕再动。
  const done = () =>
    nextFrame(() => {
      if (active !== transition) return
      active = null
      delete root.dataset.themeVt
      clearRevealVars(root)
    })
  transition.finished.then(done, done)
}

/** 清除主题揭示用的圆心 / 半径变量（生命周期结束时清理，避免长期残留）。 */
function clearRevealVars(root: HTMLElement): void {
  root.style.removeProperty('--theme-vt-x')
  root.style.removeProperty('--theme-vt-y')
  root.style.removeProperty('--theme-vt-r')
}
