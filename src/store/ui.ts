import { create } from 'zustand'

/**
 * 临时 UI 状态（不持久化）：队列面板开合等。
 *
 * 与播放状态（player store）、资料库（library store）分离，
 * 避免浮层开合这类高频临时状态污染需要持久化的存储。
 */
interface UiState {
  /** 右侧播放队列面板是否打开。 */
  queueOpen: boolean
  toggleQueue: () => void
  setQueueOpen: (v: boolean) => void
}

export const useQueuePanel = create<UiState>()((set) => ({
  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setQueueOpen: (v) => set({ queueOpen: v }),
}))
