import { useEffect } from 'react'
import { useAuth, activeSource } from '../store/auth.js'
import { useSync } from '../store/sync.js'
import { startLibrarySync, syncNow } from '../lib/sync.js'

/**
 * 挂载 library 云同步引擎（在 `App` 顶层调用一次）。
 *
 * 「激活」条件：开关已开启 **且** 已登录 **且** 活动账号与开启时绑定的一致（单活动账号，锚点 `<源>:<账号id>`）。
 * 激活即立即同步一次（LWW：首次在新设备上会拉取云端），并订阅本地变更做防抖推送；
 * 失活 / 卸载时退订。换账号会因绑定不符自动失活。
 */
export function useLibrarySync(): void {
  const status = useAuth((s) => s.status)
  const enabled = useSync((s) => s.enabled)
  const boundSource = useSync((s) => s.source)
  const boundAccountId = useSync((s) => s.accountId)

  const source = activeSource(status)
  const accountId = source ? status[source]?.userId : undefined

  const active =
    enabled && source != null && accountId != null && source === boundSource && accountId === boundAccountId

  useEffect(() => {
    if (!active) return
    void syncNow().catch((e) => console.warn('[sync] 首次同步失败', e))
    return startLibrarySync()
  }, [active])
}
