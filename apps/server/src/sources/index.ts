import type { MusicSource } from '@pterosaur/shared/types'
import { neteaseAdapter } from './netease.js'
import { qqAdapter } from './qq.js'
import type { SourceAdapter } from './types.js'

export type { SourceAdapter, QrCheckResult } from './types.js'

/**
 * 已注册的音源适配器。
 *
 * 用 `Partial` 而非 `Record`：允许「能力尚未就绪的源」暂不注册，
 * 路由层遇到未注册的源时回 404（而非崩溃），便于分阶段上线。
 */
export const sources: Partial<Record<MusicSource, SourceAdapter>> = {
  netease: neteaseAdapter,
  qq: qqAdapter,
}

/** 取某源适配器；未注册返回 undefined。 */
export function adapterOf(source: MusicSource): SourceAdapter | undefined {
  return sources[source]
}
