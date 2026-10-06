import { useEffect } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { usePlayer } from '../store/player.js'
import { useAuth } from '../store/auth.js'
import './PlayErrorToast.css'

/**
 * 播放错误提示条。当曲目因版权 / VIP 限制无法播放时弹出，
 * 提供「登录解锁」入口，5 秒后自动消失。
 */
export function PlayErrorToast() {
  const playError = usePlayer((s) => s.playError)
  const playErrorNeedLogin = usePlayer((s) => s.playErrorNeedLogin)
  const setPlayError = usePlayer((s) => s.setPlayError)
  const logged = useAuth((s) => s.status.logged)
  const openModal = useAuth((s) => s.openModal)

  useEffect(() => {
    if (!playError) return
    const t = window.setTimeout(() => setPlayError(null), 5000)
    return () => window.clearTimeout(t)
  }, [playError, setPlayError])

  if (!playError) return null

  return (
    <div className="toast" role="alert">
      <AlertCircle size={18} className="toast__icon" />
      <span className="toast__text">{playError}</span>
      {!logged && playErrorNeedLogin && (
        <button type="button" className="toast__action" onClick={openModal}>
          登录解锁
        </button>
      )}
      <button type="button" className="toast__close" onClick={() => setPlayError(null)} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  )
}
