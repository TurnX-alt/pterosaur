import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { Track } from '@pterosaur/shared/types'
import { streamUrl } from '@pterosaur/shared/types'

/** 根据 Content-Type 推断音频文件扩展名，默认 mp3。 */
function extFromMime(mime: string | null): string {
  if (!mime) return 'mp3'
  const m = mime.toLowerCase()
  if (m.includes('flac')) return 'flac'
  if (m.includes('wav')) return 'wav'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('aac') || m.includes('mp4') || m.includes('m4a')) return 'm4a'
  return 'mp3'
}

/** 将曲目名清洗为安全的文件名。 */
function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'track'
}

export interface DownloadProgress {
  current: number
  total: number
  /** 最近一次失败的错误信息，成功时为 null。 */
  lastError: string | null
}

/**
 * 将歌单曲目打包为 ZIP 下载。
 *
 * 逐首通过同源音频代理 `/stream/:id` 拉取字节流，文件名按序号排列
 * （如 `01 - 曲名.mp3`），最终以 browser Blob 触发保存。
 *
 * @param tracks  歌单曲目列表
 * @param onProgress  每完成/跳过一个曲目时回调
 */
export async function downloadPlaylist(
  tracks: Track[],
  zipName: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const zip = new JSZip()
  const digits = String(tracks.length).length

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    let blob: Blob | null = null
    let ext = 'mp3'

    try {
      const res = await fetch(streamUrl(t.id), { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      blob = await res.blob()
      ext = extFromMime(res.headers.get('content-type'))
    } catch (err) {
      // 单首失败跳过，继续打包其余曲目
      onProgress?.({ current: i + 1, total: tracks.length, lastError: `${t.title}: ${err instanceof Error ? err.message : '未知错误'}` })
      continue
    }

    const num = String(i + 1).padStart(digits, '0')
    const name = `${num} - ${safeName(t.title)}.${ext}`
    zip.file(name, blob)
    onProgress?.({ current: i + 1, total: tracks.length, lastError: null })
  }

  const archive = await zip.generateAsync({ type: 'blob' })
  saveAs(archive, `${safeName(zipName)}.zip`)
}