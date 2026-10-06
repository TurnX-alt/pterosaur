import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useLibrary } from '../store/library.js'
import { useCreatePlaylist } from '../store/ui.js'
import { IconButton } from './IconButton.js'
import './CreatePlaylistModal.css'

/**
 * 新建歌单弹窗。
 *
 * 取代原生 `window.prompt`，与登录弹窗共用一套视觉语言：
 * 遮罩 + 居中卡片 + 单行输入。打开参数（预置曲目、成功回调）
 * 由 {@link useCreatePlaylist} store 提供，因此可从任意入口发起。
 */
export function CreatePlaylistModal() {
  const open = useCreatePlaylist((s) => s.open)
  const tracks = useCreatePlaylist((s) => s.tracks)
  const onDone = useCreatePlaylist((s) => s.onDone)
  const close = useCreatePlaylist((s) => s.closeCreate)
  const createPlaylist = useLibrary((s) => s.createPlaylist)

  const [name, setName] = useState('我的歌单')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 每次打开时重置输入并自动聚焦选中，方便直接覆盖输入
  useEffect(() => {
    if (!open) return
    setName('我的歌单')
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const id = createPlaylist(name.trim() || '我的歌单', tracks)
    onDone?.(id)
    close()
  }

  return (
    <div
      className="cp-modal"
      role="dialog"
      aria-modal="true"
      aria-label="新建歌单"
    >
      <div className="cp-modal__scrim" onClick={close} aria-hidden />
      <div className="cp-modal__card">
        <header className="cp-modal__head">
          <h2>新建歌单</h2>
          <IconButton label="关闭" size="sm" onClick={close}>
            <X size={18} />
          </IconButton>
        </header>

        <form className="cp-modal__form" onSubmit={submit}>
          <label className="cp-modal__field">
            <span>歌单名称</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的歌单"
            />
          </label>
          {tracks.length > 0 && (
            <p className="cp-modal__hint">将添加 {tracks.length} 首曲目</p>
          )}
          <div className="cp-modal__actions">
            <button
              type="button"
              className="cp-modal__btn cp-modal__btn--ghost"
              onClick={close}
            >
              取消
            </button>
            <button
              type="submit"
              className="cp-modal__btn cp-modal__btn--primary"
              disabled={!name.trim()}
            >
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
