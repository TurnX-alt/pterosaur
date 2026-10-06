import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  saveCurrentScroll,
  savedScroll,
  setCurrentScrollKey,
} from '../lib/scrollMemory.js'

/** 内容区滚动容器（与 `lib/viewTransition.ts` 的 `contentEl` 指向同一元素）。 */
function contentEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app-content')
}

/** 瞬时设置滚动位置：容器带 `scroll-behavior: smooth`，临时关掉以免恢复过程被动画化。 */
function setScroll(el: HTMLElement, top: number): void {
  const prev = el.style.scrollBehavior
  el.style.scrollBehavior = 'auto'
  el.scrollTop = top
  el.style.scrollBehavior = prev
}

/**
 * 让内容区按历史条目恢复滚动位置。
 *
 * 以 `location.key` 为键：前进得到新 key（回到顶部），后退 / 前进复用旧 key（恢复原位置）。
 * 于是在同一页不断下钻后返回会回到原处，而从侧边栏新开则从头开始。
 *
 * 布局期（`useLayoutEffect`）同步完成「切换当前条目 key → 恢复该条目位置」：
 * 切换 key 早于随后的滚动（`resetContentScroll` 归零、View Transition 的新快照），
 * 使这些滚动被正确归到**新**条目名下，而旧条目已由滚动监听记下其离开前的真实位置。
 */
export function useContentScrollRestoration(): void {
  const { key } = useLocation()

  useLayoutEffect(() => {
    const el = contentEl()
    if (!el) return
    // 提交即切换「当前条目」——早于随后的 resetContentScroll / 快照，确保归属正确
    setCurrentScrollKey(key)
    setScroll(el, savedScroll(key))
    // 内容异步撑高（首次加载）时滚动可能被钳制，下一帧再补一次
    const raf = requestAnimationFrame(() => {
      const cur = contentEl()
      if (cur) setScroll(cur, savedScroll(key))
    })
    return () => {
      // 仅取消补帧。**不在此保存**：React 先换 DOM 再跑布局 effect 清理，此时读到的
      // 已是新内容钳制后的值（如切到矮页面会被压成 0），会覆盖掉正确记录。
      cancelAnimationFrame(raf)
    }
  }, [key])

  // 持续记录当前条目的滚动（单一监听，按 currentKey 归属，避免逐条目挂监听的切换竞态）
  useEffect(() => {
    const el = contentEl()
    if (!el) return
    const onScroll = () => saveCurrentScroll(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
}
