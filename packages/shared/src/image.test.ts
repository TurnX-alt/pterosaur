import { describe, it, expect } from 'vitest'
import { canonicalNeteaseImage, NETEASE_IMAGE_HOST } from './image.js'

describe('canonicalNeteaseImage', () => {
  it('http → https', () => {
    expect(canonicalNeteaseImage('http://p3.music.126.net/a/b.jpg')).toBe(
      'https://p3.music.126.net/a/b.jpg',
    )
  })

  it('轮换镜像主机（p1/p4）统一到固定主机；裸域 music.126.net 不动（非实测镜像）', () => {
    expect(canonicalNeteaseImage('https://p1.music.126.net/h==/1.jpg?param=600y600')).toBe(
      `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?param=600y600`,
    )
    expect(canonicalNeteaseImage('https://p4.music.126.net/h==/1.jpg?param=600y600')).toBe(
      `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?param=600y600`,
    )
    expect(canonicalNeteaseImage('https://music.126.net/h==/1.jpg')).toBe('https://music.126.net/h==/1.jpg')
  })

  it('已是规范形式时原样返回', () => {
    const url = `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?param=600y600`
    expect(canonicalNeteaseImage(url)).toBe(url)
  })

  it('多个 param 只保留最后一个（同图同尺寸唯一键）', () => {
    expect(canonicalNeteaseImage('https://p1.music.126.net/h==/1.jpg?param=200y200&param=600y600')).toBe(
      `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?param=600y600`,
    )
  })

  it('非 param 查询参数保留不动', () => {
    expect(canonicalNeteaseImage('https://p1.music.126.net/h==/1.jpg?x=1&param=600y600')).toBe(
      `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?x=1&param=600y600`,
    )
  })

  it('非网易云地址原样返回（不猜测其它 CDN 行为）', () => {
    const url = 'http://img.example.com/a.jpg?param=1'
    expect(canonicalNeteaseImage(url)).toBe(url)
  })

  it('空串与无法解析的输入原样返回', () => {
    expect(canonicalNeteaseImage('')).toBe('')
    expect(canonicalNeteaseImage('not a url')).toBe('not a url')
  })
})
