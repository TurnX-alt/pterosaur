import { useEffect, useRef } from 'react'
import { useConfirmDialog } from '../store/ui.js'
import './ConfirmDialog.css'

/**
 * 全局确认弹窗。
 *
 * 取代原生 `window.confirm`，与登录 / 新建歌单弹窗共用视觉语言。
 * 由 {@link useConfirmDialog} store 驱动：调用方 `await confirmDialog({...})`
 * 打开，本组件挂载在 App 顶层，用户点击确认 / 取消后回填 Promise。
 */
export function ConfirmDialog() {
  const open = useConfirmDialog((s) => s.open)
  const options = useConfirmDialog((s) => s.options)
  const settle = useConfirmDialog((s) => s.settle)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  const {
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    danger,
  } = options

  // 打开时聚焦确认按钮；Esc 视为取消
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => confirmRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, settle])

  if (!open) return null

  return (
    <div
      className="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="confirm-dialog__scrim"
        onClick={() => settle(false)}
        aria-hidden
      />
      <div className="confirm-dialog__card">
        <h2 className="confirm-dialog__title">{title}</h2>
        {message && <p className="confirm-dialog__message">{message}</p>}
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--ghost"
            onClick={() => settle(false)}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-dialog__btn ${danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--primary'}`}
            onClick={() => settle(true)}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
