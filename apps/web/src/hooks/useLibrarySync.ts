import { useEffect } from 'react'
import { useAuth } from '../store/auth.js'
import { useSync } from '../store/sync.js'
import { startLibrarySync, syncNow } from '../lib/sync.js'

/**
 * 挂载 library 云同步引擎（在 `App` 顶层调用一次）。
 *
 * 「激活」条件：开关已开启 **且** 已登录 **且** 账号与开启时绑定的一致。
 * 激活即立即同步一次（LWW：首次在新设备上会拉取云端），并订阅本地变更做防抖推送；
 * 失活 / 卸载时退订。换账号会因 userId 不符自动失活。
 */
export function useLibrarySync(): void {
  const logged = useAuth((s) => s.status.logged)
  const userId = useAuth((s) => s.status.userId)
  const enabled = useSync((s) => s.enabled)
  const boundUserId = useSync((s) => s.userId)

  const active = enabled && logged && userId != null && userId === boundUserId

  useEffect(() => {
    if (!active) return
    void syncNow().catch((e) => console.warn('[sync] 首次同步失败', e))
    return startLibrarySync()
  }, [active])
}
