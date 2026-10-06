import type {
  Album,
  Artist,
  AudioLevel,
  LoginStatus,
  Lyric,
  MusicSource,
  Playlist,
  Track,
} from '@pterosaur/shared/types'

/** 扫码轮询结果，`code` 沿用网易云契约：800 过期 / 801 等待 / 802 待确认 / 803 成功。 */
export interface QrCheckResult {
  code: number
  /** 成功时上游返回的原始 Set-Cookie 字符串数组。 */
  cookies?: string[]
  message?: string
}

/**
 * 音源适配器：把某个音源的私有 API 收敛为共享模型。
 *
 * 必选成员是「任何源都应具备」的播放公共面与登录态查询；可选成员代表「能力可缺」——
 * 路由层对缺失成员回 501、前端隐藏对应入口，从而允许新源先只实现一部分能力上线，
 * **包括「不支持登录」的源**（如咪咕无扫码登录，缺 `qrKey` 即视为无登录入口）。
 */
export interface SourceAdapter {
  readonly id: MusicSource
  /** 会话必需 cookie 名单：下发与回传均只处理这几项。无登录源可为空数组。 */
  readonly sessionCookieNames: readonly string[]
  /** 退出登录时需要下发的过期 cookie 名称。无登录源可为空数组。 */
  readonly logoutCookieNames: readonly string[]

  /* ---- 内容（必选） ---- */
  searchSongs(keywords: string, limit: number, cred?: string): Promise<Track[]>
  albumDetail(
    id: string,
    cred?: string,
  ): Promise<{ album: Album; tracks: Track[] }>
  /** 解析播放地址；`level` 为**抽象音质档位**（见 shared `AudioLevel`），各源自行映射/降级。 */
  songUrl(id: string, cred?: string, level?: AudioLevel): Promise<string | null>
  getLyric(id: string, cred?: string): Promise<Lyric>

  /* ---- 登录（必选面） ---- */
  /** 查询登录态。无登录能力的源（如咪咕无扫码登录）返回 `{ logged: false }` 即可。 */
  loginStatus(cred?: string): Promise<LoginStatus>
  cookieHeaderFromSetCookies(cookies?: string[]): string | undefined
  /** 音频 CDN 需要的附加上游请求头（如 QQ 需要 Referer）。 */
  streamHeaders?(id: string): Record<string, string>

  /* ---- 内容（可选能力） ---- */
  searchArtists?(
    keywords: string,
    limit: number,
    cred?: string,
  ): Promise<Artist[]>
  searchAlbums?(
    keywords: string,
    limit: number,
    cred?: string,
  ): Promise<Album[]>
  searchPlaylists?(
    keywords: string,
    limit: number,
    cred?: string,
  ): Promise<Playlist[]>
  artistDetail?(
    id: string,
    cred?: string,
    name?: string,
  ): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }>
  playlistTracks?(
    id: string,
    cred?: string,
  ): Promise<{ playlist: Playlist; tracks: Track[] }>
  songDetail?(ids: string[], cred?: string): Promise<Track[]>

  /* ---- 发现（可选能力；首页/浏览的推荐） ---- */
  recommendPlaylists?(limit: number, cred?: string): Promise<Playlist[]>
  toplists?(limit: number, cred?: string): Promise<Playlist[]>
  topPlaylists?(limit: number, cat?: string, cred?: string): Promise<Playlist[]>

  /* ---- 登录（可选能力：扫码） ---- */
  /**
   * 扫码登录三件套。**缺省即视为该源不支持登录**——`app.ts` 的 auth 路由据此回 501，
   * 前端据 `LoginStatus.loginable` 隐藏登录入口（见 ADR-032）。目前仅咪咕如此。
   */
  qrKey?(cred?: string): Promise<string>
  qrCreate?(key: string, cred?: string): Promise<string>
  qrCheck?(key: string, cred?: string): Promise<QrCheckResult>
  /** 生成二维码**内容 URL**（供终端自行渲染）。 */
  qrLoginUrl?(key: string, cred?: string): Promise<string>
  userPlaylists?(uid: string, cred?: string): Promise<Playlist[]>
}
