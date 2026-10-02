import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrackList } from './TrackList.js'
import { usePlayer } from '../store/player.js'
import { useLibrary } from '../store/library.js'
import type { Track } from '@pterosaur/shared/types'

function track(id: string, title: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title,
    artist: `艺人${id}`,
    album: `专辑${id}`,
    cover: '',
    duration: 200,
    fee: 'free',
    ...extra,
  }
}

const SONGS = [track('1', '第一首'), track('2', '第二首', { fee: 'vip' }), track('3', '第三首')]

beforeEach(() => {
  usePlayer.setState({
    current: null,
    queue: [],
    index: -1,
    baseQueue: [],
    isPlaying: false,
    position: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    repeat: 'all',
    shuffle: false,
    playError: null,
    expanded: false,
  })
  useLibrary.setState({ favorites: [], recent: [], playlists: [], savedPlaylists: [] })
})

describe('TrackList', () => {
  it('空列表显示占位文案', () => {
    render(<TrackList tracks={[]} emptyText="这里空空如也" />)
    expect(screen.getByText('这里空空如也')).toBeInTheDocument()
  })

  it('渲染所有曲目名称与艺人', () => {
    render(<TrackList tracks={SONGS} />)
    for (const s of SONGS) {
      expect(screen.getByText(s.title)).toBeInTheDocument()
      expect(screen.getByText(s.artist)).toBeInTheDocument()
    }
  })

  it('VIP 曲目不再显示徽标（歌单内隐藏 VIP chip）', () => {
    render(<TrackList tracks={SONGS} />)
    expect(screen.queryByText('VIP')).not.toBeInTheDocument()
  })

  it('时长格式化显示（200s -> 3:20）', () => {
    render(<TrackList tracks={[track('1', 'x', { duration: 200 })]} />)
    expect(screen.getByText('3:20')).toBeInTheDocument()
  })

  it('点击行以该列表为队列播放', () => {
    render(<TrackList tracks={SONGS} />)
    fireEvent.click(screen.getByText('第二首'))
    const s = usePlayer.getState()
    expect(s.current?.id).toBe('2')
    expect(s.queue).toHaveLength(3)
    expect(s.index).toBe(1)
    expect(s.isPlaying).toBe(true)
  })

  it('点击红心收藏曲目', () => {
    render(<TrackList tracks={SONGS} />)
    const hearts = screen.getAllByLabelText('喜欢')
    fireEvent.click(hearts[0])
    expect(useLibrary.getState().favorites).toHaveLength(1)
    expect(useLibrary.getState().favorites[0].id).toBe('1')
  })

  it('已收藏的曲目显示「取消喜欢」并可取消', () => {
    useLibrary.setState({ favorites: [SONGS[0]] })
    render(<TrackList tracks={SONGS} />)
    const btn = screen.getByLabelText('取消喜欢')
    fireEvent.click(btn)
    expect(useLibrary.getState().favorites).toHaveLength(0)
  })

  it('当前播放曲目行高亮（aria 上通过 eq 动画体现，这里验证 current 关联）', () => {
    usePlayer.setState({ current: SONGS[1], queue: SONGS, index: 1, isPlaying: true })
    const { container } = render(<TrackList tracks={SONGS} />)
    const activeRows = container.querySelectorAll('.track-row--current')
    expect(activeRows).toHaveLength(1)
    expect(activeRows[0].textContent).toContain('第二首')
  })

  it('showHeader=false 时不渲染表头', () => {
    const { container } = render(<TrackList tracks={SONGS} showHeader={false} />)
    expect(container.querySelector('.track-list__head')).toBeNull()
  })

  it('点击当前正在播放的曲目会暂停', () => {
    // 先播放
    render(<TrackList tracks={SONGS} />)
    fireEvent.click(screen.getByText('第一首'))
    expect(usePlayer.getState().isPlaying).toBe(true)
    // 再次点击同一首 -> 暂停
    fireEvent.click(screen.getByText('第一首'))
    expect(usePlayer.getState().isPlaying).toBe(false)
  })
})
