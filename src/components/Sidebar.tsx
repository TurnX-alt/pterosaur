import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home,
  Compass,
  Radio,
  Heart,
  Clock,
  Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { useCreatePlaylist } from '../store/ui.js'
import { Cover } from './Cover.js'
import './Sidebar.css'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  /** 是否仅精确匹配时高亮（用于根路由 `/`）。 */
  end?: boolean
}

/** 主导航项。 */
const NAV: NavEntry[] = [
  { to: '/', label: '立即收听', icon: Home, end: true },
  { to: '/browse', label: '浏览', icon: Compass },
  { to: '/radio', label: '电台', icon: Radio },
]

/** 资料库项。 */
const LIBRARY: NavEntry[] = [
  { to: '/favorites', label: '我喜欢的音乐', icon: Heart },
  { to: '/recent', label: '最近播放', icon: Clock },
]

export function Sidebar() {
  const playlists = useLibrary((s) => s.playlists)
  const savedPlaylists = useLibrary((s) => s.savedPlaylists)
  const openCreate = useCreatePlaylist((s) => s.openCreate)
  const navigate = useNavigate()

  const handleCreate = () => {
    openCreate({ onDone: (id) => navigate(`/playlist/${id}`) })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__name">Pterosaur</span>
      </div>

      <nav className="sidebar__nav" aria-label="主导航">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}>
            <Icon size={19} strokeWidth={1.9} />
            <span className="nav-item__label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__section-head">
        <span>资料库</span>
        <button
          type="button"
          className="sidebar__add"
          onClick={handleCreate}
          aria-label="新建歌单"
          title="新建歌单"
        >
          <Plus size={17} strokeWidth={2.2} />
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="资料库">
        {LIBRARY.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}>
            <Icon size={19} strokeWidth={1.9} />
            <span className="nav-item__label">{label}</span>
          </NavLink>
        ))}
      </nav>

      {playlists.length > 0 && (
        <nav className="sidebar__nav sidebar__playlists" aria-label="我的歌单">
          {playlists.map((p) => (
            <NavLink
              key={p.id}
              to={`/playlist/${p.id}`}
              className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
            >
              <Cover
                src={p.tracks[0]?.cover}
                alt={p.name}
                radius="sm"
                size={19}
              />
              <span className="nav-item__label">{p.name}</span>
            </NavLink>
          ))}
        </nav>
      )}

      {savedPlaylists.length > 0 && (
        <>
          <div className="sidebar__section-head">
            <span>收藏的歌单</span>
          </div>
          <nav className="sidebar__nav sidebar__saved" aria-label="收藏的歌单">
            {savedPlaylists.map((p) => (
              <NavLink
                key={p.id}
                to={`/playlist/${p.id}`}
                className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
              >
                <Cover src={p.cover} alt={p.name} radius="sm" size={19} />
                <span className="nav-item__label">{p.name}</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </aside>
  )
}
