import { useEffect, useRef } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar.js'
import { Topbar } from './components/Topbar.js'
import { PlayerBar } from './components/PlayerBar.js'
import { NowPlaying } from './components/NowPlaying.js'
import { QueuePanel } from './components/QueuePanel.js'
import { LoginModal } from './components/LoginModal.js'
import { PlayErrorToast } from './components/PlayErrorToast.js'
import { Home } from './pages/Home.js'
import { Browse } from './pages/Browse.js'
import { Radio } from './pages/Radio.js'
import { SearchPage } from './pages/Search.js'
import { PlaylistPage } from './pages/Playlist.js'
import { LibraryPage } from './pages/Library.js'
import { FavoritesPage } from './pages/Favorites.js'
import { RecentPage } from './pages/Recent.js'
import { useAudioEngine } from './hooks/useAudioEngine.js'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { useApplyTheme } from './hooks/useTheme.js'
import { audioEl } from './hooks/audioElement.js'
import { useAuth } from './store/auth.js'
import { usePlayer } from './store/player.js'
import './styles/app.css'

export default function App() {
  useApplyTheme()
  useAudioEngine()

  const searchRef = useRef<HTMLInputElement | null>(null)
  const focusSearch = () => searchRef.current?.focus()
  useKeyboardShortcuts(focusSearch)

  const expanded = usePlayer((s) => s.expanded)
  const modalOpen = useAuth((s) => s.modalOpen)

  // 首次进入查询登录态（用于 VIP 曲目判断与「我的歌单」）
  const refresh = useAuth((s) => s.refresh)
  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="app-shell">
      {/* 全局唯一的 audio 元素，由引擎驱动 */}
      <audio ref={audioEl} preload="metadata" data-testid="audio-engine" />

      <Sidebar />

      <div className="app-main">
        <Topbar searchRef={searchRef} />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/radio" element={<Radio />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/recent" element={<RecentPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
      </div>

      <PlayerBar />

      {/* 浮层：全屏播放页 / 队列 / 登录 / 播放错误 */}
      {expanded && <NowPlaying />}
      <QueuePanel />
      {modalOpen && <LoginModal />}
      <PlayErrorToast />
    </div>
  )
}
