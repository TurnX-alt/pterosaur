import { useEffect, useState } from 'react'

/**
 * 让元素在「关闭」后继续挂载一段时间以播放退出动画。
 *
 * - `mounted` 以 `open` 初始化（首次关闭态不挂载）；
 * - 关闭时进入 `exiting`，并在 `exitMs` 后卸载；
 * - 定时器在 cleanup 中清除，兼容 StrictMode 双调用与快速开合。
 *
 * 注意：用定时器而非 `animationend` 兜底——`prefers-reduced-motion` 下动画时长被
 * 压到 0.01ms，但仍会触发；若实现改成 `animation: none` 则事件不触发。
 *
 * @param open 目标开合状态
 * @param exitMs 退出动画时长（毫秒）
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; exiting: boolean } {
  const [mounted, setMounted] = useState(open)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setExiting(false)
      return
    }
    // 关闭：从未挂载则无需退出流程
    if (!mounted) return
    setExiting(true)
    const timer = setTimeout(() => {
      setMounted(false)
      setExiting(false)
    }, exitMs)
    return () => clearTimeout(timer)
    // mounted 故意不入依赖：仅在 open/exitMs 变化时重跑，读取当次渲染的最新 mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs])

  return { mounted, exiting }
}
