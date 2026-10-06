/**
 * PWA 生命周期操作：注销、清缓存、检查更新。
 *
 * 供设置弹窗调用。**只动 Service Worker 注册与 Cache Storage，绝不触碰 IndexedDB**——
 * 资料库（收藏/歌单）与媒体缓存（音频/封面）必须保留。
 */

/** 注销全部 Service Worker 注册。 */
export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister()))
  } catch (err) {
    console.warn('[pwa] 注销 Service Worker 失败', err)
  }
}

/** 清空全部 Cache Storage（不含 IndexedDB）。 */
export async function clearAllCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  } catch (err) {
    console.warn('[pwa] 清空 Cache Storage 失败', err)
  }
}

/**
 * 硬刷新：先以 `cache: 'reload'` 绕过 HTTP 缓存重取当前文档，再 reload。
 *
 * 后端未给静态资源设 `Cache-Control`，直接 `location.reload()` 可能命中启发式缓存而拿到旧文档。
 * `reload` 可注入以便单测（jsdom 无法真实 reload）。
 */
export async function hardReload(
  reload: () => void = () => location.reload(),
): Promise<void> {
  try {
    await fetch(location.href, { cache: 'reload' })
  } catch {
    /* 忽略：无论无网络与否都继续刷新 */
  }
  reload()
}

/** 检查更新：注销 PWA + 清 Cache Storage + 硬刷新，从而拉取最新 WebApp。 */
export async function checkForUpdates(reload?: () => void): Promise<void> {
  await unregisterServiceWorkers()
  await clearAllCaches()
  await hardReload(reload)
}

/** 向当前 Service Worker 广播一条消息（无 controller 时静默）。 */
export function postToServiceWorker(data: unknown): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  navigator.serviceWorker.controller?.postMessage(data)
}
