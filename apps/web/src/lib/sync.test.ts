import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@pterosaur/shared/types'
import { decideSync, emptyLibrary, snapshotLibrary } from './sync.js'
import { useLibrary } from '../store/library.js'

const envelope = (updatedAt: number): SyncEnvelope => ({ state: emptyLibrary(), updatedAt })

describe('decideSync（LWW）', () => {
  it('云端无数据 → 推送本地', () => {
    expect(decideSync(0, null)).toBe('push')
  })

  it('云端更新 → 采用云端', () => {
    expect(decideSync(100, envelope(200))).toBe('pull')
  })

  it('本地更新或相等 → 推送本地', () => {
    expect(decideSync(300, envelope(200))).toBe('push')
    expect(decideSync(200, envelope(200))).toBe('push')
  })
})

describe('snapshotLibrary / emptyLibrary', () => {
  beforeEach(() => {
    useLibrary.setState({ favorites: [], recent: [], playlists: [], savedPlaylists: [], savedAlbums: [] })
  })

  it('快照只含可同步的数据字段', () => {
    useLibrary.getState().toggleFavorite({ id: '1', title: 't', artist: 'a', album: '', cover: '', duration: 0, fee: 'free' })
    expect(snapshotLibrary().favorites.map((t) => t.id)).toEqual(['1'])
    expect(Object.keys(snapshotLibrary()).sort()).toEqual(
      ['favorites', 'playlists', 'recent', 'savedAlbums', 'savedPlaylists'].sort(),
    )
  })

  it('emptyLibrary 为五个空数组', () => {
    expect(emptyLibrary()).toEqual({ favorites: [], recent: [], playlists: [], savedPlaylists: [], savedAlbums: [] })
  })
})
