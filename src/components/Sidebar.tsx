import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home,
  Compass,
  Radio,
  Library,
  Heart,
  ListMusic,
  Clock,
  Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { useAuth } from '../store/auth.js'
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
  { to: '/library', label: '全部歌单', icon: Library },
]

export function Sidebar() {
  const playlists = useLibrary((s) => s.playlists)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const status = useAuth((s) => s.status)
  const openModal = useAuth((s) => s.openModal)
  const navigate = useNavigate()

  const handleCreate = () => {
    const name = window.prompt('新歌单名称', '我的歌单')
    if (name === null) return
    const id = createPlaylist(name.trim() || '我的歌单')
    navigate(`/playlist/${id}`)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden>
          <ListMusic size={22} strokeWidth={2.2} />
        </span>
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
                size={22}
              />
              <span className="nav-item__label">{p.name}</span>
            </NavLink>
          ))}
        </nav>
      )}

      <div className="sidebar__footer">
        {status.logged ? (
          <div className="sidebar__user" title={status.nickname}>
            <Cover src={status.avatarUrl} alt={status.nickname ?? '用户'} rounded size={26} />
            <span className="nav-item__label">{status.nickname}</span>
            {status.vip && <span className="sidebar__vip">VIP</span>}
          </div>
        ) : (
          <button type="button" className="sidebar__login" onClick={openModal}>
            登录网易云 · 解锁 VIP
          </button>
        )}
      </div>
    </aside>
  )
}
