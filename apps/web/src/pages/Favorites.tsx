import { Play, Shuffle, Heart, DiscAlbum } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { usePlayer } from '../store/player.js'
import { TrackList } from '../components/TrackList.js'
import { IconButton } from '../components/IconButton.js'
import { Empty } from '../components/States.js'
import { downloadPlaylist } from '../lib/downloadPlaylist.js'
import { confirmDialog } from '../store/ui.js'
import { useState } from 'react'

/**
 * 我喜欢的音乐。展示收藏曲目，支持顺序 / 随机播放。
 */
export function FavoritesPage() {
  const favorites = useLibrary((s) => s.favorites)
  const playTracks = usePlayer((s) => s.playTracks)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  const [downloading, setDownloading] = useState(false)
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null)

  const handlePlay = (shuffle = false) => {
    if (!favorites.length) return
    if (shuffle && !usePlayer.getState().shuffle) toggleShuffle()
    playTracks(favorites, shuffle ? Math.floor(Math.random() * favorites.length) : 0)
  }

  const handleDownloadPlaylist = async () => {
    if (!favorites.length || downloading) return
    const dur = favorites.reduce((sum, t) => sum + (t.duration || 0), 0)
    const durStr = dur > 0 ? `，总时长约 ${Math.round(dur / 60)} 分钟` : ''
    const ok = await confirmDialog({
      title: '翻录歌单？',
      message: `将打包下载 ${favorites.length} 首曲目${durStr}。`,
      confirmText: '开始翻录',
    })
    if (!ok) return
    setDownloading(true)
    setDownloadLabel('正在打包 0 / ' + favorites.length)
    try {
      await downloadPlaylist(favorites, '我喜欢的音乐', (p) => {
        setDownloadLabel(`正在打包 ${p.current} / ${p.total}`)
      })
    } finally {
      setDownloading(false)
      setDownloadLabel(null)
    }
  }

  const totalDuration = favorites.reduce((sum, t) => sum + (t.duration || 0), 0)

  return (
    <div className="detail">
      <header className="detail__hero">
        <div className="fav-cover" aria-hidden>
          <Heart size={72} fill="currentColor" strokeWidth={0} />
        </div>
        <div className="detail__info">
          <span className="detail__type">歌单</span>
          <h1 className="detail__name">我喜欢的音乐</h1>
          <p className="detail__meta">
            <span>{favorites.length} 首</span>
            {totalDuration > 0 && <span> · 约 {Math.round(totalDuration / 60)} 分钟</span>}
          </p>
        </div>
      </header>

      <div className="detail__actions">
        <button type="button" className="detail__play" onClick={() => handlePlay(false)} disabled={!favorites.length}>
          <Play size={18} fill="currentColor" strokeWidth={0} />
          播放
        </button>
        <IconButton label="随机播放" size="lg" onClick={() => handlePlay(true)} disabled={!favorites.length}>
          <Shuffle size={20} strokeWidth={2} />
        </IconButton>
        <IconButton
          label={downloadLabel ?? '翻录'}
          size="lg"
          onClick={handleDownloadPlaylist}
          disabled={!favorites.length || downloading}
        >
          <DiscAlbum size={19} strokeWidth={2} />
        </IconButton>
      </div>

      <div className="detail__list">
        {favorites.length === 0 ? (
          <Empty text="还没有喜欢的音乐，点击曲目行的红心收藏" icon={<Heart size={32} strokeWidth={1.5} />} />
        ) : (
          <TrackList tracks={favorites} />
        )}
      </div>
    </div>
  )
}
