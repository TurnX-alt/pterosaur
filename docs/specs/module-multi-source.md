# Spec — 多源架构（网易云 + QQ 音乐）

对应模块：`shared/types.ts`、`server/sources/{types,netease,qq,index}.ts`、`server/app.ts`、`server/cli/login.ts`、`web/store/{auth,library,player}.ts`、`web/sw.ts`、`web/lib/{mediaCache,lyricCache,idb}.ts`、`web/pages/*`、`web/components/*`

相关决策：ADR-022（多源架构）、ADR-023（身份锚点仅网易）、ADR-024（QQ 接入方式）、ADR-025（缓存键加源）、ADR-026（搜索分组）。

## 要构建什么

- 目标：把「单一网易云音源」升级为**多源（网易云 + QQ 音乐）**，支持跨源混搭歌单、按源分组的搜索、以及**网易云 / QQ 音乐双二维码登录**。
- 交互形态：搜索页置一行**源 tab**（URL 未带源时默认跟随**活动账号**，见 ADR-027）；登录弹窗置一行**源 tab**（两源均只扫码）；**单活动账号**——登录后不再有登录入口，头像菜单只留「退出登录」与云同步开关；首页/浏览的**发现内容**跟随活动账号（ADR-029）。

## 行为

- 预期行为：
  - **实体身份**：`Track`/`Artist`/`Album`/`Playlist` 均带 `source`；全仓以 `keyOf(e) = \`${sourceOf(e)}:${e.id}\`` 认曲/认实体。`sourceOf` 对缺失 `source` 的旧数据回填 `'netease'`。
  - **音频流**：`streamUrl(source, id)` → `/stream/:source/:id`；后端按源分派适配器解析真实地址（带 15 分钟 LRU，键含源与凭证指纹），https 改写 + Range 转发。**保留 2 段式 `/stream/:id` 别名**（视为缺省源）。
  - **内容路由**：`/api/search`、`/api/search/all`、`/api/songs` 用 `?source=`（默认 netease）；`/api/artist|album|playlist|lyric/:source/:id` 用路径段，并保留 2 段式别名。`/api/discover/*` 与 `/api/user/playlists` 为**网易云专属**，不带源。
  - **能力可缺**：`SourceAdapter` 的可选成员（`searchArtists`/`searchAlbums`/`searchPlaylists`/`artistDetail`/`playlistTracks`/`songDetail`/`qrLoginUrl`/`userPlaylists`）缺失时，路由回 501，`/api/search/all` 对应类别返回空数组并在 `capabilities` 标记，前端隐藏该分类 tab。**登录一律扫码**（无帐密登录）。
  - **登录**：`/api/auth/:source/{status,qr,qr/check,logout}`（**已移除帐密登录**，两源均只扫码）；扫码成功（803）时下发**该源**会话 cookie（仅白名单项，剥离 `Domain`/`Secure`/`SameSite`）。
  - **单活动账号**：最多一个源登录；`/api/auth/:source/qr/check` 命中 803 时，对**其它**源下发其 `logoutCookieNames` 的过期 cookie（防御陈旧会话）。
  - **发现**：`/api/discover/{recommend,playlists,toplists}?source=`（默认 netease）按源分派；`/api/discover/capabilities?source=` 返回 `{recommend,playlists,toplists}` 供前端隐藏不支持的 tab；`SourceAdapter` 的 `recommendPlaylists/toplists/topPlaylists` 为**可选能力**（QQ 无 `toplists`）。
  - **云同步锚点**：`<source>:<账号id>`（网易云 `userId` / QQ `uin`）；`LoginStatus.userId` 为 **string**（见 ADR-028）。
  - **搜索**：URL 未带 `?source=` 时默认跟随活动账号（未登录用缺省源）；不跨源去重。
  - **凭证**：内容接口 `credentialOf(c, adapter) = cookieOf(c, adapter) ?? defaultCredential(adapter.id)`；缺省凭证来自 `.env` 的 `NETEASE_COOKIE` / `QQ_COOKIE`。身份接口仍只取访客本人**网易云** cookie。
  - **缓存**：音频键 `${source}:${id}|${level}`（前端 SW）与 `${source}|${id}|${level}|${cred}`（后端 urlCache）；封面 `imageKey(url)` **不加源**；歌词内存缓存以 `keyOf(track)` 为键。
  - **搜索**：按选中源拉取（默认网易云，不默认双发），`source` 写进 URL；不跨源去重。

## 输入 / 输出

- 输入：HTTP 请求（`:source` 段 / `?source=`、cookie、Range）；登录接口 JSON body（`{phone,password}` 仅网易云）。
- 输出：`ApiResult<T>`（实体均带 `source`）、音频字节流（含 `Content-Range`/`Accept-Ranges`）、登录成功时的 `Set-Cookie`。

## 约束

- 前端永不直连上游域名；音频地址一律 https；封面按源规范化（`canonicalNeteaseImage` / `canonicalQqImage`，稳定 URL 作缓存键，对齐 ADR-020）。
- `shared/` 不得引入 Node/DOM 专有 API（前后端共用）。
- 后端默认无状态（例外见 ADR-014 / ADR-016）。
- **QQ 取流依赖 `sign`**：见 ADR-024 的 VMP 风险；失败须优雅降级为 403/「暂不可播放」，不得崩。

## 边界条件

- 非法 `:source`（如 `pl-…`、`spotify`）→ 404；未注册的源 → 404。
- 缺省源语义：2 段式路由（`/stream/:id`、`/api/artist/:id`、`/playlist/:id` 等）视为 netease。
- 本地自建歌单仍走 2 段式 `/playlist/pl-xxx`，`isLocal = id.startsWith('pl-')` 不变。
- 旧持久化数据缺 `source` → `sourceOf` 回填 `'netease'`，不破坏性回写。
- QQ 未登录 / 会员曲：`songUrl` 返回 null → 403 `needLogin`；SW 广播 `STREAM_NEED_LOGIN` 带 `source`，前端「登录解锁」引导到**该源**登录。
- QQ 适配器无 `qrLoginUrl`：`pnpm log-in --source=qq` 明确提示改用网页扫码（QQ 二维码是图片，终端无法渲染）。

## 验收标准

- [x] `packages/shared/src/types.test.ts`：`keyOf`/`sourceOf`/`isMusicSource`/`streamUrl` 带源；`isMusicSource('pl-abc') === false`。
- [x] `apps/server/src/sources/netease.test.ts`：归一化产出 `source === 'netease'`。
- [x] `apps/server/src/sources/qq.test.ts`：QQ 归一化（老/new_json 字段、缺字段降级、封面 URL、`pay_play`/`payplay` 两种版权键）、`qqSign` 确定性/前缀、`hash33`、cookie 收敛白名单。
- [x] **真实环境验证**（已跑）：`searchSongs`/`searchAlbums`/`searchArtists`/`searchPlaylists`、`albumDetail`、`artistDetail`（按名搜索）、`playlistTracks`、`getLyric` 均返回正确数据；免费曲 `songUrl`（歌单/专辑/搜索来源皆然）取流 HTTP 200；VIP 曲匿名返回 null（需登录）。**全程无需 sign**。
- [ ] **仍未验证**：QQ 扫码登录全流程（需真人扫码，登录后 VIP 曲是否可播）、`QQ_COOKIE` 缺省凭证、频控表现；e2e 带源 URL 全绿（需 `pnpm test:e2e`）。
- [x] `apps/server/src/app.test.ts`：按源凭证隔离；`/stream/:source/:id` 分派 + 2 段别名 + 未知源 404；`source=qq` 走 QQ 适配器；803 同时清其它源 cookie；`/api/discover/capabilities`。
- [x] **真机验证**：QQ 的 `recommendPlaylists`/`topPlaylists`（`fcg_get_diss_by_tag`）与 `/api/discover/recommend?source=qq` 均返回真实歌单；`toplists` 对 QQ 返回 501；netease 回归正常；capabilities 正确。
- [x] `apps/web/src/store/library.test.ts` / `player.test.ts`：**两源共享原始 id 不互相覆盖**（跨源回归护栏）。
- [x] `apps/web/src/lib/mediaCache.test.ts`：`audioKey(source,id)` 键形、两源同 id 不同键；`imageKey` 不含源。
- [x] `apps/web/src/lib/lyricCache.test.ts`：按 `keyOf` 隔离。
- [x] `apps/web/src/components/{TrackList,NowPlaying,Cards}.test.tsx`：按 `keyOf` 高亮/跳转。
- [x] `pnpm typecheck` 与 `pnpm test` 全绿。
- [ ] **待实测**（有网络环境）：QQ `searchSongs/Albums/Artists/Playlists`、`albumDetail`/`artistDetail`/`playlistTracks` 的真实返回（字段命名容错已做，见 `qq.test.ts`）；`songUrl` 经典 `sign` 是否被 VMP 校验；e2e 带源 URL 全绿。

## 完成定义

- 如何判定已完成：单测与类型检查全绿；`pnpm test:e2e` 在外壳/搜索/播放组带源 URL 后全绿；手动验证「网易云照常运行」「网易云 + QQ 双登录并存」「QQ 搜索/取流按实测结果可用或优雅降级」「混搭歌单播放与翻录」。
