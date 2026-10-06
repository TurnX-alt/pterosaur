import { describe, it, expect } from 'vitest'
import { canonicalNeteaseImage, coverAt, NETEASE_IMAGE_HOST } from './image.js'

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

describe('coverAt（按场景选尺寸）', () => {
  it('网易云：规范化镜像主机并设置 param 尺寸（覆盖原尺寸）', () => {
    expect(coverAt('https://p1.music.126.net/h==/1.jpg?param=600y600', 300)).toBe(
      `https://${NETEASE_IMAGE_HOST}/h==/1.jpg?param=300x300`,
    )
  })

  it('QQ：替换路径尺寸段（专辑 T002 / 歌手 T001 均适用）', () => {
    expect(coverAt('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000MID.jpg', 300)).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000MID.jpg',
    )
    expect(coverAt('https://y.gtimg.cn/music/photo_new/T001R1200x1200M000SID.jpg', 300)).toBe(
      'https://y.gtimg.cn/music/photo_new/T001R300x300M000SID.jpg',
    )
  })

  it('其它 CDN / 空值 / 非法地址原样返回（不猜测其 CDN 行为）', () => {
    expect(coverAt('https://img.example.com/a.jpg', 300)).toBe('https://img.example.com/a.jpg')
    expect(coverAt('', 300)).toBe('')
    expect(coverAt(undefined, 300)).toBeUndefined()
    expect(coverAt('not a url', 300)).toBe('not a url')
  })
})
