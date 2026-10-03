import { useCallback, useEffect, useRef, useState } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * 模块级内存缓存：缓存键 -> 最近一次成功的数据。
 * 用于同一路由下的参数切换（如切换歌单）「命中即秒开」，配合内容区转场做交叉溶解。
 */
const asyncCache = new Map<string, unknown>()

/**
 * 通用异步数据钩子。
 *
 * @param fetcher 返回 Promise 的取数函数
 * @param deps 依赖数组，变化时自动重新取数（与 useEffect 一致）
 * @param initial 初始数据（用于缓存命中或乐观渲染）
 * @param cacheKey 可选缓存键：命中时同步返回缓存数据（且不计入 loading），成功后写回
 *
 * 组件卸载后不会再 setState，避免 React 警告；重复请求以「最后一次」为准。
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  initial: T | null = null,
  cacheKey?: string,
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: initial, loading: true, error: null })
  const [nonce, setNonce] = useState(0)
  const aliveRef = useRef(true)
  const reqIdRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    const reqId = ++reqIdRef.current
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    fetcher()
      .then((data) => {
        if (cancelled || !aliveRef.current || reqId !== reqIdRef.current) return
        if (cacheKey !== undefined) asyncCache.set(cacheKey, data)
        setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (cancelled || !aliveRef.current || reqId !== reqIdRef.current) return
        setState((s) => ({ data: s.data, loading: false, error: (e as Error).message }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, cacheKey])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  // 命中缓存时同步返回并免去加载态，使参数切换时的转场为「旧内容 → 新内容」而非「旧内容 → 骨架」
  const hasCached = cacheKey !== undefined && asyncCache.has(cacheKey)
  const cached = hasCached ? (asyncCache.get(cacheKey) as T) : null

  return {
    data: hasCached ? cached : state.data,
    loading: state.loading && !hasCached,
    error: state.error,
    reload,
  }
}
