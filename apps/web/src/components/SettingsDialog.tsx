import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Trash2, RefreshCw, Loader2 } from 'lucide-react'
import { useSettingsDialog, confirmDialog } from '../store/ui.js'
import { clearMediaCache, mediaUsage, type MediaUsage } from '../lib/mediaCache.js'
import { checkForUpdates, postToServiceWorker } from '../lib/pwa.js'
import { formatBytes } from '../lib/formatBytes.js'
import { IconButton } from './IconButton.js'
import './SettingsDialog.css'

type Busy = 'clear' | 'update' | null

/**
 * 设置弹窗：缓存管理（查看占用 / 清理）与检查更新（注销 PWA + 强制刷新）。
 *
 * 由 {@link useSettingsDialog} store 驱动，挂载在 App 顶层，顶栏齿轮按钮打开。
 */
export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open)
  const closeSettings = useSettingsDialog((s) => s.closeSettings)

  const [usage, setUsage] = useState<MediaUsage | null>(null)
  const [quota, setQuota] = useState<number | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    setUsage(await mediaUsage())
    try {
      if (navigator.storage?.estimate) {
        const { quota: q } = await navigator.storage.estimate()
        setQuota(q ?? null)
      }
    } catch {
      /* 配额信息不可用时忽略 */
    }
  }, [])

  // 打开时刷新用量、聚焦弹窗；Esc 关闭
  useEffect(() => {
    if (!open) return
    void refresh()
    const id = window.setTimeout(() => cardRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, refresh, closeSettings])

  if (!open) return null

  const total = usage?.bytes ?? 0

  const handleClear = async () => {
    if (busy) return
    const ok = await confirmDialog({
      title: '清理缓存？',
      message: '将删除已缓存的全部歌曲与封面。资料库（收藏、歌单）不受影响。',
      confirmText: '清理',
      danger: true,
    })
    if (!ok) return
    setBusy('clear')
    try {
      await clearMediaCache()
      // 通知 SW 清空其内存中的元数据索引，避免清缓存后 LRU 仍按旧账目淘汰
      postToServiceWorker({ type: 'MEDIA_CACHE_CLEARED' })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleUpdate = async () => {
    if (busy) return
    const ok = await confirmDialog({
      title: '检查更新？',
      message: '将注销离线缓存并强制刷新页面，以拉取最新版本。资料库与本机缓存不受影响。',
      confirmText: '刷新',
      danger: true,
    })
    if (!ok) return
    setBusy('update')
    // 结束时页面通常会卸载；若未刷新则恢复按钮
    await checkForUpdates()
    setBusy(null)
  }

  return (
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
      <div className="settings-dialog__scrim" onClick={closeSettings} aria-hidden />
      <div className="settings-dialog__card" ref={cardRef} tabIndex={-1}>
        <header className="settings-dialog__head">
          <h2>设置</h2>
          <IconButton label="关闭" size="sm" onClick={closeSettings}>
            <X size={18} />
          </IconButton>
        </header>

        <section className="settings-dialog__section">
          <h3 className="settings-dialog__section-title">缓存</h3>
          <p className="settings-dialog__desc">
            歌曲与封面缓存在本机，共用一个 16 GB 上限，超出后按最久未用优先清理。
          </p>
          <div className="settings-dialog__stat">
            <span className="settings-dialog__stat-label">已占用</span>
            <span className="settings-dialog__stat-value" data-testid="cache-total">
              {formatBytes(total)}
            </span>
          </div>
          <p className="settings-dialog__breakdown" data-testid="cache-breakdown">
            歌曲 {formatBytes(usage?.audioBytes ?? 0)} · 封面 {formatBytes(usage?.imageBytes ?? 0)}
            {quota ? ` · 浏览器配额 ${formatBytes(quota)}` : ''}
          </p>
          <button
            type="button"
            className="settings-dialog__btn settings-dialog__btn--danger"
            onClick={handleClear}
            disabled={busy !== null}
            data-testid="clear-cache"
          >
            {busy === 'clear' ? <Loader2 size={15} className="spinner" /> : <Trash2 size={15} />}
            清理缓存
          </button>
        </section>

        <section className="settings-dialog__section">
          <h3 className="settings-dialog__section-title">更新</h3>
          <p className="settings-dialog__desc">
            当前版本 <code className="settings-dialog__code">{__COMMIT_HASH__}</code>。若界面未更新，
            可注销离线缓存并强制拉取最新版本。
          </p>
          <button
            type="button"
            className="settings-dialog__btn settings-dialog__btn--primary"
            onClick={handleUpdate}
            disabled={busy !== null}
            data-testid="check-update"
          >
            {busy === 'update' ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />}
            检查更新
          </button>
        </section>
      </div>
    </div>
  )
}
