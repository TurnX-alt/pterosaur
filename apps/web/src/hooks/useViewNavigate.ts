import { useCallback } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'
import { startRouteTransition } from '../lib/viewTransition.js'

/**
 * 包装 `useNavigate`，让「跳转到新地址」经由 View Transition 播放内容区转场。
 *
 * 注意：`navigate(-1) / navigate(1)`（历史前进后退）依赖 `popstate` 异步更新，
 * 无法被 `startViewTransition` 同步包裹，故原样透传，不做转场。
 */
export function useViewNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to)
        return
      }
      startRouteTransition(() => navigate(to, options))
    },
    [navigate],
  )
}
