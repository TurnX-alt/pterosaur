import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Loader2, CheckCircle2 } from 'lucide-react'
import type { MusicSource } from '@pterosaur/shared/types'
import { MUSIC_SOURCES } from '@pterosaur/shared/types'
import { api } from '../api/client.js'
import { useAuth, finishQrLogin } from '../store/auth.js'
import { IconButton } from './IconButton.js'
import './LoginModal.css'

/** 扫码状态：loading 加载中 / waiting 等待扫码 / scanned 待确认 / expired 已过期 / done 成功 */
type QrStage = 'loading' | 'waiting' | 'scanned' | 'expired' | 'done'

/** 源的中文全名（用于标题与引导文案）。 */
const SOURCE_LABELS: Record<MusicSource, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  migu: '咪咕音乐',
}

/**
 * 连接「动词 + 源名」时按**中英混排**补空格：源名以拉丁字母开头（「QQ 音乐」）时加一个空格，
 * 纯中文（「网易云音乐」）则不加——避免「登录QQ 音乐」这种紧贴。
 */
function joinLabel(prefix: string, source: MusicSource): string {
  const label = SOURCE_LABELS[source]
  return /^[A-Za-z]/.test(label) ? `${prefix} ${label}` : `${prefix}${label}`
}

/** 各扫码阶段的文案（引导文案随源变化）。 */
function stageText(source: MusicSource): Record<QrStage, string> {
  return {
    loading: '二维码加载中…',
    waiting: `${joinLabel('打开', source)} App 扫码登录`,
    scanned: '扫码成功，请在手机上确认',
    expired: '二维码已过期，点击刷新',
    done: '登录成功',
  }
}

/**
 * 登录弹窗：各音源统一以**扫码**登录（网易云与 QQ 音乐均只提供扫码，不再支持帐密登录）。
 *
 * 流程：`/api/auth/:source/qr` 取 key+图片 → 每 2s 轮询 `/api/auth/:source/qr/check`
 * → 803 成功时后端下发该源 Set-Cookie，前端写入对应源登录态并关闭弹窗。
 */
export function LoginModal() {
  const closeModal = useAuth((s) => s.closeModal)
  const error = useAuth((s) => s.error)
  const setError = useAuth((s) => s.setError)
  const modalSource = useAuth((s) => s.modalSource)
  const status = useAuth((s) => s.status)

  const [source, setSource] = useState<MusicSource>(modalSource)

  // 仅列出**支持登录**的源——无登录能力的源（如咪咕）不出现（见 ADR-032）
  const loggableSources = MUSIC_SOURCES.filter((s) => status[s]?.loginable)

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

  const startQr = useCallback(
    async (src: MusicSource) => {
      stopPolling()
      setStage('loading')
      setQrimg('')
      try {
        const { key: k, qrimg: img } = await api.qrCreate(src)
        if (!aliveRef.current) return
        setQrimg(img)
        setStage('waiting')
        // 轮询扫码状态
        timerRef.current = window.setInterval(async () => {
          if (!aliveRef.current) return
          try {
            const res = await api.qrCheck(src, k)
            if (!aliveRef.current) return
            const code = res.code ?? 800
            if (code === 803) {
              stopPolling()
              // 只有后端确认建立了会话（logged）才算成功——否则如实报错，避免"看着登录了、刷新就掉"。
              if (res.logged) {
                setStage('done')
                finishQrLogin(src, {
                  logged: true,
                  nickname: res.nickname,
                  avatarUrl: res.avatarUrl,
                  userId: res.userId,
                  vip: res.vip,
                })
              } else {
                setStage('expired')
                setError(res.message ?? '登录成功但未能建立会话，请重试')
              }
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
    },
    [stopPolling, setError],
  )

  // 打开弹窗时对齐到触发它的源
  useEffect(() => {
    setSource(modalSource)
  }, [modalSource])

  // 源变化时（重新）生成二维码
  useEffect(() => {
    aliveRef.current = true
    void startQr(source)
    return () => {
      aliveRef.current = false
      stopPolling()
    }
  }, [source, startQr, stopPolling])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal])

  return (
    <div
      className="login-modal"
      role="dialog"
      aria-modal="true"
      aria-label={joinLabel('登录', source)}
    >
      <div className="login-modal__scrim" onClick={closeModal} aria-hidden />
      <div className="login-modal__card">
        <header className="login-modal__head">
          <h2>{joinLabel('登录', source)}</h2>
          <IconButton label="关闭" size="sm" onClick={closeModal}>
            <X size={18} />
          </IconButton>
        </header>

        <p className="login-modal__hint">登录后可享用免费云同步服务。</p>

        <div className="login-modal__tabs" role="tablist" aria-label="音源">
          {loggableSources.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              className={`login-modal__tab${source === s ? ' login-modal__tab--active' : ''}`}
              onClick={() => setSource(s)}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="login-modal__qr">
          <div
            className={`login-modal__qr-box${stage === 'expired' || stage === 'done' ? ' login-modal__qr-box--mask' : ''}`}
          >
            {qrimg ? (
              <img src={qrimg} alt="登录二维码" />
            ) : (
              <Loader2 size={28} className="spinner" />
            )}
            {stage === 'expired' && (
              <button
                type="button"
                className="login-modal__qr-refresh"
                onClick={() => void startQr(source)}
              >
                点击刷新
              </button>
            )}
            {stage === 'done' && (
              <div className="login-modal__qr-done">
                <CheckCircle2 size={36} />
              </div>
            )}
          </div>
          <p className="login-modal__qr-text">{stageText(source)[stage]}</p>
        </div>

        {error && (
          <p className="login-modal__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
