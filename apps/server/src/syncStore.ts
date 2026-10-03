import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncEnvelope } from '@pterosaur/shared/types'
import { ROOT_DIR } from './env.js'

/**
 * 云同步的服务端持久化：**文件型**存储，按访客本人 `userId` 隔离。
 *
 * - 目录：`process.env.DATA_DIR ?? <仓库根>/.data`，文件 `<DATA_DIR>/sync/<userId>.json`。
 * - 原子写：先写 `*.tmp` 再 `rename`，避免进程中断写出半个文件。
 * - 读写一律 try/catch，失败降级（读 → `null`，写 → no-op），绝不因存储层异常拖垮请求。
 *
 * 注意：这是 Pterosaur「无状态后端」原则的**有意例外**（见 ADR-016）——服务端开始持久化
 * **访客本人**的资料库数据（此前只持久化运营者的缺省凭证）。`userId` 由访客 cookie 解析，
 * 每个用户只能读写自己的文件。
 */

/** 单个用户载荷的体积上限（5MB）；超出视为异常请求拒绝。 */
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024

/** 解析数据根目录（可被 `DATA_DIR` 覆盖，便于测试或自定义部署）。 */
export function dataDir(dir = process.env.DATA_DIR): string {
  return dir && dir.trim() ? dir : join(ROOT_DIR, '.data')
}

/** 某用户的 library 文件路径。 */
function fileFor(userId: string, dir?: string): string {
  return join(dataDir(dir), 'sync', `${sanitizeId(userId)}.json`)
}

/** 只允许数字 / 字母 / `_` / `-`，杜绝路径穿越。 */
function sanitizeId(userId: string): string {
  const safe = String(userId).replace(/[^0-9A-Za-z_-]/g, '')
  if (!safe) throw new Error('非法的 userId')
  return safe
}

const COLLECTIONS = ['favorites', 'recent', 'playlists', 'savedPlaylists', 'savedAlbums'] as const

/** 形状校验：`{ state: LibraryData, updatedAt: number }`。 */
export function isSyncEnvelope(v: unknown): v is SyncEnvelope {
  if (!v || typeof v !== 'object') return false
  const { state, updatedAt } = v as { state?: unknown; updatedAt?: unknown }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return false
  if (!state || typeof state !== 'object') return false
  return COLLECTIONS.every((k) => Array.isArray((state as Record<string, unknown>)[k]))
}

/** 读取某用户的 library；不存在或损坏时返回 `null`。 */
export async function readLibrary(userId: string, dir?: string): Promise<SyncEnvelope | null> {
  try {
    const raw = await readFile(fileFor(userId, dir), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isSyncEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 写入某用户的 library（原子写）。
 *
 * @throws 当载荷非法或超过 {@link MAX_PAYLOAD_BYTES} 时抛出，供路由层回 400。
 */
export async function writeLibrary(userId: string, envelope: SyncEnvelope, dir?: string): Promise<void> {
  if (!isSyncEnvelope(envelope)) throw new Error('非法的同步载荷')
  const json = JSON.stringify(envelope)
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('同步载荷过大')

  const target = fileFor(userId, dir)
  const tmp = `${target}.tmp`
  await mkdir(join(dataDir(dir), 'sync'), { recursive: true })
  await writeFile(tmp, json, 'utf8')
  await rename(tmp, target)
}

/** 清空某用户的 library（删除文件）；不存在时静默。 */
export async function clearLibrary(userId: string, dir?: string): Promise<void> {
  await rm(fileFor(userId, dir), { force: true })
}
