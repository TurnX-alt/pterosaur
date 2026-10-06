import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_AUDIO_LEVEL, type AudioLevel } from '@pterosaur/shared/types'

/**
 * 应用偏好（本地持久化）。
 *
 * 目前仅含**音质档位**——统一抽象档（见 shared `AudioLevel`）。播放与下载时随 `/stream`
 * 请求以 `?level=` 携带；各源适配器据此按档解析，并在不可得时逐级降级。
 */
interface SettingsState {
  /** 音质档位（抽象档，跨源一致）。 */
  level: AudioLevel
}

interface SettingsActions {
  setLevel: (level: AudioLevel) => void
}

export type SettingsStore = SettingsState & SettingsActions

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      level: DEFAULT_AUDIO_LEVEL,
      setLevel: (level) => set({ level }),
    }),
    {
      name: 'pterosaur-settings',
      partialize: (s) => ({ level: s.level }),
    },
  ),
)
