/** 1024 进制单位。 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * 把字节数格式化为人类可读字符串（1024 进制，最多一位小数）。
 *
 * 纯函数，供设置弹窗展示缓存用量。
 *
 * @example formatBytes(0) → '0 B'；formatBytes(512) → '512 B'；formatBytes(1572864) → '1.5 MB'
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  // 整数级字节（B）不带小数，其余保留一位
  return `${value.toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}`
}
