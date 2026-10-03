import { describe, it, expect } from 'vitest'
import { normalizeTrack, normalizeArtist, normalizeAlbum } from './netease.js'

describe('normalizeTrack', () => {
  it('填充 artistRefs 与 albumId，并把封面改写为 https', () => {
    const t = normalizeTrack({
      id: 1,
      name: '歌',
      fee: 0,
      dt: 200_000,
      ar: [
        { id: 10, name: '甲' },
        { id: 20, name: '乙' },
      ],
      al: { id: 99, name: '专辑', picUrl: 'http://p1.music.126.net/x.jpg' },
    })
    expect(t.artist).toBe('甲 / 乙')
    expect(t.artistRefs).toEqual([
      { id: '10', name: '甲' },
      { id: '20', name: '乙' },
    ])
    expect(t.albumId).toBe('99')
    expect(t.album).toBe('专辑')
    expect(t.cover.startsWith('https://')).toBe(true)
    expect(t.duration).toBe(200)
  })

  it('缺少 id 时 artistRefs / albumId 为 undefined（供前端降级为纯文本）', () => {
    const t = normalizeTrack({ id: 2, name: 'x', ar: [{ name: '甲' }], al: { name: '专辑' } })
    expect(t.artistRefs).toBeUndefined()
    expect(t.albumId).toBeUndefined()
    expect(t.artist).toBe('甲')
    expect(t.album).toBe('专辑')
  })
})

describe('normalizeArtist', () => {
  it('归一化头像为 https 并保留统计信息', () => {
    const a = normalizeArtist({
      id: 5,
      name: '某艺人',
      picUrl: 'http://p.music.126.net/a.jpg',
      albumSize: 3,
      musicSize: 20,
      alias: ['别名'],
    })
    expect(a.id).toBe('5')
    expect(a.avatar.startsWith('https://')).toBe(true)
    expect(a.avatar).toContain('?param=300y300')
    expect(a.albumSize).toBe(3)
    expect(a.musicSize).toBe(20)
    expect(a.alias).toEqual(['别名'])
  })
})

describe('normalizeAlbum', () => {
  it('取主艺人 id 与发行年份', () => {
    const al = normalizeAlbum({
      id: 7,
      name: '某专辑',
      picUrl: 'http://p.music.126.net/b.jpg',
      artists: [
        { id: 3, name: '甲' },
        { id: 4, name: '乙' },
      ],
      size: 10,
      publishTime: Date.UTC(2020, 5, 15, 12),
    })
    expect(al.id).toBe('7')
    expect(al.artist).toBe('甲 / 乙')
    expect(al.artistId).toBe('3')
    expect(al.year).toBe(2020)
    expect(al.trackCount).toBe(10)
    expect(al.cover.startsWith('https://')).toBe(true)
  })
})
