import { useCallback, useEffect, useRef, useState } from 'react'
import { X, QrCode, Smartphone, Loader2, CheckCircle2 } from 'lucide-react'
import { api } from '../api/client.js'
import { useAuth, loginWithPhone, finishQrLogin } from '../store/auth.js'
import { IconButton } from './IconButton.js'
import './LoginModal.css'

type Tab = 'qr' | 'phone'
/** 扫码状态：idle 未开始 / loading 加载中 / waiting 等待扫码 / scanned 待确认 / expired 已过期 / done 成功 */
type QrStage = 'loading' | 'waiting' | 'scanned' | 'expired' | 'done'

const STAGE_TEXT: Record<QrStage, string> = {
  loading: '二维码加载中…',
  waiting: '打开网易云音乐 App 扫码登录',
  scanned: '扫码成功，请在手机上确认',
  expired: '二维码已过期，点击刷新',
  done: '登录成功',
}

/**
 * 登录弹窗：支持扫码（默认）与手机号两种方式。
 *
 * 扫码流程：`/api/auth/qr` 取 key+图片 → 每 2s 轮询 `/api/auth/qr/check`
 * → 803 成功时后端下发 Set-Cookie，前端写入登录态并关闭弹窗。
 */
export function LoginModal() {
  const closeModal = useAuth((s) => s.closeModal)
  const error = useAuth((s) => s.error)
  const fetching = useAuth((s) => s.fetching)
  const setError = useAuth((s) => s.setError)

  const [tab, setTab] = useState<Tab>('qr')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  // 扫码状态
  const [qrimg, setQrimg] = useState('')
  const [stage, setStage] = useState<QrStage>('loading')
  const timerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startQr = useCallback(async () => {
    stopPolling()
    setStage('loading')
    setQrimg('')
    try {
      const { key: k, qrimg: img } = await api.qrCreate()
      if (!aliveRef.current) return
      setQrimg(img)
      setStage('waiting')
      // 轮询扫码状态
      timerRef.current = window.setInterval(async () => {
        if (!aliveRef.current) return
        try {
          const res = await api.qrCheck(k)
          if (!aliveRef.current) return
          const code = res.code ?? 800
          if (code === 803) {
            stopPolling()
            setStage('done')
            finishQrLogin({
              logged: true,
              nickname: res.nickname,
              avatarUrl: res.avatarUrl,
              userId: res.userId,
              vip: res.vip,
            })
          } else if (code === 802) {
            setStage('scanned')
          } else if (code === 800) {
            setStage('expired')
            stopPolling()
          } else {
            setStage((s) => (s === 'scanned' ? 'scanned' : 'waiting'))
          }
        } catch {
          /* 轮询失败静默重试 */
        }
      }, 2000)
    } catch (e) {
      if (!aliveRef.current) return
      setStage('expired')
      setError((e as Error).message)
    }
  }, [stopPolling, setError])

  // 打开弹窗 / 切到扫码页时生成二维码
  useEffect(() => {
    aliveRef.current = true
    if (tab === 'qr') void startQr()
    return () => {
      aliveRef.current = false
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal])

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone.trim() || !password) return
    const okRes = await loginWithPhone(phone.trim(), password)
    if (!okRes) {
      /* 错误已写入 store */
    }
  }

  return (
    <div className="login-modal" role="dialog" aria-modal="true" aria-label="登录网易云音乐">
      <div className="login-modal__scrim" onClick={closeModal} aria-hidden />
      <div className="login-modal__card">
        <header className="login-modal__head">
          <h2>登录网易云音乐</h2>
          <IconButton label="关闭" size="sm" onClick={closeModal}>
            <X size={18} />
          </IconButton>
        </header>

        <p className="login-modal__hint">登录后即可播放 VIP 曲目。会话仅保存在本机浏览器。</p>

        <div className="login-modal__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'qr'}
            className={`login-modal__tab${tab === 'qr' ? ' login-modal__tab--active' : ''}`}
            onClick={() => setTab('qr')}
          >
            <QrCode size={15} /> 扫码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'phone'}
            className={`login-modal__tab${tab === 'phone' ? ' login-modal__tab--active' : ''}`}
            onClick={() => setTab('phone')}
          >
            <Smartphone size={15} /> 手机号登录
          </button>
        </div>

        {tab === 'qr' ? (
          <div className="login-modal__qr">
            <div className={`login-modal__qr-box${stage === 'expired' || stage === 'done' ? ' login-modal__qr-box--mask' : ''}`}>
              {qrimg ? (
                <img src={qrimg} alt="登录二维码" />
              ) : (
                <Loader2 size={28} className="spinner" />
              )}
              {stage === 'expired' && (
                <button type="button" className="login-modal__qr-refresh" onClick={() => void startQr()}>
                  点击刷新
                </button>
              )}
              {stage === 'done' && (
                <div className="login-modal__qr-done">
                  <CheckCircle2 size={36} />
                </div>
              )}
            </div>
            <p className="login-modal__qr-text">{STAGE_TEXT[stage]}</p>
          </div>
        ) : (
          <form className="login-modal__form" onSubmit={submitPhone}>
            <label className="login-modal__field">
              <span>手机号</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                autoComplete="username"
                inputMode="numeric"
              />
            </label>
            <label className="login-modal__field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="login-modal__submit" disabled={fetching || !phone.trim() || !password}>
              {fetching ? <Loader2 size={16} className="spinner" /> : null}
              {fetching ? '登录中…' : '登录'}
            </button>
          </form>
        )}

        {error && <p className="login-modal__error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
