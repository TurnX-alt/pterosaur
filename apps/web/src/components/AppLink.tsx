import { NavLink, useNavigate, type NavLinkProps } from 'react-router-dom'
import { startRouteTransition } from '../lib/viewTransition.js'

/**
 * 包装 `NavLink`：左键点击时以 View Transition 播放内容区转场，并保留 active 样式。
 *
 * 因为本项目用的是声明式路由，`<NavLink viewTransition>` 不生效，故手动拦截点击。
 * 带修饰键（新标签页等）或非左键点击时保留浏览器默认行为。
 */
export function AppLink({ to, onClick, ...rest }: NavLinkProps) {
  const navigate = useNavigate()
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        startRouteTransition(() => navigate(to, { replace: rest.replace }))
      }}
      {...rest}
    />
  )
}
