import type { LibraryData, SyncEnvelope } from '@pterosaur/shared/types'
import { api } from '../api/client.js'
import { useLibrary } from '../store/library.js'
import { useSync } from '../store/sync.js'

/**
 * library 云同步引擎（LWW：最新修改为准）。
 *
 * 冲突策略：整份 library 各附带一个 `updatedAt`，每次同步比较本地与云端——
 * 云端更新则采用云端，否则把本地推上去。删除随整份文档一并同步。
 *
 * 纯决策函数 {@link decideSync} 与载荷快照 {@link snapshotLibrary} 便于单测；
 * 其余函数读写 store / 发请求。
 */

/** LWW 决策：无云端数据 → 推送；云端更新 → 采用云端；否则推送本地。 */
export function decideSync(
  localUpdatedAt: number,
  server: SyncEnvelope | null,
): 'push' | 'pull' {
  if (!server) return 'push'
  return server.updatedAt > localUpdatedAt ? 'pull' : 'push'
}

/** 从 library store 抽出可同步的数据字段。 */
export function snapshotLibrary(): LibraryData {
  const s = useLibrary.getState()
  return {
    favorites: s.favorites,
    recent: s.recent,
    playlists: s.playlists,
    savedPlaylists: s.savedPlaylists,
    savedArtists: s.savedArtists,
    savedAlbums: s.savedAlbums,
  }
}

/** 空 library（重置时用于清空云端副本）。 */
export function emptyLibrary(): LibraryData {
  return {
    favorites: [],
    recent: [],
    playlists: [],
    savedPlaylists: [],
    savedArtists: [],
    savedAlbums: [],
  }
}

/**
 * 抑制位：把云端数据写入本地时置位，避免 library 订阅把它当成「本地修改」又推回云端（回声）。
 * 放在模块级（而非 store）以免被持久化。
 */
let applying = false

/** 把云端载荷写入本地 library（随 persist 落盘），期间抑制变更回推。 */
export function applyPayload(
  state: Partial<LibraryData>,
  updatedAt: number,
): void {
  applying = true
  try {
    // 以空库为底、用云端载荷覆盖：云端可能来自旧版本、缺后续新增字段，缺省处即回落空值。
    // 不逐字段枚举——新增字段随 `emptyLibrary()` 自动获得默认值，避免校验逻辑随字段增长而污染。
    useLibrary.setState({ ...emptyLibrary(), ...state })
    useSync.getState().touch(updatedAt)
  } finally {
    applying = false
  }
}

/** 拉取云端载荷（未登录 / 无数据返回 null）。 */
export async function pullLibrary(): Promise<SyncEnvelope | null> {
  const { payload } = await api.syncGet()
  return payload
}

/** 把当前本地 library 推送到云端，并将 `updatedAt` 推进到 `now`。 */
export async function pushLibrary(now = Date.now()): Promise<void> {
  useSync.getState().touch(now)
  await api.syncPut({ state: snapshotLibrary(), updatedAt: now })
}

/** 推送一份全新的空 library（重置时清空云端副本）。 */
export async function pushEmptyLibrary(now = Date.now()): Promise<void> {
  useSync.getState().touch(now)
  await api.syncPut({ state: emptyLibrary(), updatedAt: now })
}

/** 执行一次同步：按 LWW 决定拉取或推送。 */
export async function syncNow(): Promise<void> {
  const local = useSync.getState().updatedAt
  const server = await pullLibrary()
  if (server && decideSync(local, server) === 'pull') {
    applyPayload(server.state, server.updatedAt)
  } else {
    await pushLibrary()
  }
}

/**
 * 订阅本地 library 变更 → 防抖推送到云端；返回取消订阅函数。
 *
 * @param delayMs 防抖时长；同一窗口内的多次变更只推最后一次。
 */
export function startLibrarySync(delayMs = 1500): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = useLibrary.subscribe(() => {
    if (applying) return
    // 立即推进本地时间戳（确保随后若发生拉取比较，本地不落后）
    useSync.getState().touch(Date.now())
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void pushLibrary().catch((e) =>
        console.warn('[sync] 推送 library 失败', e),
      )
    }, delayMs)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
