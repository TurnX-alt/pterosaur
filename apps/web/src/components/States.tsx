import { Loader2, Inbox, AlertCircle } from 'lucide-react'

/** 加载中占位。 */
export function Loading({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="loading-row" role="status" aria-live="polite">
      <Loader2 size={26} strokeWidth={2} className="spinner" />
      <span>{text}</span>
    </div>
  )
}

/** 空状态占位。 */
export function Empty({ text = '暂无内容', icon }: { text?: string; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon ?? <Inbox size={32} strokeWidth={1.5} />}
      <span>{text}</span>
    </div>
  )
}

/** 错误状态占位，可选重试。 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state">
      <AlertCircle size={32} strokeWidth={1.5} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="error-retry" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}
