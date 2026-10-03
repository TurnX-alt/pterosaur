/// <reference types="vite/client" />

/** 构建期注入的当前 commit 短哈希（前 7 位）。见 `vite.config.ts` 的 `define`。 */
declare const __COMMIT_HASH__: string
