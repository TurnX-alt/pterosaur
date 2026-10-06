import { describe, it, expect } from 'vitest'
import {
  buildVkeyFilename,
  canonicalQqImage,
  canonicalQqSingerImage,
  cookieHeaderFromSetCookies,
  hash33,
  normalizeQqAlbum,
  normalizeQqArtist,
  normalizeQqPlaylist,
  normalizeQqTrack,
  qqLevelToCandidates,
  qqSign,
  readCookieValue,
} from './qq.js'

describe('normalizeQqTrack（QQ 原始曲目 → 共享 Track）', () => {
  it('归一化老接口字段（songmid/songname/albummid）', () => {
    const t = normalizeQqTrack({
      songmid: '003rJSwm3TechU',
      songname: '晴天',
      singer: [{ id: 6452, mid: '001BLpXF2DyJe2', name: '周杰伦' }],
      albummid: '000MkMni19ClKG',
      albumname: '叶惠美',
      interval: 269,
      pay: { payplay: 1 },
    })
    expect(t.source).toBe('qq')
    expect(t.id).toBe('003rJSwm3TechU')
    expect(t.title).toBe('晴天')
    expect(t.artist).toBe('周杰伦')
    expect(t.album).toBe('叶惠美')
    expect(t.duration).toBe(269)
    expect(t.cover).toBe('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000000MkMni19ClKG.jpg')
    expect(t.artistRefs).toEqual([{ id: '001BLpXF2DyJe2', name: '周杰伦' }])
    expect(t.albumId).toBe('000MkMni19ClKG')
    expect(t.fee).toBe('vip')
  })

  it('归一化 new_json 字段（mid/name/album 对象，pay_play 新式版权键）', () => {
    const t = normalizeQqTrack({
      mid: 'AAA',
      name: '某曲',
      singer: [{ mid: 's1', name: '甲' }, { mid: 's2', name: '乙' }],
      album: { mid: 'al1', name: '某专辑' },
      interval: 180,
      pay: { pay_play: 0 },
    })
    expect(t.id).toBe('AAA')
    expect(t.artist).toBe('甲 / 乙')
    expect(t.album).toBe('某专辑')
    expect(t.albumId).toBe('al1')
    expect(t.fee).toBe('free')
  })

  it('新式付费键 pay_play=1 判为 vip', () => {
    expect(normalizeQqTrack({ mid: 'X', name: 'x', pay: { pay_play: 1 } }).fee).toBe('vip')
  })

  it('缺字段时降级不崩', () => {
    const t = normalizeQqTrack({ songmid: 'X' })
    expect(t.id).toBe('X')
    expect(t.title).toBe('未知曲目')
    expect(t.artist).toBe('未知艺人')
    expect(t.cover).toBe('')
    expect(t.artistRefs).toBeUndefined()
  })
})

describe('canonicalQqImage', () => {
  it('固定 https + 稳定主机 + 尺寸', () => {
    expect(canonicalQqImage('MID')).toBe('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000MID.jpg')
  })
  it('缺 mid 返回空串', () => {
    expect(canonicalQqImage(undefined)).toBe('')
    expect(canonicalQqImage('')).toBe('')
  })
})

describe('normalizeQqAlbum / Artist / Playlist', () => {
  it('专辑：字段命名容错 + 年份解析', () => {
    const a = normalizeQqAlbum({
      albumMID: 'MID',
      albumName: '专辑',
      singerName: '艺人',
      singerMID: 'SMID',
      pubTime: '2020-01-01',
      songCount: 10,
    })
    expect(a.source).toBe('qq')
    expect(a.id).toBe('MID')
    expect(a.cover).toBe('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000MID.jpg')
    expect(a.artistId).toBe('SMID')
    expect(a.year).toBe(2020)
    expect(a.trackCount).toBe(10)
  })

  it('专辑：别名键名 albummid/albumname/singername', () => {
    const a = normalizeQqAlbum({ albummid: 'M2', albumname: '别名', singername: '甲' })
    expect(a.id).toBe('M2')
    expect(a.name).toBe('别名')
    expect(a.artist).toBe('甲')
  })

  it('歌手：头像用 T001 模板', () => {
    const ar = normalizeQqArtist({ singerMID: 'S1', singerName: '甲', songNum: 5, albumNum: 2 })
    expect(ar.id).toBe('S1')
    expect(ar.avatar).toBe('https://y.gtimg.cn/music/photo_new/T001R1200x1200M000S1.jpg')
    expect(ar.musicSize).toBe(5)
    expect(ar.albumSize).toBe(2)
  })

  it('歌单：disstid 优先于 dissid（详情接口的 dissid 是错的）', () => {
    expect(normalizeQqPlaylist({ disstid: '9138127385', dissid: 9138127 }).id).toBe('9138127385')
    expect(normalizeQqPlaylist({ dissid: '7503326333' }).id).toBe('7503326333')
  })

  it('歌单：disstid/logo 与 creator', () => {
    const p = normalizeQqPlaylist({
      disstid: 9138127385,
      dissname: '歌单',
      logo: 'http://p.x/logo.jpg',
      song_count: 20,
      visitnum: 100,
      nickname: '小明',
    })
    expect(p.source).toBe('qq')
    expect(p.id).toBe('9138127385')
    expect(p.cover).toBe('https://p.x/logo.jpg')
    expect(p.trackCount).toBe(20)
    expect(p.creator).toBe('小明')
  })

  it('canonicalQqSingerImage 空 mid 返回空串', () => {
    expect(canonicalQqSingerImage(undefined)).toBe('')
    expect(canonicalQqSingerImage('x')).toBe('https://y.gtimg.cn/music/photo_new/T001R1200x1200M000x.jpg')
  })
})

describe('qqLevelToCandidates / buildVkeyFilename（按档取流）', () => {
  it('抽象档映射到 QQ 候选链（由高到低，含降级）', () => {
    expect(qqLevelToCandidates('hires').map((c) => c.prefix)).toEqual(['Q000', 'F000', 'M800'])
    expect(qqLevelToCandidates('lossless')[0]).toEqual({ prefix: 'F000', ext: '.flac' })
    expect(qqLevelToCandidates('exhigh')[0]).toEqual({ prefix: 'M800', ext: '.mp3' })
    expect(qqLevelToCandidates('standard')[0]).toEqual({ prefix: 'M500', ext: '.mp3' })
  })

  it('filename 以 media_mid 为主体；缺失时用 songmid 兜底', () => {
    expect(buildVkeyFilename('F000', '.flac', 'SONGMID', 'MEDIA')).toBe('F000MEDIA.flac')
    expect(buildVkeyFilename('F000', '.flac', 'SONGMID')).toBe('F000SONGMIDSONGMID.flac')
  })
})

describe('qqSign（经典 zzc 签名）', () => {
  it('确定性、zzc 前缀、全小写', () => {
    const a = qqSign('{"comm":{"uin":"0"}}')
    const b = qqSign('{"comm":{"uin":"0"}}')
    expect(a).toBe(b)
    expect(a.startsWith('zzc')).toBe(true)
    expect(a).toBe(a.toLowerCase())
    // zzc + part1(7) + b64 + part2(8)
    expect(a.length).toBeGreaterThan(20)
  })

  it('不同输入产生不同签名', () => {
    expect(qqSign('a')).not.toBe(qqSign('b'))
  })
})

describe('hash33（ptqrtoken）', () => {
  it('确定性且为 31 位非负整数', () => {
    const v = hash33('abc')
    expect(v).toBe(hash33('abc'))
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(2147483647)
  })
})

describe('cookie 收敛', () => {
  it('只保留白名单 cookie', () => {
    const header = cookieHeaderFromSetCookies([
      'uin=12345; Path=/; Domain=qq.com',
      'qqmusic_key=KEY; Path=/',
      'some_unrelated=zzz; Path=/',
      'qrsig=abc; Path=/',
    ])
    expect(header).toBe('uin=12345; qqmusic_key=KEY')
  })

  it('readCookieValue 提取指定项', () => {
    expect(readCookieValue(['qrsig=ABC; Path=/'], 'qrsig')).toBe('ABC')
    expect(readCookieValue(['a=1'], 'qrsig')).toBeUndefined()
  })
})
