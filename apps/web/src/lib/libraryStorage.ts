import type { PersistStorage, StorageValue } from 'zustand/middleware'
import type { LibraryState } from '../store/library.js'
import { LIBRARY_STORE, idbDelete, idbGet, idbPut } from './idb.js'
import { coalesceWrites } from './coalesceWrites.js'

/**
 * library store 的 IndexedDB 持久化适配器。
 *
 * - **免 JSON**：IDB 原生 structured clone 直接存对象（配合 store 的 `partialize`
 *   只持久化数据字段，避免克隆 action 函数导致 `DataCloneError`）。
 * - **一次性迁移**：旧版 localStorage 键被读取、写入 IDB 后删除；键的存亡即幂等标记。
 * - **写合并**：外层包裹 {@link coalesceWrites}，避免每次切歌/收藏都全量落盘。
 */

/** 旧版 localStorage 键名，也是 persist 的 `name`。 */
const LEGACY_KEY = 'pterosaur-library'

/** 校验 persist 封套形状 `{state, version}`。 */
function isStorageValue(v: unknown): v is StorageValue<LibraryState> {
  if (!v || typeof v !== 'object') return false
  const state = (v as { state?: unknown }).state
  return !!state && typeof state === 'object'
}

const base: PersistStorage<LibraryState> = {
  async getItem(name) {
    // 1) 一次性迁移：旧 localStorage 数据 -> IDB，并删除旧键（幂等）
    const legacy =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(LEGACY_KEY)
        : null
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy)
        if (isStorageValue(parsed)) {
          await idbPut(LIBRARY_STORE, parsed, name)
          localStorage.removeItem(LEGACY_KEY)
          return parsed
        }
      } catch {
        /* 脏数据：忽略 */
      }
      // 非法数据也清除，避免每次读取都重试
      localStorage.removeItem(LEGACY_KEY)
    }

    // 2) 常规读取
    const value = await idbGet<StorageValue<LibraryState>>(LIBRARY_STORE, name)
    return value ?? null
  },

  setItem: (name, value) => idbPut(LIBRARY_STORE, value, name),
  removeItem: (name) => idbDelete(LIBRARY_STORE, name),
}

/** 已套用写合并的 library 存储。 */
export const libraryStorage = coalesceWrites(base)

/** 立即把待写入的 library 数据落盘（供卸载/测试调用）。 */
export const flushLibraryWrites = libraryStorage.flush
