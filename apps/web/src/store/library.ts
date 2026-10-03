import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Track, Playlist, Album } from '@pterosaur/shared/types'
import { libraryStorage } from '../lib/libraryStorage.js'

/** 用户自建歌单（本地存储，不含曲目正文，仅存曲目引用）。 */
export interface LocalPlaylist {
  id: string
  name: string
  /** 创建时间戳。 */
  createdAt: number
  /** 曲目列表（完整 Track，便于离线展示）。 */
  tracks: Track[]
}

export interface LibraryState {
  /** 收藏（我喜欢）的曲目。 */
  favorites: Track[]
  /** 最近播放（去重，最多 100 条）。 */
  recent: Track[]
  /** 本地自建歌单。 */
  playlists: LocalPlaylist[]
  /** 收藏的网易云歌单引用。 */
  savedPlaylists: Playlist[]
  /** 收藏的网易云专辑引用。 */
  savedAlbums: Album[]
}

interface LibraryActions {
  toggleFavorite: (track: Track) => void
  isFavorite: (id: string) => boolean
  addRecent: (track: Track) => void
  clearRecent: () => void
  createPlaylist: (name: string, tracks?: Track[]) => string
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => void
  addToPlaylist: (playlistId: string, track: Track) => void
  removeFromPlaylist: (playlistId: string, trackId: string) => void
  toggleSavePlaylist: (playlist: Playlist) => void
  toggleSaveAlbum: (album: Album) => void
}

export type LibraryStore = LibraryState & LibraryActions

const MAX_RECENT = 100

function genId(): string {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const useLibrary = create<LibraryStore>()(
  persist(
    (set, get) => ({
      favorites: [],
      recent: [],
      playlists: [],
      savedPlaylists: [],
      savedAlbums: [],

      toggleFavorite: (track) =>
        set((s) => {
          const exists = s.favorites.some((t) => t.id === track.id)
          return {
            favorites: exists ? s.favorites.filter((t) => t.id !== track.id) : [track, ...s.favorites],
          }
        }),

      isFavorite: (id) => get().favorites.some((t) => t.id === id),

      addRecent: (track) =>
        set((s) => {
          const rest = s.recent.filter((t) => t.id !== track.id)
          return { recent: [track, ...rest].slice(0, MAX_RECENT) }
        }),

      clearRecent: () => set({ recent: [] }),

      createPlaylist: (name, tracks = []) => {
        const id = genId()
        set((s) => ({
          playlists: [...s.playlists, { id, name: name || '新建歌单', createdAt: Date.now(), tracks }],
        }))
        return id
      },

      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),

      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) })),

      addToPlaylist: (playlistId, track) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.tracks.some((t) => t.id === track.id)
              ? { ...p, tracks: [...p.tracks, track] }
              : p,
          ),
        })),

      removeFromPlaylist: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p,
          ),
        })),

      toggleSavePlaylist: (playlist) =>
        set((s) => {
          const exists = s.savedPlaylists.some((p) => p.id === playlist.id)
          return {
            savedPlaylists: exists
              ? s.savedPlaylists.filter((p) => p.id !== playlist.id)
              : [playlist, ...s.savedPlaylists],
          }
        }),

      toggleSaveAlbum: (album) =>
        set((s) => {
          const exists = s.savedAlbums.some((a) => a.id === album.id)
          return {
            savedAlbums: exists ? s.savedAlbums.filter((a) => a.id !== album.id) : [album, ...s.savedAlbums],
          }
        }),
    }),
    {
      name: 'pterosaur-library',
      storage: libraryStorage,
      // 仅持久化数据字段：IDB 的 structured clone 无法克隆 action 函数（会抛 DataCloneError）
      partialize: (s) => ({
        favorites: s.favorites,
        recent: s.recent,
        playlists: s.playlists,
        savedPlaylists: s.savedPlaylists,
        savedAlbums: s.savedAlbums,
      }),
      // 迁移到异步 IDB 后，hydration 不再是同步的：由 main.tsx 在首次渲染前手动 rehydrate，
      // 消除「库为空」的闪烁。
      skipHydration: true,
    },
  ),
)
