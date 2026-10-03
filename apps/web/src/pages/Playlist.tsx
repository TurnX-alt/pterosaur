import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Shuffle, Trash2, Heart, DiscAlbum } from 'lucide-react'
import { api } from '../api/client.js'
import { useAsync } from '../hooks/useAsync.js'
import { useViewNavigate } from '../hooks/useViewNavigate.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import { confirmDialog } from '../store/ui.js'
import type { Playlist, Track } from '@pterosaur/shared/types'
import { TrackList } from '../components/TrackList.js'
import { Cover } from '../components/Cover.js'
import { IconButton } from '../components/IconButton.js'
import { Loading, ErrorState } from '../components/States.js'
import { downloadPlaylist } from '../lib/downloadPlaylist.js'

/** 格式化播放量。 */
function fmtCount(n?: number): string {
  if (!n) return ''
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿次播放`
  if (n >= 1e4) return `${Math.round(n / 1e4)} 万次播放`
  return `${n} 次播放`
}

/**
 * 歌单详情页。
 *
 * 同时支持两种歌单：
 * - 本地自建歌单（id 以 `pl-` 开头，来自 library store）；
 * - 网易云歌单（数字 id，通过 API 拉取）。
 */
export function PlaylistPage() {
  const { id = '' } = useParams()
  const navigate = useViewNavigate()
  const isLocal = id.startsWith('pl-')

  const playlists = useLibrary((s) => s.playlists)
  const deletePlaylist = useLibrary((s) => s.deletePlaylist)
  const renamePlaylist = useLibrary((s) => s.renamePlaylist)
  const savedPlaylists = useLibrary((s) => s.savedPlaylists)
  const toggleSavePlaylist = useLibrary((s) => s.toggleSavePlaylist)
  const playTracks = usePlayer((s) => s.playTracks)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  // 本地歌单标题的内联重命名
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement | null>(null)

  // 翻录下载状态
  const [downloading, setDownloading] = useState(false)
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null)

  // 本地歌单：直接从 store 取
  const local = useMemo(() => (isLocal ? playlists.find((p) => p.id === id) : undefined), [isLocal, playlists, id])

  // 远程歌单：通过 API 拉取（带缓存键，参数切换时命中缓存可免于加载态，转场更顺滑）
  const remote = useAsync<{ playlist: Playlist; tracks: Track[] }>(
    () => (isLocal ? Promise.resolve({ playlist: { id, name: '', cover: '' }, tracks: [] }) : api.playlist(id)),
    [id, isLocal],
    null,
    isLocal ? undefined : `playlist:${id}`,
  )

  const playlist = isLocal
    ? { id, name: local?.name ?? '歌单', cover: local?.tracks[0]?.cover ?? '', trackCount: local?.tracks.length ?? 0 }
    : remote.data?.playlist
  const tracks = isLocal ? (local?.tracks ?? []) : (remote.data?.tracks ?? [])
  const loading = !isLocal && remote.loading
  const error = !isLocal ? remote.error : isLocal && !local ? '歌单不存在' : null

  // 在线歌单是否已收藏到资料库（仅保存引用，按路由 id 判断）
  const isSaved = !isLocal && savedPlaylists.some((p) => p.id === id)

  const handlePlay = (shuffle = false) => {
    if (!tracks.length) return
    if (shuffle && !usePlayer.getState().shuffle) toggleShuffle()
    playTracks(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0)
  }

  // 切换歌单时退出重命名态
  useEffect(() => {
    setRenaming(false)
  }, [id])

  // 进入重命名时聚焦并全选
  useEffect(() => {
    if (renaming) {
      const el = renameRef.current
      el?.focus()
      el?.select()
    }
  }, [renaming])

  const startRename = () => {
    setRenameValue(local?.name ?? '')
    setRenaming(true)
  }

  const commitRename = () => {
    const next = renameValue.trim()
    if (next && next !== local?.name) renamePlaylist(id, next)
    setRenaming(false)
  }

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: '删除歌单？',
      message: `「${playlist?.name ?? ''}」将被删除，此操作无法撤销。`,
      confirmText: '删除',
      danger: true,
    })
    if (ok) {
      deletePlaylist(id)
      navigate('/')
    }
  }

  const handleDownloadPlaylist = async () => {
    if (!tracks.length || downloading) return
    const dur = tracks.reduce((sum, t) => sum + (t.duration || 0), 0)
    const durStr = dur > 0 ? `，总时长约 ${Math.round(dur / 60)} 分钟` : ''
    const ok = await confirmDialog({
      title: '翻录歌单？',
      message: `将打包下载 ${tracks.length} 首曲目${durStr}。`,
      confirmText: '开始翻录',
    })
    if (!ok) return
    setDownloading(true)
    setDownloadLabel('正在打包 0 / ' + tracks.length)
    try {
      await downloadPlaylist(tracks, playlist?.name ?? '歌单', (p) => {
        setDownloadLabel(`正在打包 ${p.current} / ${p.total}`)
      })
    } finally {
      setDownloading(false)
      setDownloadLabel(null)
    }
  }

  if (loading) {
    return (
      <div className="detail">
        <Loading text="加载歌单…" />
      </div>
    )
  }

  if (error || !playlist) {
    return (
      <div className="detail">
        <ErrorState message={error ?? '歌单不存在'} onRetry={isLocal ? undefined : remote.reload} />
      </div>
    )
  }

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0)

  return (
    <div className="detail">
      <header className="detail__hero">
        <Cover src={playlist.cover} alt={playlist.name} radius="lg" className="detail__cover" />
        <div className="detail__info">
          <span className="detail__type">{isLocal ? '本地歌单' : '歌单'}</span>
          {isLocal && renaming ? (
            <input
              ref={renameRef}
              className="detail__name detail__name--editing"
              value={renameValue}
              maxLength={60}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                else if (e.key === 'Escape') setRenaming(false)
              }}
              aria-label="重命名歌单"
            />
          ) : isLocal ? (
            <h1
              className="detail__name detail__name--editable"
              onClick={startRename}
              title="点击重命名"
            >
              {playlist.name}
            </h1>
          ) : (
            <h1 className="detail__name">{playlist.name}</h1>
          )}
          {!isLocal && playlist.description && <p className="detail__desc">{playlist.description}</p>}
          <p className="detail__meta">
            {playlist.creator && <span>{playlist.creator} · </span>}
            <span>{tracks.length} 首</span>
            {totalDuration > 0 && <span> · 约 {Math.round(totalDuration / 60)} 分钟</span>}
            {!isLocal && playlist.playCount ? ` · ${fmtCount(playlist.playCount)}` : ''}
          </p>
        </div>
      </header>

      <div className="detail__actions">
        <button type="button" className="detail__play" onClick={() => handlePlay(false)} disabled={!tracks.length}>
          <Play size={18} fill="currentColor" strokeWidth={0} />
          播放
        </button>
        <IconButton label="随机播放" size="lg" onClick={() => handlePlay(true)} disabled={!tracks.length}>
          <Shuffle size={20} strokeWidth={2} />
        </IconButton>
        {!isLocal && (
          <IconButton
            label={isSaved ? '取消收藏' : '收藏到资料库'}
            size="lg"
            active={isSaved}
            onClick={() => toggleSavePlaylist(playlist)}
          >
            <Heart size={20} strokeWidth={2} fill={isSaved ? 'currentColor' : 'none'} />
          </IconButton>
        )}
        {isLocal && (
          <IconButton label="删除歌单" size="lg" onClick={handleDelete}>
            <Trash2 size={19} strokeWidth={2} />
          </IconButton>
        )}
        <IconButton
          label={downloadLabel ?? '翻录'}
          size="lg"
          onClick={handleDownloadPlaylist}
          disabled={!tracks.length || downloading}
        >
          <DiscAlbum size={19} strokeWidth={2} />
        </IconButton>
      </div>

      <div className="detail__list">
        <TrackList tracks={tracks} emptyText="这个歌单还没有曲目" />
      </div>
    </div>
  )
}
