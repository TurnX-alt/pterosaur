import { create } from 'zustand'
import type { LoginStatus } from '@pterosaur/shared/types'
import { api } from '../api/client.js'

interface AuthState {
  status: LoginStatus
  /** 是否已向后端查询过登录态（避免闪烁）。 */
  loaded: boolean
  /** 登录弹窗是否打开。 */
  modalOpen: boolean
  /** 登录中的临时错误提示。 */
  error: string | null
  fetching: boolean
}

interface AuthActions {
  refresh: () => Promise<void>
  openModal: () => void
  closeModal: () => void
  logout: () => Promise<void>
  setError: (msg: string | null) => void
}

export type AuthStore = AuthState & AuthActions

export const useAuth = create<AuthStore>()((set) => ({
  status: { logged: false },
  loaded: false,
  modalOpen: false,
  error: null,
  fetching: false,

  refresh: async () => {
    try {
      const status = await api.authStatus()
      set({ status, loaded: true })
    } catch {
      set({ status: { logged: false }, loaded: true })
    }
  },

  openModal: () => set({ modalOpen: true, error: null }),
  closeModal: () => set({ modalOpen: false, error: null }),

  logout: async () => {
    try {
      await api.logout()
    } finally {
      set({ status: { logged: false }, loaded: true })
    }
  },

  setError: (msg) => set({ error: msg }),
}))

/** 手机号+密码登录（成功后刷新登录态）。 */
export async function loginWithPhone(phone: string, password: string): Promise<boolean> {
  useAuth.setState({ fetching: true, error: null })
  try {
    const status = await api.login(phone, password)
    applyLogin(status)
    return true
  } catch (e) {
    useAuth.setState({ error: (e as Error).message })
    return false
  } finally {
    useAuth.setState({ fetching: false })
  }
}

/** 扫码登录成功后写入登录态并关闭弹窗。 */
export function finishQrLogin(status: LoginStatus): void {
  applyLogin(status)
}

/** 写入登录态、关闭登录弹窗、清空错误。 */
function applyLogin(status: LoginStatus): void {
  useAuth.setState({ status, loaded: true, modalOpen: false, error: null })
}
