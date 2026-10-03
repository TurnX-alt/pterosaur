# AGENTS.md

Pterosaur —— 仿 Apple Music 的网页音乐播放器（React 19 + Vite 前端，Hono 后端代理网易云音源）。本文件帮助 Agent 快速定位项目结构与约定；产品与架构细节见 `docs/`。

## 概述

- 本项目是什么：自托管网页音乐播放器。前端负责发现/搜索/播放体验，后端负责把网易云的搜索、元数据、歌词与音频流代理成同源接口，并在用户登录后透传会话以解锁 VIP 曲目。

## 边界与范围

- 范围内：
  - 前端播放体验（首页/浏览/电台/搜索/歌单/资料库/播放队列/全屏歌词）。
  - 后端 API 代理与音频串流（含 Range 分段）、网易云扫码/手机号登录与会话透传。
- 非目标（明确排除）：
  - 不做纯静态部署——音频代理与登录必须有 Node 后端。
  - 不自建音源或存储音频文件，全部实时解析网易云。
  - 不做多用户账号体系；登录态即用户本人的网易云会话，仅存于其浏览器 cookie。

## Agent 操作指南

- 如何理解本项目：
  - 先读 `docs/ARCHITECTURE.md` 建立整体结构认知，再读 `docs/DECISIONS.md` 了解关键技术选型原因（尤其是「为什么需要后端代理」）。
  - 前后端共享类型定义在 `packages/shared/`（`@pterosaur/shared`），改动数据模型时**必须同时考虑浏览器与 Node 两侧**。
- 全局规则 / 约定：
  - **同源代理铁律**：前端永远不直连网易云域名；所有网络请求走 `/api/*` 与 `/stream/*`。新增音源能力时在后端加路由，前端只调本域接口。
  - **音频地址必须 https**：网易云返回 `http://` 音频地址，后端已统一改写为 `https://`，不要在浏览器侧直接使用原始地址（会触发混合内容拦截）。
  - **NeteaseCloudMusicApi 参数是扁平的**：如 `api.cloudsearch({ keywords, limit })`，不是嵌套 `{ query: {...} }`；其返回的 `cookie` 是「Set-Cookie 字符串数组」，透传逻辑见 `apps/server/src/netease.ts`。
  - 状态管理：播放状态在 `apps/web/src/store/player.ts`，收藏/最近播放/本地歌单在 `library.ts`，登录态在 `auth.ts`，临时 UI（队列面板开合）在 `ui.ts`。持久化统一用 zustand `persist`：**`library` 走 IndexedDB**（`lib/libraryStorage.ts`，异步 + 写合并 + 旧 localStorage 一次性迁移，见 ADR-011），`player` / `theme` 仍用 localStorage。改 `library` 时务必同步其 `partialize`——IDB 的 structured clone 不能克隆 action 函数。
  - PWA / 缓存：`vite-plugin-pwa`（配置在 `apps/web/vite.config.ts`，`injectManifest`）把现有手写 SW（`apps/web/src/sw.ts`）作为**唯一** Service Worker 构建为 `sw.js`（IIFE）；`build` 就是单条 `vite build`，**已无第二步 SW 构建**。SW 承担三类互不相交的职责：`/stream/*` 音频与封面图片（`destination === 'image'`，CORS 拉取）写入**同一个** IndexedDB 池（共用 16GB LRU；逻辑在 `lib/mediaCache.ts`，低层封装 `lib/idb.ts`），生产下另经 Workbox 缓存应用外壳、**7 天过期**（`lib/shellCache.ts`）。IDB 库为 v2（`media`/`mediaMeta`）。PWA 生命周期操作（注销 / 清 Cache Storage / 硬刷新）在 `lib/pwa.ts`，均由顶栏设置弹窗调用。
  - 播放进度 seek 用 `apps/web/src/hooks/audioElement.ts` 的 `seekTo()` 命令式处理，**不要**直接写 store.position（会与音频回写打架）。
  - 样式：设计令牌集中在 `apps/web/src/styles/tokens.css`，组件样式与组件同名 `.css` 并排存放。新增颜色/间距优先用 CSS 变量。
  - 测试：单元/组件测试与被测文件并排（`*.test.ts[x]`）；E2E 在 `e2e/`。改动核心播放逻辑（队列/循环/随机）必须补 `apps/web/src/store/player.test.ts` 用例。
  - 提交信息遵循 Conventional Commits：type/scope 用英文，描述用简体中文；作者为 `杏仁鹿 <krkr@xrl.im>`。

## 目录速查

- `apps/server/` — Hono 后端（`@pterosaur/server`）：`src/index.ts` 入口与静态托管，`src/app.ts` 路由，`src/netease.ts` 网易云 API 封装与归一化，`tsup.config.ts` 为 tsup 构建配置。
- `apps/web/` — React 19 前端：`src/` 下为 SPA 源码，`vite.config.ts` 为 Vite 构建配置。
- `packages/shared/` — 前后端共享（`@pterosaur/shared`）：`src/types.ts` 数据模型与工具，`src/lyric.ts` LRC 歌词解析。
- `apps/web/src/api/` — 前端 API 客户端（`client.ts`）。
- `apps/web/src/store/` — Zustand 状态：`player` / `library` / `auth` / `ui`。
- `apps/web/src/hooks/` — `useAudioEngine`（音频引擎）、`useKeyboardShortcuts`、`useTheme`、`useAsync`、`audioElement`（单例 audio 与 seek）。
- `apps/web/src/lib/` — 非组件工具：`idb`（低层 IndexedDB）、`coalesceWrites`（写合并）、`libraryStorage`（library 的 IDB 持久化）、`mediaCache`（音频 + 封面的媒体缓存与 LRU）、`shellCache`（应用外壳 7 天过期缓存）、`pwa`（注销 / 清缓存 / 硬刷新）、`formatBytes`、`download`/`downloadPlaylist`、`viewTransition`。
- `apps/web/src/sw.ts` — 应用 Service Worker（音频 + 封面 IDB 缓存 + 生产下外壳 Workbox 缓存；由 vite-plugin-pwa 构建为 `sw.js`）。
- `apps/web/src/components/` — UI 组件（Sidebar / Topbar / PlayerBar / NowPlaying / QueuePanel / TrackList / LoginModal 等）及其样式。
- `apps/web/src/pages/` — 路由页面（Home / Browse / Radio / Search / Playlist / Library / Favorites / Recent）。
- `apps/web/src/styles/` — 全局样式与设计令牌。
- `e2e/` — Playwright 端到端测试。
- `docs/` — PRD / ARCHITECTURE / DECISIONS / specs。
