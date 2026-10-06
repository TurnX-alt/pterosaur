import { describe, it, expect } from 'vitest'
import type { LoginStatus, MusicSource } from '@pterosaur/shared/types'
import { activeSource, isLoggedAny } from './auth.js'

const st = (
  sources: Partial<Record<MusicSource, boolean>>,
): Record<MusicSource, LoginStatus> => ({
  netease: { logged: Boolean(sources.netease) },
  qq: { logged: Boolean(sources.qq) },
})

describe('activeSource / isLoggedAny（单活动账号）', () => {
  it('未登录 → null', () => {
    expect(activeSource(st({}))).toBeNull()
    expect(isLoggedAny(st({}))).toBe(false)
  })

  it('登录某源 → 返回该源', () => {
    expect(activeSource(st({ qq: true }))).toBe('qq')
    expect(activeSource(st({ netease: true }))).toBe('netease')
    expect(isLoggedAny(st({ qq: true }))).toBe(true)
  })

  it('（异常：多源同时登录）取 MUSIC_SOURCES 首位', () => {
    expect(activeSource(st({ netease: true, qq: true }))).toBe('netease')
  })
})
