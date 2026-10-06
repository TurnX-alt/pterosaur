# Spec — library 云同步（LWW）

对应模块：`server/syncStore.ts`、`server/app.ts`、`server/env.ts`、`shared/types.ts`、`web/store/sync.ts`、`web/lib/sync.ts`、`web/hooks/useLibrarySync.ts`、`web/api/client.ts`、`web/components/Topbar.tsx`、`web/App.tsx`

## 要构建什么

- 目标：登录后支持把 library（收藏 / 最近 / 自建歌单 / 收藏的网易云歌单 · 艺人 · 专辑）在**多设备间同步**。
- 交互形态：头像下拉菜单里一个「云同步」开关，默认**关闭**，位于「退出登录」**上方**；开启即自动同步，随后本地任意改动自动防抖推送。

## 行为

- 预期行为：
  - 开关默认关；开启时把当前**活动账号**（`source` + `accountId`）一并记录，并立即同步一次。
  - 激活条件：开关开启 **且** 已登录 **且** 活动账号与开启时绑定的一致；换账号自动失活。
  - 一次同步（LWW）：拉取云端 `{ state, updatedAt }`；云端更新则采用云端，否则把本地整份推上云端；云端无数据则直接推送本地。
  - 激活期间订阅 `useLibrary` 变更，约 1.5s 防抖推送；应用云端数据时抑制回声（不回推）。
  - 关闭开关仅停止同步，**不删**云端副本。
  - 服务端：`GET /api/sync/library` 返回本人 `{ payload: SyncEnvelope | null }`；`PUT` 覆盖写入；均以**访客本人的活动账号**判定身份（未登录 401）。
  - 存储：`<DATA_DIR|仓库根/.data>/sync/<source>-<账号id>.json`，原子写（tmp → rename）。

## 输入 / 输出

- 输入：开关点击；本地 library 变更事件；`GET/PUT /api/sync/library`（携带登录 cookie，body 为 `SyncEnvelope`）。
- 输出：本地 library 被云端覆盖（拉取）或云端文件被覆盖（推送）；服务端 `SyncEnvelope | null`。

## 约束

- **身份只取访客本人的活动账号**（`requireIdentity`），绝不回退缺省凭证（否则会把匿名访客当成运营者账号）。
- 冲突策略固定为 LWW（整份覆盖）；删除随整份文档同步。
- 同步范围仅 `library`，不含 `player` 播放态。
- 服务端文件型存储、零新依赖；`.data/` 不进仓库；账号键净化以杜绝路径穿越；载荷体积上限 5MB。
- 复用 `server/netease.ts` 的 `loginStatus`、`server/env.ts` 的 `ROOT_DIR`、`web/store/library.ts` 的 store。

## 边界条件

- 未登录 / 未开启：引擎不启动，无任何网络请求。
- 云端为空（首次开启）：推送本地。
- 本地 `updatedAt` 落后：采用云端（新设备首开同步即拉取）。
- 两端离线各改后重连：后推送者整份覆盖前者（LWW 预期行为，已与用户确认）。
- 换账号：绑定的活动账号与当前不符 → 失活，不为新账号悄然开启。
- 写盘失败 / 文件损坏：读返回 `null`，写 no-op，不影响其它功能。

## 验收标准

- [x] `syncStore.test.ts` 覆盖读写往返、用户隔离、缺失返回 null、形状 / 体积 / `userId` 净化校验。
- [x] `isSyncEnvelope` 只校验基础形状（宽容解析）：旧载荷缺 `savedArtists`、或含未知新字段，均判合法，避免被判非法 → 空库覆盖云端（`syncStore.test.ts`）。
- [x] `web/lib/sync.test.ts` 覆盖 `decideSync` 三分支（无云端 → 推；云端新 → 拉；本地新 / 相等 → 推）与载荷快照。
- [x] `/api/sync/library` 未登录返回 401；登录后读写本人 library（`app.test.ts` / 手动验证）。
- [x] 头像菜单开关默认关、位于「退出登录」上方；开启后另一设备登录同账号可见同步。
- [x] `pnpm --filter @pterosaur/server typecheck` 与 `apps/web` typecheck 零错误。

## 完成定义

- 如何判定已完成：单元测试全绿且类型检查零错误；手动在两浏览器（同账号）验证开启后 library 双向同步、关闭后停止、换账号失活。云同步 E2E 依赖真实扫码登录，无法自动化，以单测 + 手动验证覆盖。
