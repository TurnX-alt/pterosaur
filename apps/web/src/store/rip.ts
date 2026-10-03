import { create } from 'zustand'

/**
 * 翻录（打包下载）的**全局**进度状态。
 *
 * 放在全局 store 而非页面局部 state —— 翻录是后台进行的长任务，切换页面不该丢失进度；
 * 页面只按 `job.key` 认领属于自己的那份，**重进视图即自动恢复环形进度**。
 * 不持久化：整页刷新会中止后台下载，届时状态本就该归零。
 */
export interface RipJob {
  /** 正在翻录的合集标识：`playlist:<id>` / `album:<id>` / `favorites`。 */
  key: string
  /** 已处理曲目数。 */
  current: number
  /** 总曲目数。 */
  total: number
}

interface RipState {
  /** 当前翻录任务；`null` 表示空闲。全局同一时刻至多一个。 */
  job: RipJob | null
  start: (key: string, total: number) => void
  setProgress: (current: number, total: number) => void
  finish: () => void
}

export const useRip = create<RipState>()((set, get) => ({
  job: null,
  start: (key, total) => set({ job: { key, current: 0, total } }),
  setProgress: (current, total) => {
    const job = get().job
    if (job) set({ job: { ...job, current, total } })
  },
  finish: () => set({ job: null }),
}))
