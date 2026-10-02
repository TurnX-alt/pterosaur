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
