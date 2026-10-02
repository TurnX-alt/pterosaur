import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// 每个测试后卸载 React 树，避免相互污染
afterEach(() => {
  cleanup()
})

// jsdom 未实现 matchMedia，主题钩子依赖它
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// jsdom 未实现 URL.createObjectURL（部分组件可能用到）
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock')
}

// 静默 localStorage 未实现时的报错
if (!window.localStorage) {
  const store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length
      },
    },
    writable: true,
  })
}
