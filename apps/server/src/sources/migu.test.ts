import { describe, it, expect } from 'vitest'
import {
  canonicalMiguImage,
  miguToneCandidates,
  normalizeMiguAlbum,
  normalizeMiguPlaylist,
  normalizeMiguTrack,
} from './migu.js'

describe('normalizeMiguTrack', () => {
  it('搜索形态：singers / albums / imgItems（取 03 大图，https 改写）', () => {
    const t = normalizeMiguTrack({
      contentId: '600929000000096577',
      name: '圣诞星',
      singers: [{ id: '112', name: '周杰伦' }],
      albums: [{ id: '1140505221', name: '圣诞星' }],
      imgItems: [
        { imgSizeType: '01', img: 'http://d.musicapp.migu.cn/a.webp' },
        { imgSizeType: '03', img: 'http://d.musicapp.migu.cn/c.webp' },
      ],
      showTags: ['vip'],
    })
    expect(t.source).toBe('migu')
    expect(t.id).toBe('600929000000096577')
    expect(t.title).toBe('圣诞星')
    expect(t.artist).toBe('周杰伦')
    expect(t.album).toBe('圣诞星')
    expect(t.cover).toBe('https://d.musicapp.migu.cn/c.webp')
    expect(t.fee).toBe('vip')
    expect(t.albumId).toBe('1140505221')
    expect(t.artistRefs).toEqual([{ id: '112', name: '周杰伦' }])
  })

  it('列表形态：singerList / album 字符串 / imgN（优先 img3 大图）', () => {
    const t = normalizeMiguTrack({
      contentId: '1004368251',
      songName: '一笑而过',
      singerList: [{ id: '9', name: '那英' }],
      album: '一笑而过',
      albumId: '55',
      img1: 'http://x/1.webp',
      img3: 'http://x/3.webp',
      duration: 274,
      showTags: ['hq'],
    })
    expect(t.title).toBe('一笑而过')
    expect(t.artist).toBe('那英')
    expect(t.cover).toBe('https://x/3.webp')
    expect(t.duration).toBe(274)
    expect(t.fee).toBe('free')
  })

  it('多歌手以 / 连接；缺失字段降级', () => {
    const t = normalizeMiguTrack({
      contentId: '1',
      name: '合作曲',
      singers: [
        { id: '1', name: '甲' },
        { id: '2', name: '乙' },
      ],
    })
    expect(t.artist).toBe('甲 / 乙')
    expect(t.artistRefs).toEqual([
      { id: '1', name: '甲' },
      { id: '2', name: '乙' },
    ])

    const empty = normalizeMiguTrack({})
    expect(empty.id).toBe('')
    expect(empty.title).toBe('未知曲目')
    expect(empty.artist).toBe('未知艺人')
    expect(empty.cover).toBe('')
    expect(empty.fee).toBe('free')
  })

  it('vipType 判定版权标记（非 0 即 VIP）', () => {
    expect(normalizeMiguTrack({ contentId: '1', vipType: '1' }).fee).toBe('vip')
    expect(normalizeMiguTrack({ contentId: '1', vipType: '0' }).fee).toBe(
      'free',
    )
  })

  it('列表形态：相对 imgN 补主机；length 退化解析时长；rateFormats 的 showTag 判 VIP', () => {
    const t = normalizeMiguTrack({
      contentId: '1',
      songName: '夜曲',
      singerList: [{ id: '9', name: '周杰伦' }],
      img1: '/data/oss/resource/00/aa/x1.webp',
      img3: '/data/oss/resource/00/aa/x3.webp',
      length: '00:03:42',
      rateFormats: [
        { formatType: 'LQ' },
        { formatType: 'PQ', showTag: ['vip'] },
      ],
    })
    expect(t.cover).toBe(
      'https://d.musicapp.migu.cn/data/oss/resource/00/aa/x3.webp',
    )
    expect(t.duration).toBe(222)
    expect(t.fee).toBe('vip')
  })
})

describe('miguToneCandidates', () => {
  it('抽象档 → toneFlag 候选链（不可得时逐级降级）', () => {
    expect(miguToneCandidates('standard')).toEqual(['PQ'])
    expect(miguToneCandidates('higher')).toEqual(['HQ', 'PQ'])
    expect(miguToneCandidates('exhigh')).toEqual(['HQ', 'PQ'])
    expect(miguToneCandidates('lossless')).toEqual(['SQ', 'HQ', 'PQ'])
    expect(miguToneCandidates('hires')).toEqual(['ZQ', 'SQ', 'HQ', 'PQ'])
  })
})

describe('canonicalMiguImage', () => {
  it('http → https；空值返回空串', () => {
    expect(canonicalMiguImage('http://d.musicapp.migu.cn/a.webp')).toBe(
      'https://d.musicapp.migu.cn/a.webp',
    )
    expect(canonicalMiguImage('https://d.musicapp.migu.cn/a.webp')).toBe(
      'https://d.musicapp.migu.cn/a.webp',
    )
    expect(canonicalMiguImage(undefined)).toBe('')
  })

  it('相对路径补全主机（列表/歌手条目的 imgN 是相对路径，不补会破图）', () => {
    expect(canonicalMiguImage('/data/oss/resource/00/5u/7q/x.webp')).toBe(
      'https://d.musicapp.migu.cn/data/oss/resource/00/5u/7q/x.webp',
    )
    expect(canonicalMiguImage('//d.musicapp.migu.cn/a.webp')).toBe(
      'https://d.musicapp.migu.cn/a.webp',
    )
  })
})

describe('normalizeMiguAlbum', () => {
  it('搜索/详情形态：imgItems / singer / publishDate / totalCount', () => {
    const a = normalizeMiguAlbum({
      id: '1140505221',
      name: '圣诞星',
      singer: '周杰伦',
      singerId: '112',
      publishDate: '2023-12-22',
      totalCount: '2',
      imgItems: [
        { imgSizeType: '01', img: 'http://x/s.webp' },
        { imgSizeType: '03', img: 'http://x/l.webp' },
      ],
    })
    expect(a).toMatchObject({
      source: 'migu',
      id: '1140505221',
      name: '圣诞星',
      cover: 'https://x/l.webp',
      artist: '周杰伦',
      artistId: '112',
      year: 2023,
      trackCount: 2,
    })
  })
})

describe('normalizeMiguPlaylist', () => {
  it('详情形态：musicListId / title / imgItem / ownerName / opNumItem', () => {
    const p = normalizeMiguPlaylist({
      musicListId: '236649497',
      title: '华语女声',
      summary: '精选华语',
      imgItem: { img: 'http://x/p.webp' },
      ownerName: '难过',
      musicNum: 191,
      opNumItem: { playNum: 1137287 },
    })
    expect(p).toMatchObject({
      source: 'migu',
      id: '236649497',
      name: '华语女声',
      cover: 'https://x/p.webp',
      creator: '难过',
      trackCount: 191,
      playCount: 1137287,
    })
  })

  it('搜索形态：id / name / musicListPicUrl', () => {
    const p = normalizeMiguPlaylist({
      id: '99',
      name: '榜单',
      musicListPicUrl: 'http://x/s.webp',
      userId: 'u1',
      musicNum: 12,
      playNum: 345,
    })
    expect(p).toMatchObject({
      id: '99',
      name: '榜单',
      cover: 'https://x/s.webp',
      creator: 'u1',
      trackCount: 12,
      playCount: 345,
    })
  })
})
