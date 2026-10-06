# DECISIONS

本文件记录 Pterosaur 重写（Vue → React 19）过程中的关键技术决策。

## ADR-001：以同源后端代理网易云音源，而非纯前端直连

- 日期：2026-10-02
- 状态：已采纳
- 背景（遇到了什么问题）：目标是「无需登录、随意畅听」。原 Vue 项目靠 `api.paugram.com` 解析网易云 ID，得到 `music.163.com/song/media/outer/url?id=...` 这种地址，它会 302 跳到 `http://m***.music.126.net/....mp3`。实测发现两个硬约束：(1) 真实音频地址是 `http://`，在 https 页面上会被浏览器混合内容策略拦截；(2) 跳转端点与部分接口没有 CORS 头，浏览器 `fetch` 拿不到。纯前端方案在现代浏览器里根本放不出声音。
- 考虑过的方案：
  1. 纯前端直连（保留 paugram）——被混合内容 + CORS 否决。
  2. 纯前端 + 打包内置免版权示例音频——自包含可静态部署，但只能放内置的几首，无法「随意畅听」，与目标冲突。
  3. 引入公共 CORS 代理（allorigins / corsproxy.io）——实测超时或需 API key，不稳定且把用户请求交给不可信第三方。
  4. **自建同源后端代理**——前端只访问本域 `/api`、`/stream`，后端在服务端解析网易云、把 `http` 音频改写为 `https`、按 Range 转发。
- 决策：采用方案 4，自建后端代理。
- 为什么选这个：唯一能同时满足「海量真实曲库 + 免登录畅听 + https 可用 + 可控」的方案。后端还能顺带承接登录会话，为 VIP 解锁铺路。实测 Node 侧 `fetch` 解析重定向、改写 https 后 Range 请求返回 206 音频正常。
- 为什么不选其他：方案 1/3 技术上行不通或不可靠；方案 2 违背产品目标。
- 后果：
  - 生产部署必须运行 Node 后端（`pnpm start`），不能当纯静态站点。
  - 增加了一个需要维护的服务层与音频地址缓存。
  - 好处是前后端同源，部署到 https 服务器无需处理任何跨域/混合内容问题。
- 何时重新审视：若网易云放开官方 CORS 或提供 https 音频直链；或产品决定转向「内置曲库 + 静态托管」的形态。

## ADR-002：后端选 Hono + @hono/node-server，并内置网易云登录

- 日期：2026-10-02
- 状态：已采纳
- 背景：需要一个轻量、TypeScript 友好、能与前端共享类型的后端；用户额外要求「支持登录自己的网易云账号以充分支持 VIP 曲目」。
- 考虑过的方案：Express（重、TS 体验一般）、Fastify（可以但生态偏 REST）、原生 `node:http`（太底层）、**Hono**（超轻量、Web 标准 `Request/Response`、TS 一等公民、`@hono/node-server` 可直接跑在 Node 且能托管静态资源）。
- 决策：后端用 Hono；网易云能力用 `NeteaseCloudMusicApi` 在 Node 进程内以函数形式调用（而非另起其 HTTP server）；登录用网易云扫码（`login_qr_*`）为主、手机号（`login_cellphone`）为辅。
- 为什么选这个：Hono 让「同一进程既发 API 又发 SPA 静态资源」非常自然，天然同源；`NeteaseCloudMusicApi` 以库形式调用省掉一层进程与端口，且其加密签名逻辑现成可用。扫码登录把 cookie 通过 Set-Cookie 下发浏览器，后续请求自动回传、后端透传即可解锁 VIP。
- 为什么不选其他：Express/Fastify 与「共享 TS 类型 + 静态托管 + 极简」的诉求不如 Hono 贴合；自建网易云加密签名成本高且易随上游变动失效。
- 后果：
  - 后端无业务状态（仅音频地址 LRU 缓存），可水平扩展。
  - 登录态是用户本人网易云 cookie，仅存其浏览器，后端不持久化凭证。
  - 依赖 `NeteaseCloudMusicApi` 的接口形态：参数扁平（`{keywords, limit}`）、返回 `cookie` 为 Set-Cookie 字符串数组——已在 `server/netease.ts` 收敛。
- 何时重新审视：`NeteaseCloudMusicApi` 停止维护或网易云大改加密协议时。
- 后续修订：「后端不持久化凭证」已被 ADR-014 打破——服务端为未登录访客新增了一份**可选的缺省凭证**（`.env` 中的 `NETEASE_COOKIE`）。

## ADR-003：前端用 React 19 + Vite 8 + Zustand，状态按领域拆分

- 日期：2026-10-02
- 状态：已采纳
- 背景：用户指定 Vite + React 19 重写。需要一套轻量、可持久化、选择器友好的状态方案承载播放器这种高频更新的应用。
- 考虑过的方案：Redux Toolkit（样板多、对播放器偏重）、Jotai/Valtio（原子化，播放器状态是强关联的整体，拆分反而别扭）、Context + useReducer（高频 position 更新会导致大范围重渲染）、**Zustand**（极简、选择器订阅天然规避无关重渲染、内置 `persist` 中间件）。
- 决策：Zustand，按领域拆四个 store——`player`（播放状态机）、`library`（收藏/最近/本地歌单）、`auth`（登录态）、`ui`（临时浮层开合）。前三者用 `persist` 落 localStorage，`ui` 不持久化。
- 为什么选这个：播放器每秒多次更新进度，Zustand 的选择器订阅让「只有用到该字段的组件」重渲染，性能与心智负担都低；`persist` 让「免登录也能记住收藏/最近播放」开箱即用。按领域拆分避免单一巨型 store。
- 为什么不选其他：Context 方案扛不住 position 的高频更新；Redux 对本项目偏重。
- 后果：
  - `player` store 持久化时用 `partialize` 只存列表与偏好，冷启动重置为暂停态（不恢复「正在播放」，避免浏览器自动播放策略报错）。
  - 进度 seek 单独走 `audioElement.seekTo()` 命令式路径，不经 store 订阅，避免 rAF 回写与拖拽互相覆盖。
- 何时重新审视：若引入服务端渲染或需要跨标签页实时同步播放状态。

## ADR-004：播放进度用命令式 seek + rAF 单向回写，而非双向绑定

- 日期：2026-10-02
- 状态：已采纳
- 背景：`<audio>.currentTime` 既被播放自然推进，又被用户拖拽修改。若用 store.position 双向绑定，rAF 的高频回写会与用户拖拽的目标值互相覆盖，导致进度条抖动、拖不动。
- 考虑过的方案：(1) position 完全由 store 驱动、audio 受控——抖动；(2) 拖拽期间本地 state、松手 commit——可行但 seek 与 store 仍可能打架。
- 决策：进度单向回写——`useAudioEngine` 用 rAF 把 `audio.currentTime` 写进 store 供 UI 渲染；用户拖拽/快进/点歌词则调 `audioElement.seekTo()`，它**同时**写 `audio.currentTime` 与 store，一次到位。
- 为什么选这个：区分「音频是真相源（自然播放）」与「用户意图是真相源（拖拽）」两种场景，各自单向，杜绝循环覆盖。
- 后果：任何需要跳转播放位置的 UI（进度条、快捷键、歌词行）都必须走 `seekTo()`，不能直接 set store.position。
- 何时重新审视：基本稳定，除非改用 Media Source Extensions 之类的自定义缓冲方案。

## ADR-005：E2E 面向「生产形态」运行（build 后由 Hono 同源提供）

- 日期：2026-10-02
- 状态：已采纳
- 背景：本项目的正确性高度依赖「同源代理 + https 音频改写 + Range 串流」，这些只在后端在场时才成立。若 E2E 只跑 Vite dev（前端 mock 后端），测不到真正的播放链路。
- 决策：Playwright 的 `webServer` 先 `vite build`，再以 `NODE_ENV=production` 启动 Hono（同时发 SPA 与 API），E2E 断言真实音频播放（`audio.paused===false` 且 `currentTime` 随时间前进）、真实歌词加载、真实 Range 响应。
- 为什么选这个：与线上部署形态一致，测的是用户真正会走的路径，能抓到「dev 能跑、prod 挂」这类问题。
- 后果：E2E 依赖真实网易云上游，存在网络波动风险；已用较长超时与 `.poll()` 缓解，并对「免费可播曲目」做断言以规避 VIP 不确定性。
- 何时重新审视：若上游不稳定导致 CI 频繁 flaky，可对网络层做录制回放（fixture）改造。

## ADR-006：git 历史作者与提交信息按实际重写，保留作者时间

- 日期：2026-10-02
- 状态：已采纳
- 背景：原仓库三条历史提交作者为他人（Penyo），提交信息笼统（如「feat: add many functions」「feat: commit very firstly」）。用户要求按实际情况重写信息、作者统一改为 `杏仁鹿 <krkr@xrl.im>`，且**作者时间不变**。
- 决策：先用 `git bundle` 备份原始历史到仓库外（`/tmp/pterosaur-original-backup.bundle`）；再用 `git filter-repo` 统一作者/提交者并重写信息；因 filter-repo 会给正文加两空格缩进，改用 `git commit-tree` 以既有 tree + 原 author/committer 日期逐条重建，得到干净无缩进的提交信息。
- 为什么选这个：`commit-tree` 能逐字控制 message 与四个时间戳（author date / commit date 各自保留），比重放 patch 更精确；bundle 备份保证可回退。
- 后果：三条历史提交的 SHA 全部改变（tree 内容逐字节不变，已校验）；本地历史与 `origin` 分叉，推送需 `--force-with-lease`（尚未推送，留待用户决定）。
- 何时重新审视：不涉及。若需恢复原历史，从 bundle 重新 clone 即可。

## ADR-007：搜索分为歌曲 / 艺人 / 专辑 / 歌单四类，并新增艺人页、专辑页

- 日期：2026-10-03
- 状态：已采纳
- 背景：原搜索只返回单曲（`cloudsearch type=1`）。需求要把结果分为四类 tab；同时歌单内的艺人名 / 专辑名要能点击跳转到详情页——而原 `Track` 模型只有艺人名与专辑名的字符串，没有 id，也**没有**艺人页 / 专辑页。
- 考虑过的方案：① 前端对 `cloudsearch` 做四次调用；② 后端合并为一个 `/api/search/all` 端点；③ 只做歌曲 + 前端过滤（无法得到艺人/专辑实体）。艺人/专辑详情：复用 `artists`（档案 + 热门单曲）与 `artist_album`、`album`（档案 + 曲目）。
- 决策：后端新增 `/api/search/all`（内部 `Promise.all` 四次 `cloudsearch`，类型码 1/10/100/1000）、`/api/artist/:id`、`/api/album/:id`；`Track` **增量**新增 `artistRefs?: {id,name}[]` 与 `albumId?: string`，并新增共享 `Artist` / `Album` / `SearchResults`。前端新增艺人页 / 专辑页与曲目行内可点击链接。
- 为什么选这个：`cloudsearch` 单次请求只返回一种类型，并行四次是最直接的实现；把四次放后端可让前端一次请求拿到全部，切 tab 瞬时；`Track` 只做**增量**字段扩展，既有展示逻辑（`artist` / `album` 字符串）与持久化数据不受影响，缺失 id 的旧数据（收藏 / 最近 / 队列）自动降级为纯文本。
- 为什么不选其他：方案③ 拿不到艺人 / 专辑实体；把四次调用放前端会让四个组件的加载态各自为政，且要处理并发。
- 后果：每次搜索产生 4 个上游请求（艺人 / 专辑 / 歌单限额较小）；`useAsync` 增加可选 `cacheKey`（模块级内存缓存，命中即同步返回），使切换歌单 / 专辑时免于加载态、转场更顺滑。
- 何时重新审视：若网易云提供一次返回多类型的搜索接口。

## ADR-008：内容区转场自实现 View Transition，沉浸播放页用 presence + CSS 动画

- 日期：2026-10-03
- 状态：已采纳
- 背景：需求要求主内容区切换（如切换歌单）与进入 / 退出沉浸播放页达到 Apple Music / iOS 级观感。最初设想用 react-router v7 内置的 `viewTransition` 选项。
- 考虑过的方案：① RR7 内置 `viewTransition: true` / `<Link viewTransition>`；② 迁移到数据路由（`createBrowserRouter` + `RouterProvider`）后使用内置能力；③ 自实现 `document.startViewTransition`；④ 引入动画库（framer-motion）。
- 决策：②被排除后采用③——新增 `lib/viewTransition.ts` 的 `startRouteTransition(update)`：在支持该 API、未命中 `prefers-reduced-motion`、且无浮层打开时，`startViewTransition(() => { flushSync(update); resetContentScroll() })`；CSS 只给 `.app-content` 一个 `view-transition-name` 并置 `:root { view-transition-name: none }`，使**只有内容区**做交叉溶解（侧栏 / 顶栏 / 播放条静止）。导航统一走 `hooks/useViewNavigate` 与 `components/AppLink`。沉浸播放页改为**常驻挂载** + `hooks/usePresence`，用 CSS `np-enter` / `np-exit` 做上推进入、下滑退出。
- 为什么选这个：本项目用的是**声明式 `<BrowserRouter>`**，经核验 RR7 源码，该模式下 `useNavigate` 走 `useNavigateUnstable`，其 `navigator.push(path, state, options)` 会**忽略 `options`**，`startViewTransition` 只存在于 `RouterProvider` 路径——即内置 `viewTransition` 在本项目中是空操作（无转场、无告警）。自实现可绕开这一限制，且能精确控制「只动内容区」「浮层打开时跳过」等条件。
- 为什么不选其他：方案① 无效；方案② 改动面更大且每个调用点仍需逐个加选项；方案④ 为一个转场引入重依赖不值得。
- 后果 / 已知边界：
  - 浏览器前进 / 后退（`popstate`）与 Topbar 的前进后退按钮不参与转场（无法被同步包裹）。
  - Firefox 暂无原生支持 → 走 CSS 降级（`<html data-vt="off">` 时对 `.route-stage` 播放进场动画）。
  - 有浮层（队列 / 沉浸页 / 弹窗）打开时跳过转场——`::view-transition` 伪树绘制在 top layer，否则会盖住这些 `position: fixed` 浮层。
  - `view-transition-name` 必须文档内唯一——只给 `.app-content` 命名，绝不给列表行 / 卡片命名（否则整段转场被跳过）。
- 后续修订：沉浸播放页的转场已由 **ADR-018** 升级为 View Transitions **共享元素**（封面 morph）；本条中的 `usePresence` + `np-enter`/`np-exit` 上滑仅作**无 VT 时**的降级。
- 何时重新审视：若把路由迁移到数据路由，可回退到内置 `viewTransition`。

## ADR-009：CSS 压缩会合并 `backdrop-filter` 前缀对，标准属性须写在最后

- 日期：2026-10-03
- 状态：已采纳
- 背景：给队列面板加毛玻璃时发现，构建产物中**未加前缀的 `backdrop-filter` 被丢弃**、只剩 `-webkit-backdrop-filter`（源码里两条都在、值相同）。Firefox 支持未加前缀的 `backdrop-filter` 而不支持 `-webkit-` 前缀，因此毛玻璃在 Firefox 会失效——侧栏 / 顶栏 / 播放条等既有毛玻璃其实早就受影响，只是不明显。
- 决策：把所有毛玻璃规则统一改为 `-webkit-backdrop-filter` 在前、`backdrop-filter` 在后的顺序（`Sidebar` / `Topbar` / `PlayerBar` / `QueuePanel` / `NowPlaying` / 各弹窗）。这样压缩后两条都会保留。
- 为什么选这个：实测交换顺序后构建产物同时保留两个属性，Chromium（两条都支持）、Firefox（标准属性）、旧 Safari（前缀属性）都能得到毛玻璃；无需引入额外的 `@supports` 或构建插件。
- 后果：源码中该前缀对的顺序成为**有意义**的约束，后续新增毛玻璃样式需遵循。
- 何时重新审视：若更换 CSS 压缩器 / 配置其 targets，使未加前缀属性不再被丢弃。

## ADR-010：`normalizePlaylist` 等拼接触摸参数时兼容已有查询串

- 日期：2026-10-03
- 状态：已采纳
- 背景：封面 / 头像需要追加网易云缩略参数 `?param=WxH`。部分歌单封面（`coverImgUrl`）本身已带查询串，用 `?` 直接拼接会得到第二个 `?`，破坏地址。此前只在歌单封面出现、不易察觉；搜索页新增歌单 tab 后变得更明显。
- 决策：抽出 `thumb(url, param)` 辅助函数：地址已含 `?` 时用 `&` 连接，否则用 `?`。`normalizeTrack` / `normalizeArtist` / `normalizeAlbum` / `normalizePlaylist` 及 `playlistTracks` 统一走它。
- 后果：封面地址不再出现重复 `?`；歌单封面在浏览器中可正常加载。
- 何时重新审视：不涉及。

## ADR-011：library 持久化从 localStorage 迁到 IndexedDB，并以微任务级写合并节流

- 日期：2026-10-03
- 状态：已采纳
- 背景：`store/library.ts` 原用 `persist` + `createJSONStorage(() => localStorage)` 且无 `partialize`。`persist` 在**每次 `set()` 都把整个库 `JSON.stringify` + 同步 `setItem`**，而 `addRecent` 挂在**每次切歌**上（`useAudioEngine.ts`）。两个问题：(1) 主线程同步序列化/写盘，切歌/收藏时掉帧；(2) localStorage ~5MB 配额天花板，`playlists[].tracks` 存完整 `Track` 造成重复存储，重度用户触顶后**静默丢写**。
- 考虑过的方案：① 维持 localStorage，仅加 `partialize` 裁字段；② 迁 IndexedDB，`createJSONStorage` 存 JSON 串；③ 迁 IndexedDB，自定义 `PersistStorage` 用 structured clone 直接存对象；④ 迁 OPFS / 服务端。写节流上：⑤ 定时 debounce（~300ms）+ `pagehide` flush；⑥ 微任务级合并。
- 决策：③ + ⑥ + 一次性迁移。新增 `lib/idb.ts`（纯 IDB 封装，主线程与 SW 共用）、`lib/coalesceWrites.ts`（微任务级写合并）、`lib/libraryStorage.ts`（IDB `PersistStorage` + 旧 localStorage 数据惰性迁移）。store 改为 `storage: libraryStorage` + `skipHydration: true` + **`partialize` 只存数据字段**；`main.tsx` 渲染前 `await rehydrate()`。
- 为什么选这个：IDB 写入**异步、不阻塞主线程**，且配额远大于 localStorage，直接解决两个原问题。用 structured clone 免掉 `JSON.stringify` 的主线程 CPU。列表类数据可被合并，故用微任务级合并（同一 tick 内多次 `setItem` 只落最后一次）—— 保留合并收益而**没有时间窗口**。
- 为什么不选其他：① 治标不治本（仍受 5MB 限额与同步写）；② 仍要 `JSON.stringify`；④ 过重。**⑤ 被否决**：底层是异步 IDB，浏览器无法在页面卸载时保证事务提交，任何 `delay > 0` 都会让「收藏/建歌单后立刻刷新或硬跳转」丢失最后一次写入（已由 E2E 复现并据此改设计）。**必须**给 library 加 `partialize`：`persist` 默认持久化整个 state（含 action 函数），而 IDB 的 structured clone **无法克隆函数**，直接 `put` 会抛 `DataCloneError`——这是迁到 IDB 后才暴露、localStorage（JSON 静默丢弃函数）时代不存在的约束。
- 后果 / 已知边界：
  - `store/library.ts` 新增 `partialize`（仅 favorites/recent/playlists/savedPlaylists/savedAlbums；**后续修订**：ADR-017 增加 `savedArtists`）。
  - 一次性迁移写在 `libraryStorage.getItem` 内：读到旧 `localStorage['pterosaur-library']` 即写入 IDB 并删除旧键（键存亡即幂等标记）；`getItem` 因此有一次性副作用（读时写），可接受。
  - 持久化变为异步：`main.tsx` 在 `createRoot().render()` 前 `await rehydrate()`，避免首帧空库闪烁。
  - **dangling 写入窗口**：写入是异步的，硬导航（刷新 / 输入地址 / 外链）发生在写入提交之前理论上会丢最后一次写；应用内跳转走客户端路由（不重载）不受影响，`pagehide`/`visibilitychange` 有兜底 flush。E2E 中**硬跳转/reload 前用 `waitForLibraryPersisted` 轮询 IDB 落盘**规避竞态。
  - 测试：`fake-indexeddb` 注入 `test/setup.ts`；E2E 由「写 `localStorage` 封套」改为「在页面上下文写 IDB」。
- 何时重新审视：若引入 OPFS 或需要跨标签页同步；或 `Track` 体积进一步膨胀需要把 `playlists[].tracks` 归一化为引用。

## ADR-012：播放过的音频用 Service Worker + IndexedDB 缓存（16GB 上限，LRU 淘汰）

- 日期：2026-10-03
- 状态：已采纳
- 背景：希望播放过的曲目本地留存，实现即点即播 / 离线。后端 `/stream/:id` 写死 `Cache-Control: no-store` 且无 `ETag`，**浏览器 HTTP 缓存被完全禁用**；因此缓存必须由应用层承担。`/stream/:id` 路径稳定（key = `track.id`），且上游真实 CDN 地址由后端隐藏、对客户端不可见。
- 考虑过的方案：① 播放前先整文件拉进 IDB 再用 blob 播放（单一流量，但首播要等整首下载完，无渐进播放）；② 播完后另起一次 `fetch` 抠整文件存 IDB（保留流式，但每首首次约 2× 流量）；③ **Service Worker 拦截 `/stream/*`**，单次下载、边流式播放边缓存；存储用 Cache Storage 还是 IDB。
- 决策：③，且**存 IDB**。新增 `src/sw.ts`（独立 Vite 构建产出单文件 `sw.js`）+ `lib/audioCache.ts`（纯逻辑：缓存 key、Range 切片、LRU 计算 —— 主线程与 SW 共用）。SW 只拦截 `/stream/*`，其余请求原样放行。未命中时 `fetch(url)`（去掉 Range 取整文件）→ `clone()` 一路流式返回给页面播放、一路 `blob()` 写 IDB；命中时按请求 `Range` 返回 200/206。blob 与元数据分存两个 store（`audio` / `audioMeta`），使 LRU 淘汰只遍历轻量元数据、不触碰 blob。容量上限 `min(16GB, navigator.storage.estimate().quota * 0.9)`，超出按 `lastAccess` 升序淘汰；启动时 `navigator.storage.persist()` 申请持久化。
- 为什么选这个：SW 拦截是唯一能**单次下载 + 保留流式播放 + 透明缓存**的方案；`audio.src` 无需任何改动。存 IDB 而非 Cache Storage 是因为需要按曲目元数据（`lastAccess`）做 **LRU 与用量统计**，Cache Storage 无内建元数据/索引。缓存 key 用 `${id}|${level}`（前端恒用默认 `exhigh`），排除登录态（同一 level 下字节一致，登录只影响能否解析）。
- 为什么不选其他：①②都要么牺牲首播体验、要么翻倍流量；Cache Storage 不便做 LRU 记账。
- 后果 / 已知边界：
  - 新增 `sw.js` 构建步骤：`apps/web/vite.config.sw.ts` 单独构建（IIFE、无 hash、`emptyOutDir: false`），**必须在主构建之后**运行。
  - SW 只碰 `/stream/*`，对路由、HMR、其它资源零影响；dev 下可选以 module SW 注册（`/src/sw.ts`），prod 用 `/sw.js`。
  - 仅缓存 `200/206` 且 `content-type` 为 `audio/*` 的响应；`403`（VIP 未登录）/`502` 直接放行不缓存。
  - IDB 无流式写入：整文件需短暂驻留内存（单曲数 MB~数十 MB）。
  - 16GB 为**自设上限**，浏览器实际配额可能更低且可能在存储压力下回收，故 UI 应提供「清空缓存」入口（`audioUsage` / `clearAudioCache`）。
- 何时重新审视：若浏览器对 Cache Storage 的淘汰/配额行为更适合该场景；或需要边下边存（分片写入 IDB）。
- 后续修订：音频本身仍是手写 IDB 逻辑；但「应用外壳缓存」随后改用 Workbox 运行时缓存，且封面也并入同一 IDB 池 —— 见 ADR-013。

## ADR-013：引入 vite-plugin-pwa（应用外壳 7 天过期）+ 封面经 SW 落 IDB（与音频共用 16GB）

- 日期：2026-10-03
- 状态：已采纳
- 背景：应用此前不能安装、不能离线，应用外壳（HTML/JS/CSS）完全依赖网络与浏览器启发式 HTTP 缓存；封面图由 `<img>` 直连网易云 CDN，不经 SW、不落任何应用层缓存。目标：(1) 可安装、离线可用的 PWA，且外壳缓存不能无限陈旧；(2) 封面与音频一样作为非结构化数据落进 IndexedDB，二者共用同一个容量预算。
- 考虑过的方案：PWA 集成——① `generateSW`（默认）；② `injectManifest` 复用现有 `src/sw.ts`。外壳缓存——③ precache（Workbox 默认）；④ runtime caching + `ExpirationPlugin`。封面获取——⑤ 新增后端 `/img` 同源代理；⑥ SW 以 CORS 重新拉取原 CDN 地址。
- 决策：② + ④ + ⑥。引入 `vite-plugin-pwa@^1.3.0`，`strategies: 'injectManifest'` 让现有手写 SW 成为**唯一** SW（`rollupFormat: 'iife'` 保持经典非模块 SW；`injectRegister: false`，仍由 `main.tsx` 手工注册）；应用外壳改用 Workbox 运行时缓存（导航 `NetworkFirst`（缓存键归一为 `/index.html`）、同源 script/style `StaleWhileRevalidate`），`ExpirationPlugin({ maxAgeSeconds: 7 * 24 * 3600 })`；precache 收窄到静态图标/manifest。删除独立的 `vite.config.sw.ts` 与第二步构建。封面按 `destination === 'image'` 由 SW 接管，未命中时以 `mode:'cors', credentials:'omit'` 拉取（实测网易云 CDN 无条件返回 `access-control-allow-origin: *`），把**可读**字节写入与音频同一个 IDB 池。IDB 升到 v2：`audio`/`audioMeta` 更名 `media`/`mediaMeta` 并加 `kind: 'audio' | 'image'`。
- 为什么选这个：单一 SW 才能避免同作用域抢注册；runtime caching 才能表达「7 天有效期」（precache 条目永不过期，与需求直接冲突）；SW 侧 CORS 拉取无需改后端与图片 URL 生成，改动面最小；共用同一 meta store 使 LRU 天然跨音频 / 封面按 `lastAccess` 统一淘汰，正合「共用 16GB」。
- 为什么不选其他：① 会再生成一个 `sw.js` 与现有注册冲突；③ 与「外壳 7 天过期」矛盾；⑤ 需新增后端路由并改写图片 URL 生成，改动更大（且已明确不改后端）。
- 后果 / 已知边界：
  - SW 拦截范围由「仅 `/stream/*`」扩大为「`/stream/*` + 封面图片 + 同源导航 + 同源 script/style」；`/api/*` 与其它请求仍原样放行。
  - 封面缓存**依赖 CDN 的 CORS 行为**：若其变更，封面回退为「直连不缓存」（功能不受损，仅失去缓存）。
  - 离线语义：首次访问后外壳 / 封面才有缓存；外壳缓存超过 7 天未用即被清除，此后离线不可用——这是「7 天有效期」的预期行为。
  - IDB v2 升级会丢弃旧音频缓存（纯缓存，可接受），`library` 原样保留；`e2e` 的 IDB 辅助已同步到 v2。
  - 设置弹窗「检查更新」= 注销全部 SW 注册 + 清空 Cache Storage + `fetch(href, { cache: 'reload' })` 后 `location.reload()`；**不触碰 IndexedDB**，资料库与媒体缓存保留。
  - 构建：`apps/web` 的 `build` 回归单条 `vite build`，产出 `sw.js` + `manifest.webmanifest` + 图标；图标提交进仓库（CI 无需浏览器 / sharp）。生成器源为 `apps/web/assets/pwa-icon.svg`（**不放 `public/`**，避免作为站点资源发布、也不再进 precache）；生成器固定会多产出 64px / maskable / `.ico` 等无用文件，**只保留 4 个**：`favicon.svg`（标签页，`index.html` 引用）、`pwa-192x192.png`、`pwa-512x512.png`、`apple-touch-icon-180x180.png`，且 512 那张直接兼作 maskable（全出血红底、图形落在安全区）。重新生成：对源跑 `pnpm dlx @vite-pwa/assets-generator@latest --preset minimal-2023 apps/web/assets/pwa-icon.svg`，再把所需产物移入 `public/`。
  - **开发态作用域**：dev 下 SW 源码位于 `/src/sw.ts`，其默认作用域会被限制为 `/src/`，SW 便永不控制 `/` 下的页面、缓存恒为空。故 `vite.config.ts` 加了一个 dev 中间件为该响应补 `Service-Worker-Allowed: /`，`main.tsx` 再以 `scope: '/'` 注册；生产由 `/sw.js` 天然位于根作用域，无需此插件。
- 何时重新审视：若希望离线首帧即用外壳（放弃 7 天过期，改用 precache）；若网易云 CDN 关闭 CORS（需改走后端代理）；若引入 OPFS。

## ADR-014：服务端缺省凭证（`pnpm log-in`）——未登录访客共享运营者账号解锁 VIP

- 日期：2026-10-03
- 状态：已采纳
- 背景：此前 VIP 曲目只有「登录了本人网易云账号」的访客才能播放（见 ADR-002），匿名访客只能听免费曲目——与产品定位「无需登录、随意畅听」（ADR-001）相矛盾。需要一份「缺省账号」在访客未登录时代为解析 VIP 资源，且不得影响访客自身身份与其后续登录。
- 考虑过的方案：① 前端内置一份 cookie——随前端产物暴露给所有访客，泄露面最大，否决；② 把 cookie 写死后端源码——同样入库即泄、难以轮换；③ **CLI 扫码登录 → 落盘 `.env` → 服务端按需读取**；④ 硬编码「公开共享账号」——无法轮换与审计。
- 决策：方案 ③。新增 `pnpm log-in`：起一个**仅监听回环地址**的本地网页，扫码成功后把会话 cookie 写入**仓库根 `.env`** 的 `NETEASE_COOKIE`（并记 `NETEASE_COOKIE_UPDATED_AT`）。服务端启动时 `loadEnv()`；请求处理时以 `credentialOf(c) = cookieOf(c) ?? process.env.NETEASE_COOKIE` 提供**内容接口**（搜索 / 歌单 / 艺人 / 专辑 / 歌曲详情 / 歌词 / `/stream`）所需凭证；**身份接口**（`/api/auth/status`、`/api/user/playlists` 等）仍只看访客本人 cookie。`.env` 不入库（`.gitignore` 已忽略），另提供可入库的 `.env.example`。
- 为什么选这个：扫码只做一次、凭证落在部署者自己的机器上而不经过源码；`.env` 与既有的 NODE_ENV/PORT/HOST 约定一致；`credentialOf` 单点回退让「匿名可听 VIP、登录仍以本人为准」的语义清晰；前端零改动（同源铁律不变）。
- 为什么不选其他：①/②/④ 都会把长期凭证写进仓库或前端产物，泄露面最大且难以轮换。
- 后果 / 已知边界：
  - **这是 ADR-002「后端不持久化凭证」的例外**：服务端会持久化一份**缺省**凭证——它属于运营者，不属于任何访客。建议使用**专用账号**，并评估网易云对异地 / 多端登录的风控。
  - 缺省凭证同样作用于 `/api/discover/recommend`，故匿名首页的个性化推荐来自该账号。
  - 音频地址缓存键由「有无 cookie」布尔改为**凭证指纹**（cookie 的短哈希），避免不同账号串用解析出的 CDN 地址。
  - `.env` 变更**需重启服务**生效（`process.env` 不在运行期热更新）；`pnpm log-in` 结束时会打印该提示。
  - 未配置 `NETEASE_COOKIE` 时，行为与改动前完全一致（访客仍凭本人登录）。
- 何时重新审视：若引入多缺省账号 / 凭证自动轮换；若网易云风控使共享账号不可用；若产品改为「必须登录才能播放」。

## ADR-015：封面缓存按固定 TTL 7 天过期（音频不受影响）

- 日期：2026-10-03
- 状态：已采纳
- 背景：媒体缓存（音频 + 封面）共用 16GB LRU，淘汰只看 `lastAccess`，**没有任何时间维度**；而应用外壳已用 Workbox `ExpirationPlugin` 做 7 天过期（ADR-013）。需求：让封面也与外壳对齐——**缓存 7 天后自动过期**。
- 考虑过的方案：过期语义——① 固定 TTL（从**写入时刻**起算，到期必回源）；② 滑动窗口（从**末次访问**起算，常看则不过期）；③ 不为封面设过期。
- 决策：①。`MediaMeta` 增 `cachedAt`（写入时刻）；新增纯函数 `isExpired(meta, now)`（`kind==='image'` 且 `now - (cachedAt ?? 0) >= IMAGE_TTL_MS`）与 `expiredKeys`；SW 在命中时若已过期则 `deleteCached` 并按未命中回源，启动 `loadState` 时顺带清扫一遍。音频 `kind==='audio'` 永不过期。
- 为什么选这个：① 与外壳「7 天有效期」的固定寿命语义一致，且字面对应需求「7 天自动过期」；② 会让常看封面永不刷新，与「到期」相悖；封面体积小、回源廉价，固定 TTL 的额外一次下载可忽略。
- 为什么不选其他：② 语义不符；③ 违背需求。
- 后果 / 已知边界：
  - 封面自写入起 7 天后，下次访问必回源刷新一次（每 7 天每封面最多一次）。
  - 旧数据无 `cachedAt` → `isExpired` 以 `0` 计 → 判为过期，首次访问平滑刷新，无需迁移。
  - 音频仅受 LRU 淘汰，不受本 TTL 约束。
- 何时重新审视：若封面 URL 变得易变（需更短 TTL）；若希望离线长期保留封面（应取消过期）。

## ADR-016：library 云同步——LWW + 服务端文件型存储（打破「无状态后端」）

- 日期：2026-10-03
- 状态：已采纳
- 背景：library（收藏 / 最近 / 自建歌单 / 收藏的网易云歌单 · 专辑）此前只存本机 IndexedDB（ADR-011），换设备即丢。需求：登录后于头像菜单新增「云同步」开关（默认关闭），开启后支持**多设备同步**。
- 考虑过的方案：合并策略——① LWW（最新修改为准，整份覆盖）；② 两端并集合并。服务端存储——③ 文件型 JSON；④ 内存；⑤ 引入数据库。范围——仅 `library`。
- 决策：① + ③。新增 `server/syncStore.ts`（`<DATA_DIR|仓库根/.data>/sync/<userId>.json`，**原子写** tmp→rename，形状与体积校验）；路由 `GET/PUT /api/sync/library` 以**访客本人 cookie** 解析 `userId`（身份接口，**绝不回退缺省凭证**），未登录 401。前端新增 `store/sync.ts`（持久化 `enabled` / `userId` / `updatedAt`）、`lib/sync.ts`（`decideSync` LWW 决策 + 订阅 library 变更防抖推送 + `applying` 回声抑制）、`hooks/useLibrarySync.ts`（挂 `App`）；开关在头像菜单、**「退出登录」上方**，默认关。
- 为什么选这个：① 语义直观（本地或云端更新的那一份胜出）、**删除会随整份文档一并同步**、实现与验证简单；③ 零新依赖、契合单机自托管部署（pm2 在仓库根启动），`DATA_DIR` 可覆盖；按 `userId` 隔离且只用本人 cookie，杜绝越权与「把匿名访客当成运营者」。
- 为什么不选其他：② 不传播删除（别端会把删掉的条目带回来）、实现更复杂；④ 重启即失；⑤ 对一个自托管单机播放器过重。
- 后果 / 已知边界：
  - **这是「无状态后端」原则的第二个例外**（第一个是 ADR-014 的缺省凭证）：服务端开始**持久化访客本人的 library**。ADR-002 与 ARCHITECTURE 的相关措辞已同步修订；多实例水平扩展不再成立（文件存储不共享）。
  - LWW 为**整份覆盖**：两端离线各改后重连，后推送者覆盖前者（已与用户确认接受）。
  - 激活条件：开关开启 **且** 已登录 **且** `sync.userId === 当前 userId`；换账号自动失活（不为新账号悄然开启）。关闭开关仅停止同步，不删云端副本。
  - `.data/` 已被 `.gitignore` 忽略；部署流程（pm2 在仓库根）不会清空它，`DATA_DIR` 可改。
  - **设置「重置」联动**：已开启云同步时，先推送一份空 library 清空云端副本，再清本机（顺序不可颠倒）——见 ADR-015 同期改动的 `lib/reset.ts`。
  - 云同步 E2E 依赖真实扫码登录（无法自动化），以单测（`syncStore.test.ts`、`lib/sync.test.ts`）+ 手动验证覆盖。
- 何时重新审视：若需记录级 / 字段级合并与冲突保留；若引入多实例或数据库；若需要同步 `player` 播放态。

## ADR-017：艺人亦可收藏；唱片盒改为「艺人 + 专辑」双分区；同步校验只校验基础字段（宽容解析）

- 日期：2026-10-04
- 状态：已采纳
- 背景：此前收藏能力覆盖曲目 / 歌单 / 专辑，「唱片盒」（`/crate`）**只**展示收藏的专辑。需求：**艺人也可收藏**，且唱片盒同时容纳收藏的**艺人 + 专辑**。
- 考虑过的方案：收藏入口——① 仅艺人详情页红心；② 详情页红心 + 艺人卡片悬浮红心。唱片盒布局——③ 一页上下两分区；④ 顶部 tab 切换。同步校验——⑤ 把 `savedArtists` 并入必填集合；⑥ 只校验基础字段、对其余字段一概放行（宽容解析）。
- 决策：② + ③ + ⑥。`LibraryData` 增加 `savedArtists`（`store/library.ts` 增 `toggleSaveArtist` 并同步 `partialize` / `snapshotLibrary` / `emptyLibrary`）；`ArtistCard` 由 `<button>` 改写为 `div[role=button]` 并内嵌 `.card__fav` 红心（`<button>` 不能嵌套按钮，对齐 `AlbumCard` 范式）；艺人详情页红心照搬 `AlbumPage`；服务端 `isSyncEnvelope` 采用⑥（只校验基础集合，**不枚举后续新增字段**）。
- 为什么选这个：②「搜索到即收藏」，与专辑卡片的悬浮播放按钮范式一致；③ 一页看过全部收藏，契合「唱片盒」语义；⑥ **数据安全 + 抗污染**——若把 `savedArtists` 设为必填，旧云端文件（缺该字段）会被判为非法 → `readLibrary` 返回 `null` → 被当成「云端无数据」→ 新设备首开同步会用空库覆盖，**造成不可逆数据丢失**；而若为每个新增字段单开「必填 / 可选」判断，校验逻辑会随字段增长而污染，故只校验基础形状、其余字段一概放行。
- 为什么不选其他：① 少一个顺手入口；④ tab 每次只看一类、不如分区一目了然；⑤ 有数据丢失风险，且每加一个字段都要改校验（污染型）。
- 后果 / 已知边界：
  - 前端 `applyPayload` 以空库为底、用云端载荷覆盖（`{ ...emptyLibrary(), ...state }`），缺省处回落空值，**不逐字段枚举**；参数类型放宽为 `Partial<LibraryData>`。
  - 服务端 `isSyncEnvelope` 只校验基础形状、对新字段宽容：**不枚举后续字段**，避免校验逻辑随 library 扩展而污染。
  - LWW 整份覆盖的既有语义不变：旧云端载荷（无 `savedArtists`）被拉取时按 `[]` 处理；新客户端任何一次 push 都会把云端文档升级为 6 字段。
  - 卡片为 `div[role=button]` 内嵌红心按钮：键盘激活仅响应卡片本体（`e.target === e.currentTarget` 守卫），红心 `stopPropagation` 不进入详情页；`.card__fav--active` 常显强调色。
  - 唱片盒列表在**进入时冻结**（读一次 store 快照）：在页内取消收藏后卡片**不立即消失**（防误触），下次进入唱片盒才刷新。
  - 测试：`library.test.ts` / `sync.test.ts` / `syncStore.test.ts` 覆盖新字段与旧载荷兼容；E2E 新增唱片盒双分区 / 空态 / 艺人收藏（前两者走**本地种入、零联网**，规避网易云限流抖动）。
- 何时重新审视：若卡片需承载更多操作（播放 / 更多菜单）以至需要专门的操作栏。

## ADR-018：沉浸播放页改用 View Transitions 共享元素（封面放大）+ 当前曲目预载

- 日期：2026-10-04
- 状态：已采纳（**部分修订 ADR-008**：沉浸播放页的「presence + 上滑」降级为无 VT 时的兜底）
- 背景：ADR-008 中沉浸播放页只是「`usePresence` 延迟挂卸 + 整页 `translateY(100%)` 上滑（`np-enter`/`np-exit`）」，与封面本身**没有空间关联**，观感廉价；且首次打开有抖动——大封面重挂载闪占位、歌词现拉、大半径模糊背景首次栅格化。
- 考虑过的方案：① 纯 CSS 增强（更丰富的上滑 / 缩放）；② JS FLIP 手写封面位移；③ 复用 View Transitions 做**共享元素**（小封面 morph 成大封面）。
- 决策：③ + 预载。
  - 新增 `lib/nowPlayingTransition.ts` 的 `startNowPlayingTransition(next)`：支持 VT 且非 reduced-motion 时 `startViewTransition(() => flushSync(setExpanded(next)))`，否则直接 `flushSync`。
  - 封面命名 `np-cover`：PlayerBar 小封面在 `!expanded` 时持名（`PlayerBar.css`），NowPlaying 大封面在 `open` 时持名（`NowPlaying.css`，`data-vt='on'` 门控），**同一时刻仅一个元素持名**。
  - 背景 / 面板的入场交给 `.nowplaying` 上的 **live CSS 动画**（`np-vt-rise` / `np-vt-fade`，仅 `data-vt='on'`）；`np-enter`/`np-exit`/`np-rise` 收进 `:root[data-vt='off']` 降级分支。
  - `App.tsx` 的 `NowPlayingLayer`：VT 能力存在时**同步挂卸**（`show = expanded`，含 reduced-motion），仅在完全不支持 VT 时退回 `usePresence`。
  - 预载：`hooks/useNowPlayingPrefetch`（`current` 变化时 `preloadCover` + decode、`prefetchLyric`）；`lib/lyricCache.ts`（内存歌词缓存 + in-flight 去重）、`lib/imageCache.ts`（已解码封面 URL 表）；`Cover` 首帧按登记表显色。
- 为什么选这个：与 ADR-008 已建成的 VT 基建同构，是顺路径；封面 morph 正是 Apple Music 该转场的灵魂；预载让「点击即瞬时」。
- 为什么不选其他：① 仍缺与封面的空间关联，逃不出「简陋」；② 跨组件树手写 FLIP 需测矩形 + 临时浮层 + 处理挂载时序，代码量高一个数量级，还要复刻内部入场。
- 后果 / 已知边界：
  - **VT 的 DOM 更新回调必须同步**：回调里 `await rAF`（本想等新封面绘制）会**死锁**——转场期间浏览器暂停渲染，回调等 rAF、rAF 等回调结束 → 触发 UA 的「DOM update 超时」中止，并**连带破坏控件**（实测：歌词点击后容器 `scrollTop` 不再生效）。故回调只 `flushSync`，不 await。
  - **同步快照拍到的封面必须已可见**：因回调不能 await，改用 `lib/imageCache.ts` 的「已解码 URL 表」，`Cover` 首帧即按它就绪显色，避免快照拍到 `--bg-elevated-2` 占位底色。
  - **转场期必须摘掉 `.app-content` 的命名**：它是全站唯一命名元素，新旧快照内容相同 → UA 注入 plus-lighter 混合、伪树在 top layer 会**闪白并盖住沉浸页**；`data-np-vt` 于 `startViewTransition` **之前**设置、`finished` 后清除（resolve / reject 两分支都要清）。
  - **`openEntity` 不带走转场的收起**：否则与随后的路由转场重入（一个 VT 活跃期再起一个）。保持不转场的 `setExpanded(false)` —— 与 ADR-008 的路由转场衔接。
  - **只命名封面一个元素**：panel / bg / scrim 用 live 动画——避免命名导致的「live 内容被快照挖空」、歌词滚动冻结与额外全屏快照。
  - Esc / scrim / header 收起键统一走 `startNowPlayingTransition(false)`（`hooks/useKeyboardShortcuts.ts` 同步改）。
  - 完全不支持 VT 的浏览器：退回 presence + `np-enter`/`np-exit` 上滑（见 ADR-008）。
  - **模糊背景半径压到 40px**：全屏 + `scale(1.1)` 的 `blur(80px)` 光栅化偏贵，Chrome 会推迟其首次绘制——表现为「封面 / 歌词 / 控制都就位后，唯独模糊背景约一秒才补上」，重则整层空白、把后面的页面透出来（此前被 `scrim` 的 `backdrop-filter` 糊成「假背景」而掩盖，故长期未被察觉）。降到 40px 后绘制在 300ms 内稳定就位。
- 何时重新审视：若需 panel 入场曲线与封面严格同源（可改命名 panel/bg），或浏览器对「live 动画 + VT 并存」的处理有变。

## ADR-019：主题切换用 View Transitions 做「自按钮圆形揭示」

- 日期：2026-10-04
- 状态：已采纳
- 背景：切换明暗主题原本是**瞬时**的（改 store → 写 `<html data-theme>` → `tokens.css` 的 CSS 变量即刻换色），没有任何过渡。需求：切换时有观感更好的动画，而非单纯的配色渐变。
- 考虑过的方案：① 给颜色加 `transition`（配色渐变）；② 手写 CSS 圆 / 缩放动画；③ View Transitions 的 `clip-path: circle()` 圆形揭示。
- 决策：③。新增 `lib/themeTransition.ts` 的 `startThemeTransition(origin, apply)`：`startViewTransition(() => flushSync(apply))`，圆心取主题按钮中心、半径 `hypot(到最远角)`，经 `--theme-vt-x/-y/-r` 注入 `<html>`；`::view-transition-new(root)` 播放 `theme-reveal`（`circle(0px at …)` → `circle(r at …)`）。`components/Topbar.tsx` 的切换按钮改走此 helper。
- 为什么选这个：与既有 VT 基建（ADR-008 / ADR-018）同构；圆形揭示是 Chrome / Apple 熟悉的高级观感，且天然「从你点的位置展开」。
- 为什么不选其他：① 只是配色渐变，正是要避免的；② 手写圆 / 缩放动画难以覆盖侧栏 / 顶栏 / 播放条等 `position: fixed` 区域。
- 后果 / 已知边界：
  - **根快照的开关**：全站默认 `:root { view-transition-name: none }`（只让 `.app-content` 参与路由转场）；主题转场需**整页**参与，故改为 `:root:not([data-theme-vt]) { view-transition-name: none }`——转场期间给 `<html>` 打 `data-theme-vt` 即恢复根捕获，同时 `:root[data-theme-vt] .app-content { view-transition-name: none }` 摘掉内容区命名（免得它被从根快照挖掉）。标记在 `finished` 后清除（resolve / reject 两分支）。
  - **`useApplyTheme` 必须用 `useLayoutEffect`**：VT 新快照在 `flushSync` 返回后**同步**拍摄，`useEffect` 要到 paint 之后才跑，会把旧主题拍进新快照、令揭示失效。
  - **`mix-blend-mode: normal`** 覆盖 UA 对同源 old/new 层注入的 `plus-lighter`，避免中段提亮。
  - 揭示缓动用 `ease-in-out`（`--ease-ios` 前段过猛，圆几乎瞬铺满、过程不可见）。
  - reduced-motion / 不支持 VT：直连切换（保持原行为）。
- 何时重新审视：若想换揭示形态（斜切 / 缩放），或把该转场扩展到其它「全局换肤」场景。

## ADR-020：封面缓存键以「规范化 URL」去重——固定网易云镜像主机

- 日期：2026-10-06
- 状态：已采纳
- 背景：前端所有图片缓存都以 **URL 字符串**为键（SW 媒体池 `imageKey`、页面就绪登记表 `lib/imageCache.ts`、浏览器 HTTP 缓存）。实测验证（脚本对照同端点两次调用、搜索 vs 详情、同批响应）：网易云对**同一封面**会在 `p1`–`pN.music.126.net` 间**随机轮换主机名**，另有 http/https 混用——同端点两次调用即得 `p4`→`p3`，一批响应里 p1/p3/p4 并存；而**路径（`{hash}/{id}.jpg`）才是封面的稳定身份**。结果：同一封面被拆成多条缓存、命中率大幅下降，切歌 / 翻页时重复下载。曾考虑按「图片类型（歌曲/专辑/歌单/艺人）+ ID」作缓存键。
- 考虑过的方案：① 缓存键改「类型 + ID」；② 后端把封面代理为同源 URL（如 `/img/album/{id}`）；③ 保持以 URL 为键，但**先规范化**（https + 固定镜像主机 + 唯一 `param` 尺寸）。
- 决策：③。新增 `packages/shared/src/image.ts` 的 `canonicalNeteaseImage(url)`（仅匹配 `p\d+.music.126.net`，裸域与其它 CDN 原样放行；`param` 多个只留最后一个），并落到三处：server `netease.ts` 以 `coverUrl(raw, size)` 统一产出封面 / 头像（覆盖已有 `param`，消灭双参数碎片）；web `mediaCache.imageKey` 与 `imageCache` 就绪登记表均以规范化 URL 为键（旧持久化数据中的轮换前 host 与新数据互相命中）；NowPlaying 背景比较同样规范化。
- 为什么选这个：URL 规范化后即是「封面身份 + 尺寸」的稳定字符串，SW / 登记表 / HTTP 缓存 / 持久化数据**全端零结构改动**就完成去重；且**曲目封面即专辑封面**——同专辑 N 首曲共享一条缓存，这正是按路径（而非曲目 ID）去重的收益。
- 为什么不选其他：① 按曲目 ID 会把同一专辑封面重复存 N 份（键粒度错了；若一律升格为专辑 ID，则艺人头像 / 歌单封面又需各自类型分支），且 SW 无法从图片 URL 反查「类型 + ID」，需在页面维护映射表、复杂且有失败面；② 封面流量全部过自家服务器，带宽与延迟成本高，也违背「图片直连 CDN + SW CORS 拉取缓存」的既有设计（ADR-013）。
- 后果 / 已知边界：
  - 规范化固定使用 `p3.music.126.net`（p1–pN 互为镜像、内容一致）；若该主机异常，理论上可换常量 `NETEASE_IMAGE_HOST`，存量缓存键会整体失效一次（7 天 TTL 内自然冲销）。
  - 旧持久化数据（library / 队列）中的旧 host URL 无需迁移：SW 侧 `imageKey` 同样规范化，新旧字符串落同一条缓存。
  - 同一封面不同 `param` 尺寸仍是两条缓存（字节确实不同；当前全端尺寸固定：封面 600y600、头像 300y300）。
  - 音频流 URL **不经**此规范化（host 形态不同、且可能带时效签名，维持 `https()` 原样改写）。
- 何时重新审视：若网易云图片 URL 出现签名 / 时效参数（规范化需保留之）；若前端需要同一封面多档尺寸（可按「规范化 URL 去掉 param」再归并，接受首次尺寸升级重取）。

## ADR-021：弱网播放韧性——缓冲态可视化、停滞看门狗、截断校验与登录引导来源

- 日期：2026-10-06
- 状态：已采纳
- 背景：用户报告「网络不良时进度条还在走，但音乐已经停了」。复现与排查（含 Playwright 逐秒采样）确认了四条互不相同的静默路径：(1) 引擎只绑 6 个事件，`waiting`/`stalled`/`canplay` 全部无人监听，缓冲耗尽后 UI 永远停在「播放中」、无提示无恢复；(2) 弱网下切歌的 `play()` promise 既不 resolve 也不 reject，`isPlaying` 被钉死为 true；(3) 上游 chunked 流被截断时浏览器把已收数据当完整文件、提前触发 `ended`，而 `onEnded` 不校验时长直接切歌，弱网下逐首级联；(4) 音频元素的 `error` 事件无法区分「网络失败」与「VIP/版权受限」，原实现按 MediaError code 猜测，把网络故障也提示成「该曲目暂不可播放 + 登录解锁」。放大器：SW 回源丢 Range 取整文件、SW 与后端全链路无超时。
- 考虑过的方案：恢复手段——① `audio.currentTime = audio.currentTime` 触发重取；② `load()` 重载后回拨位置再播；③ 仅重调 `play()`。停滞判定位置——④ 引擎内嵌定时器；⑤ 独立纯逻辑模块 + rAF 逐帧喂快照。登录引导来源——⑥ 继续按 MediaError code 猜；⑦ 后端 403 经 SW `postMessage` 通知页面。
- 决策：⑤ + ② + ⑦，并补齐其余三项。新增 `src/lib/playbackWatchdog.ts`（纯逻辑、时间注入，便于单测）：`isPrematureEnd(audioDuration, trackDuration)` 以「`audio.duration` 比元数据时长短超过 **10s 且超过 10%**」双阈值判定截断（避开 VBR 估算误差误判，真截断通常差数十秒）；`createWatchdog` 以 `stallMs=5s`、退避 `[10s,15s,20s]`、`maxRetries=3` 判定停滞，**未起播（位置为 0）时不介入**，交由 12s 起播超时统一兜底。引擎逐帧驱动看门狗，`recover` 执行 `load()` + 回拨 `currentTime` + `play()`（`recovering` 标志豁免 `load()` 派发的那次 `pause` 回写），预算耗尽则暂停并提示、**不自动跳歌**。截断场景同一恢复流程，`ended` 不再一律切歌。起播 `play()` 以 `setTimeout` 超时（12s）兜底，`AbortError`（被 load/pause 主动中断）静默；元素处于错误态时先 `load()` 再播，保证故障排除后重试可恢复。缓冲态：`waiting`/`stalled` → `buffering=true`，`playing`/`canplay`/`pause` → false，播放键在缓冲中改显加载动画。登录引导改为⑦：`error` 一律中性文案，`needLogin` 仅由后端 403（`app.ts` 既有的 `fail(..., true)`）经 SW 广播 `STREAM_NEED_LOGIN` 驱动。超时：SW 回源 15s（仅响应头阶段）、后端上游 10s（仅响应头阶段），后端上游非 2xx 时淘汰 `urlCache` 项以便重新解析。
- 为什么选这个：第五条把判定逻辑与 DOM 副作用分离，可直接单测（10 个用例覆盖阈值、退避、清零、中断预算）；`load()` 是唯一能重建媒体管线、重新发起点播请求的手段（`currentTime` 自赋值多数浏览器会忽略，`play()` 不解决「数据已断」）；「未起播不介入」消除了看门狗与起播超时两份机制的互相打断（实测从互相抖动、27s 才闭环降为 12s 干净闭环）；登录引导改由后端 403 驱动后语义可靠，网络故障不再误导用户去登录。
- 为什么不选其他：①/③ 对已断流的元素无效；④ 定时器与 rAF 双时钟难对齐且不可测；⑥ 实测 code 4 既可能是真 VIP 也可能是网络失败（SW 超时后元素即报 code 4），按 code 猜必然误判。此外**不做** body 停滞超时与多路 tee 下载去重——前者需在音频关键路径包装流、引入新失败面，后者需 multi-tee 分发，复杂度/收益比不划算；截断与停滞已由前端兜底。
- 后果 / 已知边界：
  - 恢复用 `load()` 会丢弃已缓冲数据（有 3 次上限与递增退避；播放重新前进 >1s 即清零预算）。
  - 看门狗由 rAF 驱动：**后台标签页不推进**，后台期间的停滞只能在切回前台后检测到（已知边界，未用定时器规避其双时钟问题）。
  - 截断双阈值是保守判据：差不足 10s 的截断按正常结束处理（宁可漏判，不可误判——误判会把正常播完的歌拖入恢复流程）。
  - 起播超时 12s 后若 `play()` 迟到 resolve，会因 `isPlaying` 已为 false 而被 `pause()` 抵消，行为自洽。
  - SW / 后端超时只覆盖连接建立阶段，长音频弱网慢速下载（body 阶段）不受影响，仍由 undici 300s / 生产 nginx 60s 兜底。
  - `buffering` / `playErrorNeedLogin` 为运行时字段，不在 `player` store 的 persist 白名单内，不持久化。
- 何时重新审视：若做音频分片缓存（ADR-012 提及「边下边存」），可据此实现精确续传而非整段重载；若需后台标签页的恢复能力，应改为 `setInterval` 驱动（并接受与 rAF 的时钟并存）；若网易云 CDN 改为稳定长连接，可下调重试参数。
