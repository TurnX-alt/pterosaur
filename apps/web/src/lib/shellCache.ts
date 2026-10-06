import { registerRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

/**
 * 应用外壳（HTML / JS / CSS）的 7 天过期缓存。
 *
 * 有意**不使用 precache**：Workbox 的 precache 条目永不过期，与「外壳 7 天有效期」冲突。
 * 改为运行时缓存 + `ExpirationPlugin` —— 超过 7 天未使用的条目在下次读写时被清除并回源。
 *
 * 仅被 `sw.ts` 引用（且只在生产环境调用：dev 下 `self.__WB_MANIFEST` 不存在）。
 */

/** 应用外壳缓存有效期：7 天（秒）。 */
export const SHELL_MAX_AGE_SECONDS = 7 * 24 * 3600
/** 导航文档缓存名。 */
export const SHELL_HTML_CACHE = 'pterosaur-shell-html'
/** 静态资源（同源 script / style）缓存名。 */
export const SHELL_ASSET_CACHE = 'pterosaur-shell-assets'

/** 注册外壳路由（导航 + 同源 script/style）。 */
export function registerShellRoutes(): void {
  // 导航（HTML）：网络优先，离线回退缓存。
  // 缓存键统一归一为 /index.html —— 否则每条路由 / 查询串各占一条，离线深链无法命中。
  registerRoute(
    ({ request }) => request.mode === 'navigate',
    new NetworkFirst({
      cacheName: SHELL_HTML_CACHE,
      networkTimeoutSeconds: 3,
      plugins: [
        {
          cacheKeyWillBeUsed: async () =>
            new URL('/index.html', self.location.origin).href,
        },
        // 只缓存 200，避免把瞬时 5xx 当成外壳
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 1,
          maxAgeSeconds: SHELL_MAX_AGE_SECONDS,
        }),
      ],
    }),
  )

  // 同源 script / style（构建产物带 hash、内容不变）：后台再验证，命中即时返回。
  registerRoute(
    ({ request, url }) =>
      url.origin === self.location.origin &&
      (request.destination === 'script' || request.destination === 'style'),
    new StaleWhileRevalidate({
      cacheName: SHELL_ASSET_CACHE,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: SHELL_MAX_AGE_SECONDS,
        }),
      ],
    }),
  )
}
