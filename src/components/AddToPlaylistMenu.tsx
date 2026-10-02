import { useEffect, useRef, useState } from 'react'
import { Plus, ListPlus, Heart, Check } from 'lucide-react'
import type { Track } from '../../shared/types.js'
import { useLibrary } from '../store/library.js'
import './AddToPlaylistMenu.css'

interface AddToPlaylistMenuProps {
  track: Track
  /** 触发按钮的渲染（由调用方决定外观），点击后打开菜单 */
  children: (props: { onClick: (e: React.MouseEvent) => void; open: boolean }) => React.ReactNode
}

/**
 * 「添加到歌单」下拉菜单：可收藏、新建歌单、或加入已有本地歌单。
 *
 * 采用受控浮层 + 点击外部关闭；菜单锚定在触发按钮附近。
 */
export function AddToPlaylistMenu({ track, children }: AddToPlaylistMenuProps) {
  const [open, setOpen] = useState(false)
  const playlists = useLibrary((s) => s.playlists)
  const favorites = useLibrary((s) => s.favorites)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const addToPlaylist = useLibrary((s) => s.addToPlaylist)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const isFav = favorites.some((t) => t.id === track.id)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleNew = () => {
    const name = window.prompt('新歌单名称', '我的歌单')
    if (name === null) return
    const id = createPlaylist(name.trim() || '我的歌单', [track])
    void id
    setOpen(false)
  }

  return (
    <div className="atp" ref={wrapRef}>
      {children({ onClick: (e) => { e.stopPropagation(); setOpen((v) => !v) }, open })}
      {open && (
        <div className="atp__menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            className="atp__item"
            onClick={() => {
              toggleFavorite(track)
              setOpen(false)
            }}
          >
            {isFav ? <Check size={16} className="atp__check" /> : <Heart size={16} />}
            <span>{isFav ? '已在我喜欢的音乐' : '添加到喜欢的音乐'}</span>
          </button>

          <button type="button" role="menuitem" className="atp__item" onClick={handleNew}>
            <ListPlus size={16} />
            <span>新建歌单</span>
          </button>

          {playlists.length > 0 && <div className="atp__sep" />}

          <div className="atp__sub">
            {playlists.map((p) => {
              const inList = p.tracks.some((t) => t.id === track.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="atp__item"
                  onClick={() => {
                    if (!inList) addToPlaylist(p.id, track)
                    setOpen(false)
                  }}
                >
                  {inList ? <Check size={16} className="atp__check" /> : <Plus size={16} />}
                  <span className="ellipsis">{p.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
