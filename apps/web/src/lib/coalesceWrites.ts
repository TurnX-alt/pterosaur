import type { PersistStorage, StorageValue } from 'zustand/middleware'

/**
 * 写合并存储。
 *
 * 在 `zustand/persist` 与真实存储之间做装饰：**同一微任务周期内的多次 `setItem` 只落盘最后一次**
 * （合并同一 tick 内的突发写入），随后立即写入底层存储——**没有时间型 debounce 的丢写窗口**。
 *
 * 为什么不使用定时 debounce：底层是异步的 IndexedDB，浏览器无法在页面卸载时保证事务提交；
 * 任何 `delay > 0` 都会让「收藏/建歌单后立刻刷新或硬跳转」丢掉最后一次写入（已由 E2E 复现）。
 * 而 IndexedDB 的写入本身不阻塞主线程，因此毋须以延迟换取性能。
 *
 * - **ordering 安全**：底层写入走串行 Promise 链，杜绝并发事务交错。
 * - 写入失败仅告警、**永不 reject**（persist 不 await 返回值，未捕获的 reject 会污染串行链）。
 * - `removeItem` 取消尚未落盘的 pending，避免清空后旧值「复活」。
 * - 另在 `pagehide` / `visibilitychange(hidden)` 兜底 flush。
 */
export interface CoalescedStorage<S> extends PersistStorage<S> {
  /** 立即落盘当前 pending 值并等待完成。 */
  flush: () => Promise<void>
}

export function coalesceWrites<S>(base: PersistStorage<S>): CoalescedStorage<S> {
  let pendingName: string | null = null
  let pendingValue: StorageValue<S> | null = null
  let queued = false
  let chain: Promise<unknown> = Promise.resolve()

  function writeNow(): Promise<void> {
    const name = pendingName
    const value = pendingValue
    pendingName = null
    pendingValue = null
    if (name === null || value === null) return chain.then(() => undefined)
    chain = chain
      .then(() => base.setItem(name, value))
      .catch((err) => {
        console.warn('[persist] 写入失败', err)
      })
    return chain.then(() => undefined)
  }

  function schedule() {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      void writeNow()
    })
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void writeNow()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void writeNow())
  }

  return {
    getItem: (name) => base.getItem(name),
    setItem: (name, value) => {
      pendingName = name
      pendingValue = value
      schedule()
      return chain.then(() => undefined)
    },
    removeItem: (name) => {
      pendingName = null
      pendingValue = null
      return base.removeItem(name)
    },
    flush: () => writeNow(),
  }
}
