import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仓库根 `.env` 的绝对路径。
 *
 * 本模块无论以源码（`apps/server/src/env.ts`）还是打包产物（`apps/server/dist/index.js`）
 * 运行，都位于仓库根的**下两级**，故 `../../../` 一致地指向仓库根。
 * CLI（`src/cli/login.ts`）也统一 import 本常量，避免各处相对层级不一致。
 *
 * 注：在 jsdom 测试环境下 `import.meta.url` 会被映射为 `http:` 协议，此时回退到进程 cwd
 * （测试从仓库根运行），保证单测可加载本模块。
 */
function resolveEnvPath(): string {
  const url = import.meta.url
  if (url.startsWith('file:')) return fileURLToPath(new URL('../../../.env', url))
  return resolve(process.cwd(), '.env')
}

export const ENV_PATH = resolveEnvPath()

/**
 * 加载 `.env` 到 `process.env`（若存在）。
 *
 * 用 Node 原生的 `process.loadEnvFile`，不引入 dotenv 依赖。文件缺失时该 API 会抛
 * `ENOENT`，故先 `existsSync` 兜底；解析失败也只告警、不阻断启动。
 */
export function loadEnv(path: string = ENV_PATH): void {
  if (!existsSync(path)) return
  try {
    process.loadEnvFile(path)
  } catch (e) {
    console.warn(`[pterosaur] 加载 .env 失败（${path}）：${(e as Error).message}`)
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 写入或更新 `.env` 中的一个键，**保留其余行与注释**（供 `pnpm log-in` 落盘凭证）。
 *
 * - 已存在同名键（允许 `KEY =` 与 `export KEY=` 形态）→ 就地替换该行；
 * - 不存在 → 末尾追加；
 * - 文件不存在 → 新建。
 *
 * 只读写目标文件，不触碰 `process.env`，便于测试与避免污染进程环境。
 */
export function upsertEnv(key: string, value: string, path: string = ENV_PATH): void {
  const line = `${key}=${value}`
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : []

  const re = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`)
  let replaced = false
  const out = lines.map((l) => {
    if (replaced || !re.test(l)) return l
    replaced = true
    return line
  })

  if (!replaced) {
    // 去掉末尾因 split 产生的空行，键之间留一个空行，再追加新键。
    while (out.length && out[out.length - 1] === '') out.pop()
    if (out.length) out.push('')
    out.push(line)
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${out.join('\n').replace(/\n*$/, '')}\n`, 'utf8')
}
