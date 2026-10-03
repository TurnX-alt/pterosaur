# ARCHITECTURE — Pterosaur

## 系统概述

Pterosaur 分三层：浏览器前端（React SPA）、同源 Hono 后端（API + 音频代理）、网易云上游服务。前端从不直连网易云，所有外部数据都经后端代理，从而规避浏览器的跨域与 `http://` 混合内容限制，并在登录态下透传会话以解锁 VIP。

```
┌───────────────────────────────────────────────────────────────┐
│ 浏览器 (React 19 SPA)                                           │
│                                                                 │
│  pages/ ──► components/ ──► store (zustand)                     │
│                                  │                              │
│                    hooks/useAudioEngine  ◄── <audio> 单例        │
│                                  │                              │
│                    api/client.ts（fetch，同源）                  │
└──────────────┬───────────────────────────────┬─────────────────┘
               │ /api/*  (JSON)                │ /stream/:id (音频, Range)
               ▼                               ▼
┌───────────────────────────────────────────────────────────────┐
│ Hono 后端 (@hono/node-server)  —— 生产下同时托管 dist/ 静态资源   │
│                                                                 │
│  app.ts (路由)  ──► netease.ts (封装 + 归一化 + https 改写)      │
│                         │                                       │
│                    lru-cache（音频地址缓存，TTL 15min）          │
└──────────────┬──────────────────────────────────────────────────┘
               ▼
   NeteaseCloudMusicApi ──► 网易云音乐上游（搜索/歌词/歌单/音频 CDN/登录）
```

开发期由 Vite 把 `/api`、`/stream` 代理到后端（`vite.config.ts`）；生产期由同一 Hono 进程既发静态资源又发 API（`server/index.ts`），始终单一同源。

## 核心模块

| 模块 | 职责 |
|------|------|
| `server/app.ts` | 定义全部 HTTP 路由：搜索（单曲 + 多类型 `/api/search/all`）、艺人 / 专辑详情、发现、歌单、歌词、登录、音频流代理；统一 `ApiResult` 包裹与错误处理 |
| `server/netease.ts` | 封装 `NeteaseCloudMusicApi`，把网易云原始结构归一化为共享模型（含艺人引用 / 专辑 id），改写封面 / 音频为 https（缩略参数兼容已有查询串），解析 Set-Cookie 会话 |
| `server/index.ts` | 服务入口：生产模式挂载静态资源与 SPA 回退，启动 HTTP 服务 |
| `shared/types.ts` | 前后端共享的数据模型（Track/Artist/Album/Playlist/Lyric/LoginStatus/ApiResult/SearchResults）与工具（formatTime/streamUrl） |
| `shared/lyric.ts` | LRC 歌词解析：时间戳展开、排序、翻译对齐 |
| `src/api/client.ts` | 前端 fetch 封装，解析 `ApiResult`，抛带 `needLogin` 的错误 |
| `src/store/player.ts` | 播放核心状态机：队列、当前曲目、循环/随机、音量、进度；含持久化 |
| `src/store/library.ts` | 收藏曲目、最近播放、本地自建歌单、收藏的网易云歌单 / 专辑；全量持久化 |
| `src/store/auth.ts` | 登录态、登录弹窗开合、手机号/扫码登录动作 |
| `src/store/ui.ts` | 临时 UI 状态（队列面板开合等），不持久化 |
| `src/hooks/useAudioEngine.ts` | 全局唯一 `<audio>` 的驱动：换源、播放/暂停、事件回写、结束推进、媒体会话 |
| `src/hooks/audioElement.ts` | audio 单例引用与命令式 `seekTo()` |
| `src/hooks/useAsync.ts` | 通用取数钩子；可选 `cacheKey` 提供模块级内存缓存（命中即同步返回，参数切换免加载态） |
| `src/hooks/usePresence.ts` | 让浮层在关闭后继续挂载以播放退出动画 |
| `src/hooks/useViewNavigate.ts` | 包装 `useNavigate`，使路由跳转经内容区转场 |
| `src/lib/viewTransition.ts` | 内容区转场：自实现 `document.startViewTransition`（含浮层 / 减少动效 / 不支持时的降级判断） |
| `src/components/*` | UI 组件（Sidebar/Topbar/PlayerBar/NowPlaying/QueuePanel/TrackList/EntityCards/AppLink/LoginModal 等） |
| `src/pages/*` | 路由页面：Home/Browse/Radio/Search/Playlist/**Artist**/**Album**/**Crate（唱片盒）/Favorites/Recent |

## 模块关系

- 页面（`pages/`）通过 `api/client.ts` 取数、通过 `store` 读写状态、通过 `components/` 渲染。
- 所有「播放」动作最终都落到 `store/player.ts`；`useAudioEngine` 是 store 与真实 `<audio>` 之间的唯一桥梁，单向把 store 意图翻译成音频操作，并把音频事件回写 store。
- 进度 seek 是唯一例外：由 `audioElement.seekTo()` 同时写 audio 与 store，避免 rAF 回写与用户拖拽互相覆盖。
- `shared/` 被前后端同时引用，是数据契约的单一来源；改模型需两侧同步。

## 数据流

**搜索（多类型）：**
1. 用户在 Topbar 搜索 → 导航到 `/search?q=` → `Search` 页调 `api.searchAll(q)`。
2. 后端 `/api/search/all` 并行调用 `netease` 的 `searchSongs / searchArtists / searchAlbums / searchPlaylists`（`cloudsearch` 类型码 1/10/100/1000）→ 归一化为 `{songs, artists, albums, playlists}`（封面改写 https）。
3. 四个 tab 分类展示；点击艺人 / 专辑卡片进入 `/artist/:id`、`/album/:id`（`api.artist` / `api.album`）。

**播放一首歌（搜索场景）：**
1. 用户在搜索结果或任意列表点击曲目行 → `TrackList` 调 `player.playTracks(tracks, i)`，写入队列与当前曲目。
2. `useAudioEngine` 侦测 `current` 变化 → 设 `audio.src = /stream/:id` → `audio.play()`。
3. 浏览器请求 `/stream/:id` → 后端解析真实地址（带缓存、https 改写）→ 按 Range 转发网易云 CDN → 回流音频字节。
4. `audio` 的 timeupdate/ended/error 事件回写 store（进度、自然结束推进、播放受限提示）。

**内容区转场 / 沉浸播放页：**
1. 导航（`useViewNavigate` / `AppLink`）经 `startRouteTransition`：支持且无浮层时用 `document.startViewTransition` + `flushSync` 提交路由更新，CSS 让 `.app-content` 交叉溶解；否则直接跳转（Firefox 走 `.route-stage` 的 CSS 降级进场）。
2. 进入 / 退出沉浸播放页由 `player.expanded` 驱动；`NowPlaying` 常驻挂载，`usePresence` 在退出时保留挂载以播放下滑动画，动画结束后卸载。

**登录解锁 VIP：**
1. 打开 `LoginModal` → `api.qrCreate` 取 key + 二维码图片。
2. 前端每 2s 轮询 `api.qrCheck(key)`；后端调网易云 `login_qr_check`。
3. 状态 803（成功）时，后端从网易云返回的 Set-Cookie 中挑出会话必需的几项（`MUSIC_U`、`__csrf`、`MUSIC_A`、`NMTID`）下发浏览器，并返回登录档案；网易云会附带数十条无关 cookie，全量下发会撑大响应头（网关缓冲超限时被 502 截断）。
4. 此后浏览器请求自动带 cookie，后端 `cookieOf()` 提取并透传给网易云，VIP 曲目即可解析出音频地址。

## 外部系统

- **NeteaseCloudMusicApi（npm 依赖）**：在 Node 进程内以函数形式调用网易云加密接口，是本后端的上游能力来源。
- **网易云音乐上游**：搜索/歌单/歌词接口，以及 `music.126.net` 音频 CDN。音频地址有时效，后端用 `lru-cache`（TTL 15 分钟）缓存解析结果。

## 重要技术边界

- **同源边界**：前端只访问本域 `/api`、`/stream`；绝不出现网易云域名。这是规避 CORS/混合内容的根本手段。
- **https 边界**：网易云音频/封面返回 `http://`，后端统一改写为 `https://`（`netease.ts` 的 `https()`），保证在 https 站点上可用。
- **会话边界**：登录态是用户本人的网易云 cookie，仅存于其浏览器；后端无状态，不持久化任何用户凭证。
- **无状态后端**：除音频地址的短期 LRU 缓存外，后端不保存业务状态；重启即恢复，天然可水平扩展。
- **共享类型边界**：`shared/` 不得引入 DOM 或 Node 专有 API，确保浏览器与 Node 两侧都能编译。
- **静态托管边界**：生产必须运行 Node 后端（`pnpm start`），不能当纯静态站点部署——音频代理与登录都依赖它。
- **数据契约兼容边界**：`Track.artistRefs` / `albumId` 为可选字段，旧的持久化数据（收藏 / 最近播放 / 队列）可能缺失，界面须降级为纯文本，不得假定其存在。
- **转场边界**：项目用声明式 `<BrowserRouter>`，react-router 内置 `viewTransition` 在此不生效；内容区转场由 `src/lib/viewTransition.ts` 自实现。只给 `.app-content` 设 `view-transition-name`，`:root` 置 `none`；有浮层打开 / 减少动效 / 不支持 API 时跳过或降级（见 ADR-008）。
- **毛玻璃前缀顺序边界**：CSS 压缩会丢弃未加前缀的 `backdrop-filter`，所有毛玻璃规则必须 `-webkit-backdrop-filter` 在前、`backdrop-filter` 在后（见 ADR-009）。
- **缩略参数边界**：给网易云图片追加 `param=WxH` 必须走 `thumb()`，兼容地址已带查询串的情况（见 ADR-010）。
