import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * library 云同步的**开关与记账**（本地持久化，默认关闭）。
 *
 * - `enabled`：用户是否开启云同步。
 * - `userId`：开启时绑定的网易云账号；与当前登录账号不符则自动失活（不为新账号悄然开启）。
 * - `updatedAt`：本机最后一次 library 修改时间戳，LWW（最新修改为准）的比较依据。
 *
 * 仅这三项入 localStorage；引擎的「应用云端数据中」抑制位是运行期状态，放在 `lib/sync.ts` 模块级变量。
 */
interface SyncState {
  enabled: boolean
  userId?: number
  updatedAt: number
}

interface SyncActions {
  setEnabled: (enabled: boolean) => void
  /** 开启并绑定当前账号。 */
  enable: (userId?: number) => void
  /** 关闭同步（不删云端副本）。 */
  disable: () => void
  /** 更新 LWW 时间戳。 */
  touch: (updatedAt: number) => void
}

export type SyncStore = SyncState & SyncActions

export const useSync = create<SyncStore>()(
  persist(
    (set) => ({
      enabled: false,
      userId: undefined,
      updatedAt: 0,

      setEnabled: (enabled) => set({ enabled }),
      enable: (userId) => set({ enabled: true, userId }),
      disable: () => set({ enabled: false }),
      touch: (updatedAt) => set({ updatedAt }),
    }),
    {
      name: 'pterosaur-sync',
      partialize: (s) => ({ enabled: s.enabled, userId: s.userId, updatedAt: s.updatedAt }),
    },
  ),
)
