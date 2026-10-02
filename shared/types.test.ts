import { describe, it, expect } from 'vitest'
import { formatTime, streamUrl } from './types.js'

describe('formatTime', () => {
  it('格式化 0 秒', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('秒数补零', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(600)).toBe('10:00')
  })

  it('向下取整', () => {
    expect(formatTime(59.9)).toBe('0:59')
    expect(formatTime(61.7)).toBe('1:01')
  })

  it('非法输入回退为 0:00', () => {
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(-1)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
  })
})

describe('streamUrl', () => {
  it('基础路径', () => {
    expect(streamUrl('123')).toBe('/stream/123')
  })

  it('编码特殊字符 ID', () => {
    expect(streamUrl('a/b')).toBe('/stream/a%2Fb')
  })

  it('附带 level 参数', () => {
    expect(streamUrl('123', { level: 'lossless' })).toBe('/stream/123?level=lossless')
  })

  it('附带 token 参数', () => {
    const url = streamUrl('123', { level: 'exhigh', token: 'abc' })
    expect(url).toContain('level=exhigh')
    expect(url).toContain('t=abc')
  })
})
