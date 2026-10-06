/**
 * 咪咕音乐音源适配器（**自研最小实现**）。
 *
 * 端点选择（实测 2026-10 均 HTTP 200，**免登录免签名**）：
 * - 搜索聚合 `c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do`（`searchSwitch` 分类）
 * - 歌曲详情 `app.u.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do`
 * - 取流     `app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0`（`toneFlag` 档位；返回**明文** mp3/flac）
 * - 专辑     `MIGUM3.0/resource/album/{v2.0,song/v2.0}`
 * - 歌单     `resource/playlist/v2.0` + `MIGUM3.0/resource/playlist/song/v2.0`
 * - 歌手     `bmw/singer/{song,album}/v1.0`（CMS `view` 结构，歌曲藏在 `songItem` 里）
 * - 发现     `bmw/index-show/recommend-playlist/v3.0`、`pc/bmw/rank/rank-index/v1.0` + `bmw/rank/rank-info/v1.0`
 *
 * 音频是 `freetyst.nf.migu.cn` 上的明文 MP3/FLAC（带 `Accept-Ranges`），**不涉及 DRM**，
 * 故完全沿用既有 `/stream` 明文代理模型。
 *
 * ⚠️ **已知边界（见 ADR-032）**：
 * - **无扫码登录**（咪咕用手机号/短信），本适配器**不提供** `qrKey/qrCreate/qrCheck`；
 *   VIP 曲匿名取流为空 → `null`（前端「暂不可播放」）。可选缺省凭证 `MIGU_COOKIE` 可解锁 VIP。
 * - 咪咕对匿名请求有**频控**。
 * - 封面取 `imgSizeType==='03'`（800×800）单档；`coverAt` 对其原样返回（不降档，与 ADR-031 有偏差）。
 */

import { LRUCache } from 'lru-cache'
import {
  DEFAULT_AUDIO_LEVEL,
  type Album,
  type Artist,
  type AudioLevel,
  type LoginStatus,
  type Lyric,
  type Playlist,
  type Track,
} from '@pterosaur/shared/types'
import { parseLrc } from '@pterosaur/shared/lyric'
import type { SourceAdapter } from './types.js'

const UA =
  'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const REFERER = 'https://m.music.migu.cn/'
/** 咪咕客户端渠道号（实测固定值即可）。 */
const CHANNEL = '014X031'

const SEARCH_ALL =
  'https://c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do'
/** 分类型搜索单曲：**带 `duration`**（聚合搜索不含时长，会让进度条失真）。 */
const SEARCH_SONG = 'https://app.c.nf.migu.cn/bmw/search/song/v1.0'
/** 分类型搜索歌手：带 `imgs` 头像 / 简介（聚合搜索只给 `{id,name}`）。 */
const SEARCH_SINGER = 'https://app.c.nf.migu.cn/bmw/search/singer/v2.0'
const RESOURCE_INFO =
  'https://app.u.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do'
const LISTEN = 'https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0'
const ALBUM_INFO = 'https://app.c.nf.migu.cn/MIGUM3.0/resource/album/v2.0'
const ALBUM_SONG = 'https://app.c.nf.migu.cn/MIGUM3.0/resource/album/song/v2.0'
const PLAYLIST_INFO = 'https://app.c.nf.migu.cn/resource/playlist/v2.0'
const PLAYLIST_SONG =
  'https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0'
const SINGER_SONG = 'https://app.c.nf.migu.cn/bmw/singer/song/v1.0'
const SINGER_ALBUM = 'https://app.c.nf.migu.cn/bmw/singer/album/v1.0'
const RECOMMEND_PLAYLIST =
  'https://app.c.nf.migu.cn/bmw/index-show/recommend-playlist/v3.0'
const RANK_INDEX = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0'
const RANK_INFO = 'https://app.c.nf.migu.cn/bmw/rank/rank-info/v1.0'

/** 排行榜 id 前缀：把「排行榜」与「歌单」区分开，`playlistTracks` 据此分派。 */
const RANK_PREFIX = 'rank:'

/* ============================ HTTP ============================ */

type Json = Record<string, unknown>

/** 发一次请求并解析 JSON（失败返回空对象，不抛）。 */
async function miguFetch(url: string, cookie?: string): Promise<Json> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Referer: REFERER,
    channel: CHANNEL,
    Accept: 'application/json, text/plain, */*',
  }
  if (cookie) headers.Cookie = cookie
  const res = await fetch(url, { headers })
  const text = await res.text().catch(() => '')
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {}
  } catch {
    return {}
  }
}

/** 取纯文本（歌词文件用）。 */
async function miguFetchText(url: string, cookie?: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Referer: REFERER,
  }
  if (cookie) headers.Cookie = cookie
  const res = await fetch(url, { headers })
  return res.text().catch(() => '')
}

/* ============================ 工具 ============================ */

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 把 `http://` 改写为 https。 */
function https(url?: string): string {
  return url ? url.replace(/^http:\/\//, 'https://') : ''
}

/** 年份：接受 `YYYY-MM-DD` / `YYYYMMDDHHmmss` / 时间戳。 */
function yearOf(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const s = String(v)
  const y = /^(\d{4})/.exec(s)
  if (y) return Number(y[1])
  const n = Number(v)
  if (Number.isFinite(n) && n > 0) return new Date(n).getFullYear()
  return undefined
}

/**
 * 咪咕封面 / 头像地址规范化。主机 `d.musicapp.migu.cn` **单一稳定**（无轮换），故无需换主机；
 * 但**列表 / 歌手条目的 `imgN` 是相对路径**（`/data/oss/...`），须补全主机——否则破图。
 * `coverAt` 对咪咕 URL 原样返回（不降档，见文件头边界说明）。
 */
const MIGU_IMAGE_BASE = 'https://d.musicapp.migu.cn'
export function canonicalMiguImage(url?: string): string {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${MIGU_IMAGE_BASE}${url}`
  return url.replace(/^http:\/\//, 'https://')
}

/* ============================ 归一化 ============================ */

interface MiguImg {
  imgSizeType?: string
  img?: string
}

/** 曲目（两种来源：搜索用 `singers`/`albums`/`imgItems`，列表/详情用 `singerList`/`album`/`imgN`）。 */
interface RawMiguSong {
  id?: string | number
  contentId?: string | number
  songId?: string | number
  name?: string
  songName?: string
  singers?: { id?: string | number; name?: string }[]
  singerList?: { id?: string | number; name?: string }[]
  /** 歌手页/详情页的单字符串歌手（`resourceinfo` 用）。 */
  singer?: string
  albums?: { id?: string | number; name?: string }[]
  album?: string
  albumId?: string | number
  imgItems?: MiguImg[]
  albumImgs?: MiguImg[]
  img1?: string
  img2?: string
  img3?: string
  duration?: number | string
  /** `resourceinfo` 的时长字符串（如 `"00:03:02"`）。 */
  length?: string
  showTags?: string[]
  vipType?: string | number
  /** 档位列表；`showTag` 内含 `vip` 表示该曲为 VIP（搜索 / 详情条目用）。 */
  newRateFormats?: { formatType?: string; showTag?: string[] }[]
  rateFormats?: { formatType?: string; showTag?: string[] }[]
}

/** 封面尺寸优先级：03=800 / 02=400 / 01=200（实测）。 */
const IMG_PREFERENCE = ['03', '02', '01'] as const

/** 从曲目（或专辑详情）里挑最大一档封面。 */
function pickCover(raw: {
  imgItems?: MiguImg[]
  albumImgs?: MiguImg[]
  img1?: string
  img2?: string
  img3?: string
}): string {
  const items = raw.imgItems ?? raw.albumImgs
  if (Array.isArray(items) && items.length) {
    for (const t of IMG_PREFERENCE) {
      const hit = items.find((i) => i?.imgSizeType === t && i.img)
      if (hit?.img) return canonicalMiguImage(hit.img)
    }
    return canonicalMiguImage(items.find((i) => i?.img)?.img)
  }
  // 列表/详情用 imgN（01=200 / 02=400 / 03=800），优先大图
  return canonicalMiguImage(raw.img3 ?? raw.img2 ?? raw.img1)
}

/** 时长（秒）：优先数字 `duration`，退化解析 `resourceinfo` 的 `length`（`mm:ss` / `hh:mm:ss`）。 */
function durationOf(raw: RawMiguSong): number {
  if (raw.duration != null && raw.duration !== '')
    return Math.round(num(raw.duration))
  const len = str(raw.length)
  if (len.includes(':')) {
    const parts = len.split(':').map(Number)
    if (parts.length && parts.every((p) => Number.isFinite(p))) {
      return parts.reduce((acc, p) => acc * 60 + p, 0)
    }
  }
  return 0
}

/**
 * 由版权标记推断 fee。`vip` 信号散在多处：列表条目的 `showTags`、搜索 / 详情的 `vipType`、
 * 各档位的 `showTag`——任一命中即 VIP（否则视为免费）。
 */
function feeOf(raw: RawMiguSong): Track['fee'] {
  if ((raw.showTags ?? []).includes('vip')) return 'vip'
  const vt = str(raw.vipType)
  if (vt && vt !== '0') return 'vip'
  for (const f of raw.newRateFormats ?? raw.rateFormats ?? []) {
    if ((f?.showTag ?? []).includes('vip')) return 'vip'
  }
  return 'free'
}

/** 将咪咕原始曲目归一化为共享 Track（兼容两套字段命名）。 */
export function normalizeMiguTrack(raw: RawMiguSong): Track {
  const singers = (raw.singers ?? raw.singerList ?? []).filter(Boolean)
  const artistRefs = singers
    .filter(
      (s): s is { id: string | number; name: string } =>
        s?.id != null && !!s?.name,
    )
    .map((s) => ({ id: str(s.id), name: s.name }))
  const albumRef = raw.albums?.[0]
  const artist =
    singers
      .map((s) => s?.name)
      .filter(Boolean)
      .join(' / ') ||
    str(raw.singer) ||
    '未知艺人'
  return {
    source: 'migu',
    id: str(raw.contentId ?? raw.id ?? raw.songId),
    title: raw.name ?? raw.songName ?? '未知曲目',
    artist,
    album: raw.album ?? albumRef?.name ?? '',
    cover: pickCover(raw),
    duration: durationOf(raw),
    fee: feeOf(raw),
    artistRefs: artistRefs.length ? artistRefs : undefined,
    albumId: str(raw.albumId ?? albumRef?.id) || undefined,
  }
}

/** 将咪咕搜索/专辑详情原始专辑归一化为共享 Album。 */
export function normalizeMiguAlbum(raw: Json): Album {
  return {
    source: 'migu',
    id: str(raw.id ?? raw.albumId),
    name: str(raw.name ?? raw.title) || '未命名专辑',
    cover: pickCover({
      imgItems: raw.imgItems as MiguImg[] | undefined,
      img1: str(raw.img1),
      img2: str(raw.img2),
      img3: str(raw.img3),
    }),
    artist: str(raw.singer) || '未知艺人',
    artistId: str(raw.singerId) || undefined,
    year: yearOf(raw.publishDate ?? raw.publishTime),
    trackCount: num(raw.totalCount) || undefined,
  }
}

/** 由歌手页 CMS 专辑项（`ZJ-Album-Item`）归一化为共享 Album。 */
function albumFromCmsItem(raw: Json): Album {
  return {
    source: 'migu',
    id: str(raw.resId),
    name: str(raw.txt) || '未命名专辑',
    cover: canonicalMiguImage(str(raw.img)),
    artist: str(raw.txt2) || '未知艺人',
    year: yearOf(raw.txt3),
  }
}

/** 将咪咕原始歌单归一化为共享 Playlist（兼容搜索 / 详情 / 推荐 CMS 三种形态）。 */
export function normalizeMiguPlaylist(raw: Json): Playlist {
  const opNum = raw.opNumItem as Json | undefined
  const imgItem = raw.imgItem as Json | undefined
  return {
    source: 'migu',
    id: str(raw.id ?? raw.musicListId ?? raw.resId),
    name: str(raw.name ?? raw.title ?? raw.txt) || '未命名歌单',
    cover: canonicalMiguImage(
      str(raw.musicListPicUrl ?? imgItem?.img ?? raw.img),
    ),
    description: str(raw.summary ?? raw.desc) || undefined,
    trackCount: num(raw.musicNum) || undefined,
    playCount: num(raw.playNum) || num(opNum?.playNum) || undefined,
    creator: str(raw.creator ?? raw.ownerName ?? raw.userId) || undefined,
  }
}

/** 由排行榜 CMS 条目（`rank-info` 的 `contents[]`）还原一条曲目；`songData` 是 JSON 字符串。 */
function trackFromRankItem(raw: Json): Track | null {
  const sd = raw.songData
  if (typeof sd === 'string' && sd) {
    try {
      return normalizeMiguTrack(JSON.parse(sd) as RawMiguSong)
    } catch {
      /* 落到下面的退化分支 */
    }
  }
  const resId = str(raw.resId)
  if (!resId) return null
  return {
    source: 'migu',
    id: resId,
    title: str(raw.txt) || '未知曲目',
    artist: str(raw.txt2) || '未知艺人',
    album: str(raw.txt3),
    cover: canonicalMiguImage(str(raw.img)),
    duration: 0,
    fee: raw.vip ? 'vip' : 'free',
  }
}

/* ============================ 搜索 ============================ */

/** `search_all` 的 searchSwitch（缺省全 0，按需开）。 */
function switchParam(
  on: Partial<Record<'song' | 'album' | 'singer' | 'songlist', 1>>,
): string {
  return encodeURIComponent(
    JSON.stringify({
      song: on.song ?? 0,
      album: on.album ?? 0,
      singer: on.singer ?? 0,
      tagSong: 0,
      mvSong: 0,
      bestShow: 0,
      songlist: on.songlist ?? 0,
    }),
  )
}

async function searchAll(
  keywords: string,
  limit: number,
  on: Partial<Record<'song' | 'album' | 'singer' | 'songlist', 1>>,
  cookie?: string,
): Promise<Json> {
  const url =
    `${SEARCH_ALL}?text=${encodeURIComponent(keywords)}&pageNo=1&pageSize=${limit}` +
    `&searchSwitch=${switchParam(on)}`
  return miguFetch(url, cookie)
}

/**
 * 搜索单曲。用 **`bmw/search/song`**（含 `duration` / `showTags`）而非聚合 `search_all`
 *——后者**不返回时长**，会让前端进度条失真。每页固定 20 条，按需翻页（≤3 页）。
 */
export async function searchSongs(
  keywords: string,
  limit = 30,
  cookie?: string,
): Promise<Track[]> {
  const out: Track[] = []
  const pageSize = 20
  const maxPages = Math.max(1, Math.min(3, Math.ceil(limit / pageSize)))
  for (let page = 1; page <= maxPages && out.length < limit; page++) {
    const body = await miguFetch(
      `${SEARCH_SONG}?text=${encodeURIComponent(keywords)}&pageNo=${page}&pageSize=${pageSize}`,
      cookie,
    )
    const data = (body.data as Json) ?? {}
    for (const it of (data.items ?? []) as Json[]) {
      const song = it.song as RawMiguSong | undefined
      if (song) out.push(normalizeMiguTrack(song))
    }
    if (!data.hasNext) break
  }
  return out.slice(0, limit)
}

/** 搜索专辑。 */
export async function searchAlbums(
  keywords: string,
  limit = 30,
  cookie?: string,
): Promise<Album[]> {
  const body = await searchAll(keywords, limit, { album: 1 }, cookie)
  const result = ((body.albumResultData as Json)?.result ?? []) as Json[]
  return result.map(normalizeMiguAlbum)
}

/** 搜索歌手。用 **`bmw/search/singer`**（含 `imgs` 头像 / 简介 / 曲库数）；聚合搜索只给 `{id,name}`。 */
export async function searchArtists(
  keywords: string,
  limit = 30,
  cookie?: string,
): Promise<Artist[]> {
  const body = await miguFetch(
    `${SEARCH_SINGER}?text=${encodeURIComponent(keywords)}&pageNo=1`,
    cookie,
  )
  const items = (((body.data as Json)?.items ?? []) as Json[]).slice(0, limit)
  return items.map((it) => {
    const s = (it.singer ?? {}) as Json
    return {
      source: 'migu' as const,
      id: str(s.singerId ?? s.id),
      name: str(s.singer ?? s.name) || '未知艺人',
      avatar: pickCover({ imgItems: s.imgs as MiguImg[] | undefined }),
      musicSize: num(s.songNum) || undefined,
      albumSize: num(s.albumNum) || undefined,
      briefDesc: str(s.summary) || undefined,
    }
  })
}

/** 搜索歌单。 */
export async function searchPlaylists(
  keywords: string,
  limit = 30,
  cookie?: string,
): Promise<Playlist[]> {
  const body = await searchAll(keywords, limit, { songlist: 1 }, cookie)
  const result = ((body.songListResultData as Json)?.result ?? []) as Json[]
  return result.map(normalizeMiguPlaylist)
}

/* ============================ 详情 ============================ */

/** 专辑详情：档案 + 曲目（`resource/album/{v2.0,song/v2.0}`）。 */
export async function albumDetail(
  id: string,
  cookie?: string,
): Promise<{ album: Album; tracks: Track[] }> {
  const [info, songs] = await Promise.all([
    miguFetch(
      `${ALBUM_INFO}?albumId=${encodeURIComponent(id)}&pageNo=1`,
      cookie,
    ),
    miguFetch(
      `${ALBUM_SONG}?albumId=${encodeURIComponent(id)}&pageNo=1&pageSize=100`,
      cookie,
    ),
  ])
  const d = (info.data as Json) ?? {}
  const album: Album = {
    source: 'migu',
    id: str(d.albumId ?? id),
    name: str(d.title) || '未命名专辑',
    cover: pickCover({
      imgItems: d.imgItems as MiguImg[] | undefined,
    }),
    artist: str(d.singer) || '未知艺人',
    artistId: str(d.singerId) || undefined,
    year: yearOf(d.publishDate ?? d.publishTime),
    trackCount: num(d.totalCount) || undefined,
  }
  const songList = ((songs.data as Json)?.songList ?? []) as RawMiguSong[]
  const tracks = songList.map(normalizeMiguTrack)
  // 专辑曲目为 thin 结构：缺失处用专辑档案补齐
  for (const t of tracks) {
    if (!t.album) t.album = album.name
    if (!t.cover) t.cover = album.cover
    if (t.artist === '未知艺人') t.artist = album.artist
  }
  return { album, tracks }
}

/** 歌手详情：档案 + 歌曲 + 专辑（`bmw/singer/{song,album}`，CMS 结构）。 */
export async function artistDetail(
  id: string,
  cookie?: string,
  name?: string,
): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }> {
  const [songRes, albumRes] = await Promise.all([
    miguFetch(
      `${SINGER_SONG}?singerId=${encodeURIComponent(id)}&pageNo=1&type=1`,
      cookie,
    ),
    miguFetch(
      `${SINGER_ALBUM}?singerId=${encodeURIComponent(id)}&pageNo=1`,
      cookie,
    ),
  ])
  const groups = ((songRes.data as Json)?.contents ?? []) as Json[]

  // 头像兜底：ZJ-Img-Scroll 组下的 ZJ-Img-Item（常是栏目横幅图，仅作兜底）
  let fallbackAvatar = ''
  const tracks: Track[] = []
  for (const g of groups) {
    const subs = (g.contents ?? []) as Json[]
    if (str(g.view) === 'ZJ-Img-Scroll') {
      const img = subs.find((s) => str(s.view) === 'ZJ-Img-Item')
      if (img && !fallbackAvatar)
        fallbackAvatar = canonicalMiguImage(str(img.img))
    }
    for (const sub of subs) {
      const item = sub.songItem as RawMiguSong | undefined
      if (item) tracks.push(normalizeMiguTrack(item))
    }
  }

  const albums: Album[] = (((albumRes.data as Json)?.contents ?? []) as Json[])
    .filter((c) => str(c.view) === 'ZJ-Album-Item')
    .map(albumFromCmsItem)

  // 名称：优先入参，其次从歌曲的艺人引用里认领
  const resolvedName =
    name ||
    tracks.flatMap((t) => t.artistRefs ?? []).find((r) => r.id === id)?.name ||
    '未知艺人'

  // 真头像 / 简介 / 曲库数：按名字查 `bmw/search/singer`，精确匹配 singerId（拿不到则用兜底）
  let avatar = fallbackAvatar
  let briefDesc: string | undefined
  let musicSize = tracks.length || undefined
  let albumSize = albums.length || undefined
  if (name) {
    try {
      const body = await miguFetch(
        `${SEARCH_SINGER}?text=${encodeURIComponent(name)}&pageNo=1`,
        cookie,
      )
      const items = ((body.data as Json)?.items ?? []) as Json[]
      const hit = items.find((it) => str((it.singer as Json)?.singerId) === id)
      const s = (hit?.singer ?? {}) as Json
      const img = pickCover({ imgItems: s.imgs as MiguImg[] | undefined })
      if (img) avatar = img
      briefDesc = str(s.summary) || undefined
      if (num(s.songNum)) musicSize = num(s.songNum)
      if (num(s.albumNum)) albumSize = num(s.albumNum)
    } catch {
      /* 拿不到就退回兜底 */
    }
  }

  const artist: Artist = {
    source: 'migu',
    id,
    name: resolvedName,
    avatar,
    musicSize,
    albumSize,
    briefDesc,
  }
  return { artist, tracks, albums }
}

/** 歌单 / 排行榜详情：档案 + 曲目。 */
export async function playlistTracks(
  id: string,
  cookie?: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> {
  // 排行榜：`rank:` 前缀 → rank-info
  if (id.startsWith(RANK_PREFIX)) {
    const rankId = id.slice(RANK_PREFIX.length)
    const body = await miguFetch(
      `${RANK_INFO}?rankId=${encodeURIComponent(rankId)}&pageNo=1`,
      cookie,
    )
    const d = (body.data as Json) ?? {}
    const playlist: Playlist = {
      source: 'migu',
      id,
      name: str(d.title) || '排行榜',
      cover: canonicalMiguImage(str(d.titlePic)),
      description: str(d.desc) || undefined,
      trackCount: num(d.totalCount) || undefined,
    }
    const contents = (d.contents ?? []) as Json[]
    const tracks = contents
      .map(trackFromRankItem)
      .filter((t): t is Track => !!t)
    return { playlist, tracks }
  }

  const [info, songRes] = await Promise.all([
    miguFetch(`${PLAYLIST_INFO}?playlistId=${encodeURIComponent(id)}`, cookie),
    miguFetch(
      `${PLAYLIST_SONG}?playlistId=${encodeURIComponent(id)}&pageNo=1&pageSize=1000`,
      cookie,
    ),
  ])
  const playlist = normalizeMiguPlaylist((info.data as Json) ?? {})
  if (playlist.id === '') playlist.id = id
  const songList = ((songRes.data as Json)?.songList ?? []) as RawMiguSong[]
  return { playlist, tracks: songList.map(normalizeMiguTrack) }
}

/** 批量曲目详情（逐条 `resourceinfo`，咪咕批量参数不可用）。 */
export async function songDetail(
  ids: string[],
  cookie?: string,
): Promise<Track[]> {
  const out = await Promise.all(
    ids.slice(0, 100).map(async (id) => {
      try {
        const body = await miguFetch(
          `${RESOURCE_INFO}?resourceType=2&resourceId=${encodeURIComponent(id)}`,
          cookie,
        )
        const r = ((body.resource as Json[]) ?? [])[0]
        return r ? normalizeMiguTrack(r as RawMiguSong) : null
      } catch {
        return null
      }
    }),
  )
  return out.filter((t): t is Track => !!t)
}

/* ============================ 发现 ============================ */

/** 推荐歌单（`bmw/index-show/recommend-playlist/v3.0`，CMS 结构）。 */
export async function recommendPlaylists(
  limit = 12,
  cookie?: string,
): Promise<Playlist[]> {
  const body = await miguFetch(RECOMMEND_PLAYLIST, cookie)
  const lists = (((body.data as Json)?.playLists ?? []) as Json[]).slice(
    0,
    limit,
  )
  return lists.map((p) => {
    const log = p.logEvent as Json | undefined
    return normalizeMiguPlaylist({
      id: p.resId ?? log?.contentId,
      name: p.txt ?? log?.contentName,
      img: p.img,
    })
  })
}

/** 排行榜列表（`pc/bmw/rank/rank-index/v1.0` → 展平各组）。 */
export async function toplists(
  limit = 50,
  cookie?: string,
): Promise<Playlist[]> {
  const body = await miguFetch(RANK_INDEX, cookie)
  const groups = ((body.data as Json)?.contents ?? []) as Json[]
  const out: Playlist[] = []
  for (const g of groups) {
    for (const r of (g.contents ?? []) as Json[]) {
      const rankId = str(r.rankId)
      if (!rankId) continue
      out.push({
        source: 'migu',
        id: RANK_PREFIX + rankId,
        name: str(r.rankName) || '排行榜',
        cover: canonicalMiguImage(str(r.imageUrl)),
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

/* ============================ 取流 / 歌词 ============================ */

/**
 * 抽象档位 → `toneFlag` **候选链**（由高到低，逐个尝试）。
 *
 * 实测：`pc/listen/v1.0` 对不可得的档**不自动降级**（直接不返回 `url`），故在此逐级降级；
 * 免费曲通常仅 `PQ` 可得。`higher` 与 `exhigh` 同链（咪咕无真 192k 档）。
 */
const TONE_CANDIDATES: Record<AudioLevel, string[]> = {
  standard: ['PQ'],
  higher: ['HQ', 'PQ'],
  exhigh: ['HQ', 'PQ'],
  lossless: ['SQ', 'HQ', 'PQ'],
  hires: ['ZQ', 'SQ', 'HQ', 'PQ'],
}

/** 取某抽象档的 `toneFlag` 候选链（由高到低）。 */
export function miguToneCandidates(level: AudioLevel): string[] {
  return TONE_CANDIDATES[level] ?? TONE_CANDIDATES[DEFAULT_AUDIO_LEVEL]
}

/** `contentId → copyrightId` 缓存（取流/歌词共用，长 TTL；失败以空串标记）。 */
const copyrightCache = new LRUCache<string, string>({
  max: 4000,
  ttl: 6 * 60 * 60 * 1000,
})

/** best-effort 取 `copyrightId`（失败返回空串，不影响取流——`listen` 不带它也可用）。 */
async function copyrightIdOf(
  contentId: string,
  cookie?: string,
): Promise<string> {
  const cached = copyrightCache.get(contentId)
  if (cached !== undefined) return cached
  try {
    const body = await miguFetch(
      `${RESOURCE_INFO}?resourceType=2&resourceId=${encodeURIComponent(contentId)}`,
      cookie,
    )
    const r = ((body.resource as Json[]) ?? [])[0]
    const crid = str(r?.copyrightId)
    copyrightCache.set(contentId, crid)
    return crid
  } catch {
    return ''
  }
}

/**
 * 解析曲目真实播放地址（`pc/listen/v1.0`，返回**明文** mp3/flac）。
 * 按 `level` 的候选链逐个请求，取首个 `url` 非空者；全落空返回 `null`（VIP 匿名 / 版权受限）。
 */
export async function songUrl(
  id: string,
  cookie?: string,
  level: AudioLevel = DEFAULT_AUDIO_LEVEL,
): Promise<string | null> {
  try {
    const copyrightId = await copyrightIdOf(id, cookie)
    for (const toneFlag of miguToneCandidates(level)) {
      const q = new URLSearchParams({
        contentId: id,
        resourceType: '2',
        toneFlag,
      })
      if (copyrightId) q.set('copyrightId', copyrightId)
      const body = await miguFetch(`${LISTEN}?${q.toString()}`, cookie)
      const url = str((body.data as Json)?.url)
      if (url) return https(url)
    }
    return null
  } catch {
    return null
  }
}

/** 歌词：`listen` 响应的 `lrcUrl`/`trcUrl` 均为**明文 LRC**（VIP 曲匿名亦可取到）。 */
export async function getLyric(id: string, cookie?: string): Promise<Lyric> {
  try {
    const copyrightId = await copyrightIdOf(id, cookie)
    const q = new URLSearchParams({
      contentId: id,
      resourceType: '2',
      toneFlag: 'PQ',
    })
    if (copyrightId) q.set('copyrightId', copyrightId)
    const body = await miguFetch(`${LISTEN}?${q.toString()}`, cookie)
    const d = (body.data as Json) ?? {}
    const lrcUrl = str(d.lrcUrl)
    const trcUrl = str(d.trcUrl)
    if (!lrcUrl) return { lines: [], timed: false }
    const [lrc, trc] = await Promise.all([
      miguFetchText(lrcUrl, cookie),
      trcUrl ? miguFetchText(trcUrl, cookie) : Promise.resolve(''),
    ])
    return parseLrc(lrc, trc || undefined)
  } catch {
    return { lines: [], timed: false }
  }
}

/* ============================ 适配器 ============================ */

/** 咪咕音乐音源适配器（**无登录**，见 ADR-032）。 */
export const miguAdapter: SourceAdapter = {
  id: 'migu',
  // 无登录：无会话 cookie 需下发/回传（缺省凭证 `MIGU_COOKIE` 由路由层直接提供）
  sessionCookieNames: [],
  logoutCookieNames: [],
  searchSongs,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  albumDetail,
  artistDetail,
  playlistTracks,
  songDetail,
  recommendPlaylists,
  toplists,
  songUrl,
  getLyric,
  loginStatus,
  cookieHeaderFromSetCookies,
  streamHeaders: () => ({ Referer: REFERER }),
}

/** 咪咕无登录能力：恒为未登录。 */
export async function loginStatus(_cred?: string): Promise<LoginStatus> {
  return { logged: false }
}

/** 咪咕无登录能力：无 Set-Cookie 可收敛。 */
export function cookieHeaderFromSetCookies(
  _cookies?: string[],
): string | undefined {
  return undefined
}
