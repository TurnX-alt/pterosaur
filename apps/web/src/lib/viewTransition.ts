import { flushSync } from 'react-dom'
import { usePlayer } from '../store/player.js'
import { useQueuePanel, useCreatePlaylist, useConfirmDialog, useSidebarDrawer } from '../store/ui.js'
import { useAuth } from '../store/auth.js'

/**
 * 内容区转场（Apple Music 风格交叉溶解）。
 *
 * 说明：本项目使用**声明式 `<BrowserRouter>`**，而 react-router v7 的
 * `viewTransition` 选项只在数据路由（`RouterProvider`）下生效——声明式模式下
 * `useNavigate` 会把该选项交给 history，被其忽略（无转场、无告警）。
 * 因此这里自行调用浏览器的 `document.startViewTransition` 来实现转场。
 */

/** 内容滚动容器（路由切换时需重置滚动位置；声明式路由不会自动重置）。 */
function contentEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app-content')
}

function resetContentScroll() {
  const el = contentEl()
  if (!el) return
  // 容器带 scroll-behavior: smooth，直接改 scrollTop 会被动画化，这里临时关掉以求瞬时归零
  const prev = el.style.scrollBehavior
  el.style.scrollBehavior = 'auto'
  el.scrollTop = 0
  el.style.scrollBehavior = prev
}

/**
 * 是否存在会绘制在内容区之上的浮层。
 *
 * `::view-transition` 伪元素绘制在 top layer，会盖住 `position: fixed` 的
 * 队列面板 / 沉浸播放页 / 各类模态 / 移动端侧边栏抽屉。有浮层时直接放弃转场，
 * 避免盖层（典型表现：移动端由抽屉切换内容时，主内容跑到抽屉之上）。
 */
function hasBlockingOverlay(): boolean {
  return (
    usePlayer.getState().expanded ||
    useQueuePanel.getState().queueOpen ||
    useSidebarDrawer.getState().sidebarOpen ||
    useAuth.getState().modalOpen ||
    useCreatePlaylist.getState().open ||
    useConfirmDialog.getState().open
  )
}

/** 是否支持原生 View Transition（用于决定启用 CSS 降级进场动画）。 */
export function supportsViewTransition(): boolean {
  return typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
}

/** 用户是否偏好减少动效。 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * 在 View Transition 包裹下执行一次路由更新。
 *
 * 满足以下任一条件时直接执行（不转场）：浏览器不支持该 API、用户偏好减少动效、
 * 当前有浮层打开。`flushSync` 确保 DOM 在startViewTransition 的更新回调内同步提交，
 * 这是 React 配合 View Transitions 的官方推荐做法。
 */
export function startRouteTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || prefersReducedMotion() || hasBlockingOverlay()) {
    update()
    resetContentScroll()
    return
  }
  doc.startViewTransition(() => {
    flushSync(update)
    // 新内容就位后立即回到顶部，保证新快照从顶部开始
    resetContentScroll()
  })
}
