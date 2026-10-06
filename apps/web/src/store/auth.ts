import { create } from 'zustand'
import type { LoginStatus, MusicSource } from '@pterosaur/shared/types'
import { MUSIC_SOURCES, DEFAULT_SOURCE } from '@pterosaur/shared/types'
import { api } from '../api/client.js'

interface AuthState {
  /** 各源各自的登录态（无源的浏览器会话互不影响）。 */
  status: Record<MusicSource, LoginStatus>
  /** 各源是否已向后端查询过登录态（避免闪烁）。 */
  loaded: Record<MusicSource, boolean>
  /** 登录弹窗是否打开。 */
  modalOpen: boolean
  /** 弹窗打开时落在哪个源 tab。 */
  modalSource: MusicSource
  /** 登录中的临时错误提示。 */
  error: string | null
}

interface AuthActions {
  /** 刷新登录态；不传源则刷新全部。 */
  refresh: (source?: MusicSource) => Promise<void>
  openModal: (source?: MusicSource) => void
  closeModal: () => void
  logout: (source: MusicSource) => Promise<void>
  setError: (msg: string | null) => void
}

export type AuthStore = AuthState & AuthActions

/** 生成「每源一份」的全假登录态 / 加载态。 */
const emptyStatus = (): Record<MusicSource, LoginStatus> =>
  Object.fromEntries(
    MUSIC_SOURCES.map((s) => [s, { logged: false }]),
  ) as Record<MusicSource, LoginStatus>
const emptyLoaded = (): Record<MusicSource, boolean> =>
  Object.fromEntries(MUSIC_SOURCES.map((s) => [s, false])) as Record<
    MusicSource,
    boolean
  >

export const useAuth = create<AuthStore>()((set) => ({
  status: emptyStatus(),
  loaded: emptyLoaded(),
  modalOpen: false,
  modalSource: DEFAULT_SOURCE,
  error: null,

  refresh: async (source) => {
    const targets = source ? [source] : [...MUSIC_SOURCES]
    await Promise.all(
      targets.map(async (s) => {
        let st: LoginStatus = { logged: false }
        try {
          st = await api.authStatus(s)
        } catch {
          st = { logged: false }
        }
        set((state) => ({
          status: { ...state.status, [s]: st },
          loaded: { ...state.loaded, [s]: true },
        }))
      }),
    )
  },

  openModal: (source) =>
    set({
      modalOpen: true,
      modalSource: source ?? DEFAULT_SOURCE,
      error: null,
    }),
  closeModal: () => set({ modalOpen: false, error: null }),

  logout: async (source) => {
    try {
      await api.logout(source)
    } finally {
      set((state) => ({
        status: { ...state.status, [source]: { logged: false } },
      }))
    }
  },

  setError: (msg) => set({ error: msg }),
}))

/** 手机号+密码登录已不受支持（网易云与 QQ 均已停用）——登录一律走扫码。 */

/** 扫码登录成功后写入该源登录态并关闭弹窗。 */
export function finishQrLogin(source: MusicSource, status: LoginStatus): void {
  applyLogin(source, status)
}

/** 写入某源登录态、关闭登录弹窗、清空错误。 */
function applyLogin(source: MusicSource, status: LoginStatus): void {
  useAuth.setState((state) => ({
    status: { ...state.status, [source]: status },
    loaded: { ...state.loaded, [source]: true },
    modalOpen: false,
    error: null,
  }))
}

/** 是否任一源已登录。 */
export function isLoggedAny(status: Record<MusicSource, LoginStatus>): boolean {
  return MUSIC_SOURCES.some((s) => status[s]?.logged)
}

/**
 * 当前**活动源**——最多一个源登录；未登录返回 `null`。
 * 退出 / 云同步锚点 / 搜索默认源 / 首页·浏览推荐都跟随它。
 */
export function activeSource(
  status: Record<MusicSource, LoginStatus>,
): MusicSource | null {
  for (const s of MUSIC_SOURCES) if (status[s]?.logged) return s
  return null
}
