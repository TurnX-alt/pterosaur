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
