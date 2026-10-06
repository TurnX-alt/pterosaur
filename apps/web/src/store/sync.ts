import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MusicSource } from '@pterosaur/shared/types'

/**
 * library 云同步的**开关与记账**（本地持久化，默认关闭）。
 *
 * 单活动账号模型下，锚点是**活动账号** `<source>:<accountId>`（见 ADR-028）：
 * - `enabled`：用户是否开启云同步。
 * - `source` / `accountId`：开启时绑定的活动账号；与当前活动账号不符则自动失活（不为新账号悄然开启）。
 * - `updatedAt`：本机最后一次 library 修改时间戳，LWW（最新修改为准）的比较依据。
 *
 * 仅这三项入 localStorage；引擎的「应用云端数据中」抑制位是运行期状态，放在 `lib/sync.ts` 模块级变量。
 */
interface SyncState {
  enabled: boolean
  source?: MusicSource
  accountId?: string
  updatedAt: number
}

interface SyncActions {
  setEnabled: (enabled: boolean) => void
  /** 开启并绑定当前活动账号。 */
  enable: (source?: MusicSource, accountId?: string) => void
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
      source: undefined,
      accountId: undefined,
      updatedAt: 0,

      setEnabled: (enabled) => set({ enabled }),
      enable: (source, accountId) => set({ enabled: true, source, accountId }),
      disable: () => set({ enabled: false }),
      touch: (updatedAt) => set({ updatedAt }),
    }),
    {
      name: 'pterosaur-sync',
      partialize: (s) => ({
        enabled: s.enabled,
        source: s.source,
        accountId: s.accountId,
        updatedAt: s.updatedAt,
      }),
    },
  ),
)
