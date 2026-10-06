import { useEffect } from 'react'
import { useAuth, activeSource } from '../store/auth.js'

/**
 * 活动源为 **QQ** 时给 `<html>` 打 `data-source="qq"`，触发 `tokens.css` 里的**QQ 绿**强调色；
 * 其它情况（含未登录）移除该属性，回到默认强调色（见 ADR-030）。
 */
export function useSourceTheme(): void {
  const source = useAuth((s) => activeSource(s.status))
  useEffect(() => {
    const el = document.documentElement
    if (source === 'qq') el.dataset.source = 'qq'
    else delete el.dataset.source
  }, [source])
}
