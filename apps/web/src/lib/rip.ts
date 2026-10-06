import type { AudioLevel, Track } from '@pterosaur/shared/types'
import { downloadPlaylist } from './downloadPlaylist.js'
import { useRip } from '../store/rip.js'

/** 是否有翻录正在进行（全局同一时刻至多一个）。 */
export function isRipping(): boolean {
  return useRip.getState().job !== null
}

/**
 * 启动一次翻录（全局单任务）。
 *
 * 进度写入 {@link useRip} 全局 store，因此**切换页面再回来仍能恢复环形进度**；下载在后台继续，
 * 不随发起组件卸载而中止。若已有翻录未结束，直接忽略本次调用（避免并发翻录）。
 */
export async function runRip(opts: {
  /** 合集标识，与页面的 `RipJob.key` 对应。 */
  key: string
  tracks: Track[]
  /** ZIP 文件名（不含扩展名）。 */
  zipName: string
  /** 可选封面地址（专辑翻录）。 */
  coverUrl?: string
  /** 音质档位；缺省时由后端兜底。 */
  level?: AudioLevel
}): Promise<void> {
  if (useRip.getState().job) return
  useRip.getState().start(opts.key, opts.tracks.length)
  try {
    await downloadPlaylist(
      opts.tracks,
      opts.zipName,
      (p) => useRip.getState().setProgress(p.current, p.total),
      opts.coverUrl,
      opts.level,
    )
  } finally {
    useRip.getState().finish()
  }
}
