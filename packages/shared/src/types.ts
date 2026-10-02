/**
 * 前后端共享的类型定义与常量。
 *
 * 该文件同时被 `src/`（浏览器）与 `server/`（Node）引用，
 * 因此不得包含任何运行环境相关的代码（如 DOM / Node API）。
 */

/** 音源服务器（当前仅网易云）。 */
export type MusicSource = 'netease'

/** 播放循环模式。 */
export type RepeatMode = 'off' | 'all' | 'one'

/** 精简后的曲目模型，前后端统一使用该结构。 */
export interface Track {
  /** 曲目在音源内的唯一 ID。 */
  id: string
  /** 曲名。 */
  title: string
  /** 主艺人（多艺人以 `/` 连接）。 */
  artist: string
  /** 专辑名。 */
  album: string
  /** 封面地址（已改写为 https）。 */
  cover: string
  /** 时长（秒）。未知时为 0。 */
  duration: number
  /**
   * 版权标记：`free` 免费可听、`vip` 需会员、`unknown` 未知。
   * 由后端根据网易云 `fee` 字段推断，仅用于 UI 提示，最终能否播放以实际解析为准。
   */
  fee: 'free' | 'vip' | 'unknown'
}

/** 歌单 / 排行榜等合集的精简模型。 */
export interface Playlist {
  id: string
  name: string
  cover: string
  /** 简介。 */
  description?: string
  /** 曲目数量。 */
  trackCount?: number
  /** 播放量（若有）。 */
  playCount?: number
  /** 创建者昵称。 */
  creator?: string
}

/** 一行歌词。 */
export interface LyricLine {
  /** 起始时间（秒）。 */
  time: number
  /** 主歌词文本。 */
  text: string
  /** 翻译（若有）。 */
  translation?: string
}

/** 歌词解析结果。 */
export interface Lyric {
  lines: LyricLine[]
  /** 是否含时间轴（否则为纯文本歌词）。 */
  timed: boolean
}

/** 统一的后端响应包裹。 */
export interface ApiResult<T> {
  ok: boolean
  data?: T
  /** 失败时的错误信息。 */
  error?: string
  /** 需要登录（VIP 曲目未登录等）。 */
  needLogin?: boolean
}

/** 登录状态。 */
export interface LoginStatus {
  logged: boolean
  nickname?: string
  avatarUrl?: string
  /** 用户 ID（用于拉取「我的歌单」）。 */
  userId?: number
  /** 是否 VIP。 */
  vip?: boolean
}

/** 后端 API 基础路径前缀。 */
export const API_BASE = '/api'

/** 音频流代理路径前缀。 */
export const STREAM_BASE = '/stream'

/**
 * 由曲目 ID 构造同源音频流地址。
 *
 * 浏览器 `<audio>` 直接请求该地址，后端负责解析真实 URL、
 * 改写为 https 并支持 Range 分段，从而规避混合内容与跨域问题。
 */
export function streamUrl(id: string, opts?: { level?: string; token?: string }): string {
  const q = new URLSearchParams()
  if (opts?.level) q.set('level', opts.level)
  if (opts?.token) q.set('t', opts.token)
  const qs = q.toString()
  return `${STREAM_BASE}/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`
}

/** 将秒数格式化为 `m:ss`。 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  return `${m}:${String(s - m * 60).padStart(2, '0')}`
}
