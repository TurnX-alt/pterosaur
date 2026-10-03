# Spec — 设置「重置」

对应模块：`web/lib/reset.ts`、`web/lib/idb.ts`、`web/lib/pwa.ts`、`web/lib/sync.ts`、`web/components/SettingsDialog.tsx`

## 要构建什么

- 目标：设置弹窗新增「重置」，一键清空**网页里的全部本机内容**（资料库、媒体缓存、偏好、外壳缓存），恢复出厂。
- 交互形态：设置弹窗「重置」段内的危险按钮，经二次确认后整页刷新。

## 行为

- 预期行为：
  - 点击「重置」→ 二次确认（危险）→ 清空本机内容 → 整页刷新。
  - 清空范围：IndexedDB 的 `library` / `media` / `mediaMeta` 三个 store、Cache Storage、Service Worker 注册，以及 `localStorage` / `sessionStorage`。
  - **保留登录态**：不清理网易云会话 cookie（HTTP 层），重置后仍处登录态。
  - **云同步联动**：若云同步已开启，先推送一份**空 library** 清空云端副本，再清本机（顺序不可颠倒）。

## 输入 / 输出

- 输入：设置弹窗「重置」点击与确认；可选注入的 `reload`（单测用）。
- 输出：被清空的 IDB store / Cache Storage / SW 注册 / Web Storage；一次整页刷新。

## 约束

- 以**逐 store `clear()`** 实现，而非 `indexedDB.deleteDatabase()`——生产下 Service Worker 常驻持有同一 IDB 连接，`deleteDatabase` 会被 `onblocked` 阻塞而静默失败。
- 任一清理步骤失败都不阻断其余清理与最终刷新（`Promise.allSettled`）。
- 复用 `lib/pwa.ts` 的 `clearAllCaches` / `unregisterServiceWorkers`、`lib/idb.ts` 的 `idbClear`、`lib/sync.ts` 的 `pushEmptyLibrary`。

## 边界条件

- 未开启云同步：只清本机，不触碰云端。
- 某一步清理失败：继续其余步骤并完成刷新。
- `localStorage` / `sessionStorage` 不可写（隐私模式）：忽略异常，继续刷新。
- IDB / Cache Storage / SW 不可用：对应操作静默 on-op（既有降级语义）。

## 验收标准

- [x] `reset.test.ts` 覆盖：三个 IDB store 被清、缓存 / SW 被清、Web Storage 清空、触发刷新；某步失败仍刷新。
- [x] `e2e/settings.spec.ts` 覆盖：经二次确认后整页刷新（`navigation.type === 'reload'`），种子媒体缓存与资料库被清空、`localStorage` 探针被清。
- [x] 重置后仍在登录态（不清 cookie）。
- [x] `pnpm typecheck` 与 `pnpm test` 零错误 / 全绿。

## 完成定义

- 如何判定已完成：单元测试与 E2E 覆盖重置全链路并全绿；手动确认重置后整页刷新、本机内容清空、仍处登录态；开启云同步时云端 library 亦被清空。
