import { useCallback, useEffect, useRef, useState } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * 通用异步数据钩子。
 *
 * @param fetcher 返回 Promise 的取数函数
 * @param deps 依赖数组，变化时自动重新取数（与 useEffect 一致）
 * @param initial 初始数据（用于缓存命中或乐观渲染）
 *
 * 组件卸载后不会再 setState，避免 React 警告；重复请求以「最后一次」为准。
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  initial: T | null = null,
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
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, reload }
}
