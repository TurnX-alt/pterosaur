# Research — Spotify 接入与多源混合可行性

> 状态：**调研中（未决）**。本文只是探查结论与开放问题，尚未形成 ADR；任何设计决策待确认后再固化。
> 相关：`docs/ARCHITECTURE.md`、`docs/DECISIONS.md`（ADR-001 / 002 / 011 / 014 / 016）、`docs/specs/module-audio-proxy.md`。

## 一、结论摘要

- **「像代理网易云那样代理 Spotify 网页播放器」不可行。** 卡点不是工程量，而是 **Spotify 网页音频受 Widevine DRM 保护**：服务端拿不到任何明文可播放地址。
- **多源混合（metadata + 播放）在架构上可行**，本仓库的「归一化层 + 共享模型 + `/stream` 代理」天然支持；但能接入的源必须是**愿意提供明文音频**的源。
- **Spotify 只能贡献元数据**，且该路径在 2026 年被官方大幅收紧，对自托管项目基本不可达。
- 若只是「元数据用 Spotify、音频在别处解析」，属可行的 **spotDL 模式**，但那是另一个量级的功能。

## 二、背景：为什么网易云代理成立、Spotify 不成立

本项目护城河 = 「免登录畅听」+「同源音频代理」，前提是**上游愿意给出明文音频地址**。

| | 网易云（现状） | Spotify 网页播放器 |
|---|---|---|
| 音频形态 | 明文 CDN 直链（`song_url_v1` 返回） | **Widevine 加密流** |
| 服务端能否拿到 URL | 能（`server/netease.ts: songUrl()`） | **不能**，只有加密分片 + license |
| `/stream/:id` 语义 | 转发 + https 改写 + Range | 需先解密（= 规避 DRM） |
| 免登录可听 | 是（`NETEASE_COOKIE` 缺省凭证，ADR-014） | 否，且要 Premium |

Spotify 不给明文是**商业设计**，非技术疏漏。

## 三、Spotify 三条（四条）路线评估

### A. 官方 Web API（仅元数据）
- 能力：搜索 / 专辑 / 艺人 / 歌单 / 曲目元数据；`Player` 端点只是**遥控已注册的 Connect 设备**，**不向应用串流音频**。
- 2026 现状（利空）：2024-11-27 起新应用的推荐 / 音频特征 / 30s `preview_url` 被限制；**2026-02-06** 开发模式**强制 Premium**、Client ID 限 1、授权用户由 25 → **5**、批量曲目元数据 / 艺人热门曲目 / 新发行 / 市场可用性被移除；扩额需**注册企业 + 25 万 MAU**。
- 判定：**元数据源亦不可用**（配额 + 门槛）。

### B. 抓网页内部接口（spclient / pathfinder）
- 可拿网页同款元数据（含实时歌词）；**音频仍 Widevine 加密**。
- 判定：**音频不可行；元数据属灰色**。

### C. 解密 Widevine（字面意义的「代理网页播放器」）
- 做法（如 `glomatico/spotify-web-downloader`）：设备 `.wvd`（KeyDive 从安卓机提取 CDM 密钥）+ 浏览器 cookie → 服务端解密 → ffmpeg 重封装。
- 风险：**规避技术保护措施**，在多国独立违法（DMCA §1201 / 欧盟 EUCD）；违反 ToS；**设备密钥会被吊销** → 403；模拟器提取的 key 常失效。
- 判定：**不可行且不建议，本项目不实现**。

### D. 重实现 Spotify Connect 协议（librespot）
- 用账号自带 stored credentials + **AudioKey（Shannon/Mercury 协议，非 Widevine）** 解密，作为 Connect 设备输出 PCM。
- 判定：**技术可行、法律风险低**，但需 **Premium**；它是「把服务器变成播放设备」的**串流客户端**，而非「代理」，与「浏览器持 cookie、后端无状态转发」模型**不兼容**——是独立子系统。
- 若要 Spotify 音质，这是唯一体面路径；但应定位为「**新增一个播放后端**」而非「代理 Spotify 网页」。

## 四、可接入的明文音源候选（若目标是真正的多源出声）

优先选**愿意给明文 / 标准流**、能沿用现有 `/stream` 代理模型的源：YouTube（yt-dlp）、SoundCloud、Internet Archive、Jamendo、Bandcamp 等。成本远低于 Spotify。

## 五、多源改造面（文件级）

`MusicSource` 类型已预留（`packages/shared/src/types.ts:9`，当前仅 `'netease'`）。核心是把「全局唯一 `id`」升级为「**源 + id**」。

| 位置 | 现状 | 改造 |
|---|---|---|
| `packages/shared/src/types.ts` | `Track.id` 全局唯一；`streamUrl(id)` | 加 `source: MusicSource`；`streamUrl(source, id)`；加稳定键助手 `keyOf(e) = source + ':' + id` |
| `apps/server/src/app.ts` | `/stream/:id` | → `/stream/:source/:id`，按源分发；凭证按源解析 |
| `apps/server/src/netease.ts` | 单一实现 | 抽成 `sources/netease.ts` + `SourceAdapter` 接口 |
| `apps/web/src/store/library.ts` | 收藏 / 最近 / 歌单以 `t.id` 去重（46/56/78/87 行） | 改用 `keyOf(t)` |
| `apps/web/src/store/player.ts` | `findIndex(t.id === …)`（267/273/307 行） | 改用 `keyOf` |
| `apps/web/src/sw.ts` + `lib/mediaCache.ts` | `/stream/:id`；缓存键 `${id}|${level}` | 解析源段；缓存键加源前缀 |
| `apps/web/src/lib/download*.ts` | `streamUrl(track.id)` | 传 `track.source` |
| `apps/web/src/App.tsx` 路由 | `/artist/:id` `/album/:id` `/playlist/:id` | 加源段或查询参数 |
| UI（`TrackList` / `EntityCards` / `Search`） | 无源概念 | 加**源徽标**与源筛选 |

**数据迁移**：`Track` 增 `source` 属兼容变更；旧数据（收藏 / 最近 / 队列 / 云同步载荷）缺 `source`，读取时回填 `'netease'`。云同步 `isSyncEnvelope` 为宽容解析（ADR-016），旧载荷仍合法。

## 六、开放设计问题（待决）

### Q1. 多源搜索如何整合？
- 候选：① 各源并行扇出（`Promise.allSettled`）+ **按源分组 / 源徽标**；② 归一化打分后跨源排序（不可比，脆弱）；③ 主源优先 + 次源补齐。
- 难点：跨源**打分不可比**、跨源**去重需实体解析**（ISRC 或 title+artist 模糊）、慢源不阻塞。
- 倾向（未定）：**源分组 + 源筛选 chip**，v1 不做自动跨源实体合并；曲目级「同曲不同源」分组待有 ISRC 后再议。

### Q2. 多账户绑定是否意味着需要真正的用户账户系统？
- 现状：**无应用级账号**。登录 = 用户本人在浏览器持有的网易云 cookie；后端无状态（唯一例外：ADR-014 缺省凭证、ADR-016 云同步按网易云 `userId`）。
- 关键问题：**什么身份来统一「绑定」？** 云同步已用网易云 `userId` 作锚；多源后若某用户只绑了非网易云源，则**无身份锚**，云同步失效。
- 候选：
  - **A. 无应用账号**：每源会话各自独立留在浏览器，「绑定」= 浏览器同时持多源会话；跨源数据（混搭歌单）仍在本地 IDB。零新基建，但「绑定」不可跨设备。
  - **B. 应用级账号系统**：自有账号 + 服务端存绑定。作用域大增，且**直接违背现 PRD / AGENTS 的「不做多用户账号体系」非目标**。
  - **C. 混合 / 委托身份**：无自有密码，引入一个**与源无关的 `profileId`**（本地生成，可被「登录某一源」认领以获得可移植性），绑定与 library 挂在该 id 下。保持「免登录可用」承诺。
- 倾向（未定）：**C**——先把身份抽象为「源无关的 profileId」，是否可移植（云同步）作为其属性，而非一开始就上账号系统。

### Q3. 多源能否混搭歌单？
- **数据上几乎已成立**：`LocalPlaylist.tracks: Track[]` 存的是**完整 Track 对象**（`store/library.ts:65`），异源曲目并置无结构障碍。
- **唯一硬阻塞**：以 `t.id` 认曲的假设——增删曲、队列定位、封面 / 音频缓存键、翻录均以 `t.id` 为键。升级为 `keyOf`（源+id）后即可混搭。
- **真正的限制是可播放性**：DRM 源（Spotify 无明文）**无法进入可播放歌单**，否则是死条目——必须标记「不可播放 / 需某源登录」并在播放时显式跳过。**故「混搭歌单」能否成立，取决于成员源是否都能出明文音频**，而非歌单模型本身。

## 七、三个问题的收敛点

Q1 要实体带 `source`（结果的身份）；Q2 要一个**首方 `profileId`**（绑定的身份）；Q3 要 `source+id` 作成员键（曲目的身份）。**三者共同指向同一基础决策：把 `source` 引入实体模型，并为「身份」定义首方 `profileId`，再决定其是否可移植（以及如何移植）。**

## 八、建议

1. **先做多源基础设施**（`source` 字段 + 分源 stream 路由 + `SourceAdapter` 接口 + `keyOf` + 缓存键 + 迁移），当前只有 netease，为后续留门。
2. **接非 DRM 源验证抽象**（如 SoundCloud / Internet Archive），跑通混合歌单与多源搜索。
3. **Spotify 只考虑「元数据源」或「独立 Connect 后端」**，不做网页播放器 DRM 解密。
4. 若确认不做 Spotify 音频，应在 `DECISIONS.md` 留一条 ADR 记录**「为何不做 Spotify Web 代理（DRM）」**。

## 九、参考来源

- FOSDEM 2026 — *Reverse Engineering the World's Largest Music Streaming Platform*（slides）：Spotify 基础设施（ApResolve / Accesspoint / Login5 / Spclient / Dealer）、AudioKey + Shannon/Mercury（**非 Widevine**）。
- Spotify Developer Blog — *Update on Developer Access and Platform Security*（2026-02-06）：开发模式需 Premium、5 用户、端点裁剪。
- TechCrunch（2026-02-06）：开发模式 Premium 化、测试用户 25 → 5、扩额门槛。
- Spotify Developer Blog — *Introducing some changes to our Web API*（2024-11-27）：推荐 / 音频特征 / 30s preview 限制。
- `glomatico/spotify-web-downloader`（PyPI）+ issue #70：`.wvd` + cookie → Widevine 解密；license 403 脆弱性。
- `librespot-org/librespot` + issue #1130：Connect 协议重实现，需 Premium。
- `castlabs/electron-releases` #56：Spotify 网页播放器 Widevine license 报错（佐证网页音频走 Widevine）。
