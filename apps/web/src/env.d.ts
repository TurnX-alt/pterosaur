/// <reference types="vite/client" />

/** 构建期注入的当前 commit 短哈希（前 7 位）。见 `vite.config.ts` 的 `define`。 */
declare const __COMMIT_HASH__: string

/**
 * Workbox `injectManifest` 构建期注入的 precache 清单。
 *
 * 以 `Window` 增强声明，使 SW 源码里能**逐字**写出 `self.__WB_MANIFEST`（workbox-build 的注入点）——
 * 不要改写成 `globalThis.*` 或自定义别名，否则构建会报「找不到注入点」。
 */
interface Window {
  __WB_MANIFEST?: Array<string | { url: string; revision: string | null }>
}
