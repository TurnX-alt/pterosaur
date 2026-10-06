# Research — 咪咕音乐接入

> 状态：**已落地**（第三音源，v1 无登录）。相关：`docs/ARCHITECTURE.md`、`docs/DECISIONS.md`（ADR-022 / ADR-024 / ADR-031 / **ADR-032**）、`apps/server/src/sources/migu.ts`。
> 本文记录**实测确认**的接口与边界（2026-10）。

## 一、结论摘要

- **咪咕的音频是明文 MP3/FLAC**（`freetyst.nf.migu.cn` CDN，带 `Accept-Ranges`、`content-type: audio/mpeg`、完整曲长），与 QQ 音乐同构——**可直接沿用现有 `/stream/:source/:id` 明文代理模型，不涉及任何 DRM**。
- **全部端点免登录免签名**（2026-10 实测均 HTTP 200）。
- **无扫码登录**：咪咕的登录是手机号/短信（`passport.migu.cn`），与现有的「扫码」模型不符。v1 不做登录 → VIP 曲匿名不可播（复用既有 `403 needLogin`）。可选缺省凭证 `MIGU_COOKIE`。
- 排查中遇到的 **MRC/XTEA 加密是「卡拉OK 歌词」格式**（密钥硬编码在客户端），**与音频无关**，不构成绕过保护措施。

## 二、为什么成立（明文音频，非 DRM）

| 项       | 咪咕                                                                        | 结论                                           |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| 取流返回 | `data.url` → `freetyst.nf.migu.cn/.../MP3_128_16_Stero/xxx.mp3?channelid=…` | **明文**，`audio/mpeg`，`Accept-Ranges: bytes` |
| 曲长     | 完整（实测 1.5–4.4 MB）                                                     | 非试听片段                                     |
| DRM      | 无（URL 带裸 Key/播放会话，但不加密内容）                                   | 可代理、可缓存、可翻录                         |

> 对比被否决的 Spotify：网页音频走 Widevine（服务端拿不到明文）。咪咕与此不同。

## 三、端点清单（实测 2026-10）

| 能力         | 端点                                                                                    | 说明                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 搜索（聚合） | `c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do`                                | `searchSwitch` 分类；返回 `songResultData` / `albumResultData` / `singerResultData` / `songListResultData` |
| 歌曲详情     | `app.u.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2&resourceId=`     | **批量参数不可用**（`resourceIds` 报 200000），故 `songDetail` 逐条                                        |
| **取流**     | `app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0?contentId=&resourceType=2&toneFlag=` | 返回 `data.url`；`copyrightId` **非必需**（带则更稳，用于带 cookie 的 VIP 路径）；VIP 匿名无 `url`         |
| 歌词         | 同上响应的 `lrcUrl` / `trcUrl`                                                          | **明文 LRC**，VIP 匿名亦可取到                                                                             |
| 专辑         | `MIGUM3.0/resource/album/v2.0` + `MIGUM3.0/resource/album/song/v2.0`                    | 详情 **不含曲目**，曲目另取                                                                                |
| 歌单         | `resource/playlist/v2.0` + `MIGUM3.0/resource/playlist/song/v2.0`                       | 曲目在 `songList`                                                                                          |
| 歌手         | `bmw/singer/song/v1.0`（+`type=1`） / `bmw/singer/album/v1.0`                           | **CMS `view` 结构**：歌曲藏在 `ZJ-Singer-Song-Item.songItem`；专辑为 `ZJ-Album-Item`                       |
| 推荐歌单     | `bmw/index-show/recommend-playlist/v3.0`                                                | `data.playLists[]`（CMS，`resId` / `txt` / `img`）                                                         |
| 排行榜       | `pc/bmw/rank/rank-index/v1.0` + `bmw/rank/rank-info/v1.0?rankId=`                       | 榜内曲目 `songData` 是 **JSON 字符串**（需 `JSON.parse`）                                                  |

**请求头**：`Referer: https://m.music.migu.cn/`、`channel: 014X031`、移动端 UA。

**字段命名两套**（归一化需兼容）：搜索用 `singers`/`albums`/`imgItems`；列表/详情用 `singerList`/`album`/`img1..3`。

## 四、音质档映射

`AudioLevel → toneFlag` 候选链（不可得逐级降级，见 ADR-031 语义）：

| 抽象档          | 候选链                    |
| --------------- | ------------------------- |
| standard        | `PQ`                      |
| higher / exhigh | `HQ` → `PQ`               |
| lossless        | `SQ` → `HQ` → `PQ`        |
| hires           | `ZQ` → `SQ` → `HQ` → `PQ` |

实测：**免费曲仅 `PQ`（128k）可得**；`listen` 对不可得档**不自动降级**（直接不返回 `url`），故适配器自己逐级降级。

## 五、封面

- 主机 `d.musicapp.migu.cn` **单一稳定**（无轮换）→ **无需规范化**（ADR-020 不适用）。
- 三档 `imgSizeType` 是**三个不同 hash 的文件**：`01`=200²、`02`=400²、`03`=800²。适配器取 `03`（大图）。
- ⚠️ **不降档**：因三档是不同文件，`coverAt` 无法改写 → 对咪咕 URL **原样返回**，列表缩略图也拉大图（相对 ADR-031 的偏差，见 ADR-032）。

## 六、登录

- 咪咕**无扫码登录**（手机号/短信）。v1 **不实现登录**：适配器不提供 `qrKey/qrCreate/qrCheck`（三者已改为 `SourceAdapter` 的**可选**成员）；`app.ts` 的 auth 路由对缺省者回 **501**；`LoginStatus.loginable=false` 使前端隐藏登录入口与「登录解锁」。
- 可选缺省凭证 `MIGU_COOKIE`（`.env`）：手工提供咪咕会话可解锁 VIP（未经实测，待有账号者验证）。

## 七、法律灰度

与现有 QQ 音乐同级：抓未公开接口 + 免费畅听。**非** DRM 绕过（音频本为明文）。自托管个人使用，风险自担。

## 八、已知风险 / 边界

- 咪咕对**匿名请求有频控**（`search_all` 尤其敏感）；建议沿用「默认源」策略避免高频触达。
- 歌手/推荐端点返回 CMS「view」结构，字段散且易变。
- VIP 曲匿名不可播；`MIGU_COOKIE` 未经实测。
- 封面不降档（见五）。
- 上游任何改版都可能使适配器失效（与 ADR-024 的 QQ 风险同级）。

## 九、参考

- 社区实现：`migu-api-enhanced`（npm，含端点与 `decryptMrc` 实现）、`github-zc/wp_MusicApi`、`JiuLing-zhang/NetMusicLib`。
- 本文所用端点均经本机实测（搜索/专辑/歌单/歌手/推荐/排行/取流/歌词）。
