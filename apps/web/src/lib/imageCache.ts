/**
 * 封面「已就绪」登记表。
 *
 * 存在意义：沉浸页封面在 View Transition 的**同步快照**里必须已经可见——若依赖 `onLoad`
 * 之后才 `opacity: 1`，快照拍到的会是 `.cover` 的占位底色（一个灰方块放大，正是"简陋"观感
 * 的来源）。而回调里又不能 `await`（rAF 会死锁，见 nowPlayingTransition.ts），所以改用一张
 * 「已解码 URL」表：`Cover` 首帧即按它决定是否直接显色。
 *
 * URL 被移除无需通知（同源封面 URL 稳定）；表按插入顺序限量淘汰。
 */

const ready = new Set<string>()
const MAX = 512

export function isCoverReady(src?: string): boolean {
  return !!src && ready.has(src)
}

export function markCoverReady(src?: string): void {
  if (!src) return
  ready.add(src)
  while (ready.size > MAX) {
    const oldest = ready.values().next().value
    if (oldest === undefined) break
    ready.delete(oldest)
  }
}

/** 预取并解码封面，就绪后登记（失败忽略）。幂等。 */
export function preloadCover(src?: string): void {
  if (!src) return
  const img = new Image()
  img.src = src
  img
    .decode()
    .then(() => markCoverReady(src))
    .catch(() => {
      /* 解码失败忽略；正式渲染会再走一次 <img> */
    })
}

/** 清空登记表（供测试 / 重置使用）。 */
export function clearCoverRegistry(): void {
  ready.clear()
}
