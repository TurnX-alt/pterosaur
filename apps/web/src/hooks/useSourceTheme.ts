import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth, activeSource } from '../store/auth.js'
import {
  DEFAULT_SOURCE,
  isMusicSource,
  type LoginStatus,
  type MusicSource,
} from '@pterosaur/shared/types'

/** 实体路由 `/playlist|artist|album/:source/:id`（2 段式别名时首段是 id，会被 `isMusicSource` 滤掉）。 */
const ENTITY_ROUTE = /^\/(?:playlist|artist|album)\/([^/]+)/

/**
 * 当前所处「源」：实体路由 / 搜索显式带源时**以路由为准**（无论是否登录），
 * 否则跟随**活动账号**（未登录回落缺省源）。
 *
 * 之所以不能只看活动账号：**咪咕无登录**、永远不会成为活动账号，
 * 若只认活动账号，咪咕内容页就永远拿不到自己的主题色（见 ADR-032）。
 */
function currentSource(
  pathname: string,
  search: string,
  status: Record<MusicSource, LoginStatus>,
): MusicSource {
  const m = ENTITY_ROUTE.exec(pathname)
  if (m && isMusicSource(m[1])) return m[1]
  if (pathname === '/search') {
    const s = new URLSearchParams(search).get('source')
    if (isMusicSource(s)) return s
  }
  return activeSource(status) ?? DEFAULT_SOURCE
}

/**
 * 给 `<html>` 打 `data-source="<源>"`，触发 `tokens.css` 里对应的强调色
 * （默认红 / QQ 绿 / 咪咕洋红，见 ADR-030 / ADR-032）。
 */
export function useSourceTheme(): void {
  const location = useLocation()
  const status = useAuth((s) => s.status)
  const source = currentSource(location.pathname, location.search, status)
  useEffect(() => {
    document.documentElement.dataset.source = source
  }, [source])
}
