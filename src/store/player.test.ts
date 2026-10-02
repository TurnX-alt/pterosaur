import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayer, advanceOnEnd, shuffledIndexes } from './player.js'
import type { Track } from '../../shared/types.js'

/** 构造测试用曲目。 */
function track(id: string, title = `曲目${id}`): Track {
  return {
    id,
    title,
    artist: '艺人',
    album: '专辑',
    cover: '',
    duration: 100,
    fee: 'free',
  }
}

const SONGS = [track('1'), track('2'), track('3'), track('4'), track('5')]

/** 每个测试前重置 store 到初始态。 */
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
})

describe('advanceOnEnd（自然结束推进逻辑）', () => {
  it('repeat=one 停留在当前', () => {
    expect(advanceOnEnd(2, 5, 'one')).toBe(2)
  })

  it('repeat=all 中间曲目 -> 下一首', () => {
    expect(advanceOnEnd(2, 5, 'all')).toBe(3)
  })

  it('repeat=all 末尾 -> 回到 0', () => {
    expect(advanceOnEnd(4, 5, 'all')).toBe(0)
  })

  it('repeat=off 中间 -> 下一首', () => {
    expect(advanceOnEnd(2, 5, 'off')).toBe(3)
  })

  it('repeat=off 末尾 -> null（停止）', () => {
    expect(advanceOnEnd(4, 5, 'off')).toBeNull()
  })

  it('空队列 -> null', () => {
    expect(advanceOnEnd(0, 0, 'all')).toBeNull()
  })
})

describe('shuffledIndexes', () => {
  it('返回全部下标且不重不漏', () => {
    const idx = shuffledIndexes(5, 0)
    expect(idx).toHaveLength(5)
    expect([...idx].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('种子曲目排在首位', () => {
    const idx = shuffledIndexes(5, 3)
    expect(idx[0]).toBe(3)
  })
})

describe('usePlayer.playTracks', () => {
  it('以指定曲目为队列并从 startIndex 播放', () => {
    usePlayer.getState().playTracks(SONGS, 2)
    const s = usePlayer.getState()
    expect(s.queue).toHaveLength(5)
    expect(s.index).toBe(2)
    expect(s.current?.id).toBe('3')
    expect(s.isPlaying).toBe(true)
    expect(s.position).toBe(0)
  })

  it('startIndex 越界时收敛到合法范围', () => {
    usePlayer.getState().playTracks(SONGS, 99)
    expect(usePlayer.getState().index).toBe(4)
    usePlayer.getState().playTracks(SONGS, -5)
    expect(usePlayer.getState().index).toBe(0)
  })

  it('空数组不改变状态', () => {
    usePlayer.getState().playTracks([])
    expect(usePlayer.getState().current).toBeNull()
  })

  it('baseQueue 保存原始顺序', () => {
    usePlayer.getState().playTracks(SONGS, 0)
    expect(usePlayer.getState().baseQueue.map((t) => t.id)).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('usePlayer.next / prev', () => {
  beforeEach(() => {
    usePlayer.getState().playTracks(SONGS, 0)
  })

  it('next 前进到下一首', () => {
    usePlayer.getState().next()
    expect(usePlayer.getState().current?.id).toBe('2')
    expect(usePlayer.getState().index).toBe(1)
  })

  it('repeat=all 时末尾 next 回到 0', () => {
    usePlayer.setState({ index: 4, current: SONGS[4] })
    usePlayer.getState().next()
    expect(usePlayer.getState().index).toBe(0)
  })

  it('repeat=off 时末尾 next 停在末尾', () => {
    usePlayer.setState({ index: 4, current: SONGS[4], repeat: 'off' })
    usePlayer.getState().next()
    expect(usePlayer.getState().index).toBe(4)
  })

  it('prev 回到上一首', () => {
    usePlayer.setState({ index: 2, current: SONGS[2], position: 0 })
    usePlayer.getState().prev()
    expect(usePlayer.getState().index).toBe(1)
  })

  it('position>3 时 prev 仅回到开头', () => {
    usePlayer.setState({ index: 2, current: SONGS[2], position: 30 })
    usePlayer.getState().prev()
    expect(usePlayer.getState().index).toBe(2)
    expect(usePlayer.getState().position).toBe(0)
  })

  it('开头 prev 回到末尾（repeat=all 语境）', () => {
    usePlayer.setState({ index: 0, current: SONGS[0], position: 0 })
    usePlayer.getState().prev()
    expect(usePlayer.getState().index).toBe(4)
  })
})

describe('usePlayer 播放模式', () => {
  it('cycleRepeat 循环切换 off->all->one->off', () => {
    usePlayer.setState({ repeat: 'off' })
    usePlayer.getState().cycleRepeat()
    expect(usePlayer.getState().repeat).toBe('all')
    usePlayer.getState().cycleRepeat()
    expect(usePlayer.getState().repeat).toBe('one')
    usePlayer.getState().cycleRepeat()
    expect(usePlayer.getState().repeat).toBe('off')
  })

  it('toggleShuffle 开启后保持当前曲目并重排', () => {
    usePlayer.getState().playTracks(SONGS, 2)
    const currentId = usePlayer.getState().current?.id
    usePlayer.getState().toggleShuffle()
    const s = usePlayer.getState()
    expect(s.shuffle).toBe(true)
    // 当前曲目应排在打乱队列首位
    expect(s.queue[0].id).toBe(currentId)
    expect(s.queue).toHaveLength(5)
  })

  it('toggleShuffle 关闭后恢复原始顺序并保持当前曲目', () => {
    usePlayer.getState().playTracks(SONGS, 2)
    const currentId = usePlayer.getState().current?.id
    usePlayer.getState().toggleShuffle()
    usePlayer.getState().toggleShuffle()
    const s = usePlayer.getState()
    expect(s.shuffle).toBe(false)
    expect(s.queue.map((t) => t.id)).toEqual(['1', '2', '3', '4', '5'])
    expect(s.current?.id).toBe(currentId)
  })
})

describe('usePlayer 音量', () => {
  it('setVolume 收敛到 [0,1]', () => {
    usePlayer.getState().setVolume(1.5)
    expect(usePlayer.getState().volume).toBe(1)
    usePlayer.getState().setVolume(-0.5)
    expect(usePlayer.getState().volume).toBe(0)
  })

  it('音量归零时自动静音', () => {
    usePlayer.getState().setVolume(0)
    expect(usePlayer.getState().muted).toBe(true)
  })

  it('toggleMute 切换静音', () => {
    usePlayer.setState({ muted: false })
    usePlayer.getState().toggleMute()
    expect(usePlayer.getState().muted).toBe(true)
    usePlayer.getState().toggleMute()
    expect(usePlayer.getState().muted).toBe(false)
  })
})

describe('usePlayer 队列管理', () => {
  beforeEach(() => {
    usePlayer.getState().playTracks(SONGS, 0)
  })

  it('enqueue 追加到队列尾部且不打断当前播放', () => {
    const before = usePlayer.getState().current?.id
    usePlayer.getState().enqueue([track('6'), track('7')])
    const s = usePlayer.getState()
    expect(s.queue).toHaveLength(7)
    expect(s.current?.id).toBe(before)
  })

  it('enqueue 到空队列时直接播放', () => {
    usePlayer.getState().clearQueue()
    usePlayer.getState().enqueue([track('9')])
    expect(usePlayer.getState().current?.id).toBe('9')
    expect(usePlayer.getState().isPlaying).toBe(true)
  })

  it('removeAt 删除非当前曲目时不影响当前下标', () => {
    usePlayer.setState({ index: 2, current: SONGS[2] })
    usePlayer.getState().removeAt(0)
    const s = usePlayer.getState()
    expect(s.queue).toHaveLength(4)
    expect(s.current?.id).toBe('3')
    expect(s.index).toBe(1)
  })

  it('removeAt 删除当前曲目时顺延到下一首', () => {
    usePlayer.setState({ index: 1, current: SONGS[1] })
    usePlayer.getState().removeAt(1)
    const s = usePlayer.getState()
    expect(s.current?.id).toBe('3')
  })

  it('clearQueue 清空并停止', () => {
    usePlayer.getState().clearQueue()
    const s = usePlayer.getState()
    expect(s.queue).toHaveLength(0)
    expect(s.current).toBeNull()
    expect(s.isPlaying).toBe(false)
    expect(s.index).toBe(-1)
  })

  it('playIndex 跳转到指定曲目', () => {
    usePlayer.getState().playIndex(3)
    expect(usePlayer.getState().current?.id).toBe('4')
    expect(usePlayer.getState().index).toBe(3)
  })

  it('playIndex 越界时忽略', () => {
    usePlayer.setState({ index: 1, current: SONGS[1] })
    usePlayer.getState().playIndex(99)
    expect(usePlayer.getState().index).toBe(1)
  })
})

describe('usePlayer toggle', () => {
  it('无当前曲目时 toggle 从队列头开始播放', () => {
    usePlayer.setState({ queue: SONGS, baseQueue: SONGS, current: null, index: -1, isPlaying: false })
    usePlayer.getState().toggle()
    const s = usePlayer.getState()
    expect(s.current?.id).toBe('1')
    expect(s.isPlaying).toBe(true)
  })

  it('有当前曲目时 toggle 切换播放/暂停', () => {
    usePlayer.getState().playTracks(SONGS, 0)
    expect(usePlayer.getState().isPlaying).toBe(true)
    usePlayer.getState().toggle()
    expect(usePlayer.getState().isPlaying).toBe(false)
    usePlayer.getState().toggle()
    expect(usePlayer.getState().isPlaying).toBe(true)
  })
})
