/**
 * `pnpm log-in` —— 服务端缺省凭证的获取入口。
 *
 * 直接在**终端**渲染二维码，用网易云音乐 App 扫码；成功后将会话 cookie 写入仓库根
 * `.env` 的 `NETEASE_COOKIE`，作为未登录访客的缺省凭证。
 *
 * 扫码状态由本进程统一轮询（每 1.5s），终端字样随「等待扫码 → 已扫码待确认 → 成功 / 过期」
 * 变化；二维码过期会自动换一张新码。只依赖 Node 内置 + 现有 `netease.ts` 与 `qrcode`。
 */
import QRCode from 'qrcode'
import { cookieHeaderFromSetCookies, loginStatus, qrCheck, qrKey, qrLoginUrl } from '../sources/netease.js'
import { ENV_PATH, upsertEnv } from '../env.js'

const TIMEOUT_MS = 5 * 60 * 1000
const POLL_MS = 1500

let currentKey = ''
let finished = false
let lastLogged = ''
let timeoutTimer: NodeJS.Timeout | undefined

/** 去重打印状态字样，避免每 1.5s 刷屏。 */
function logOnce(text: string): void {
  if (text === lastLogged) return
  lastLogged = text
  console.log(`[pterosaur] ${text}`)
}

/** 重置「二维码有效期」计时（每张新码各给一份窗口）。 */
function resetTimeout(): void {
  if (timeoutTimer) clearTimeout(timeoutTimer)
  timeoutTimer = setTimeout(() => {
    console.error('\n[pterosaur] 二维码已超时，请重新运行 pnpm log-in\n')
    shutdown(1)
  }, TIMEOUT_MS)
  timeoutTimer.unref()
}

/** 生成并打印一张二维码。 */
async function showQr(): Promise<void> {
  const key = await qrKey()
  if (!key) throw new Error('无法生成二维码 key')
  const url = await qrLoginUrl(key)
  if (!url) throw new Error('无法生成二维码内容')
  currentKey = key
  lastLogged = ''

  const art = await QRCode.toString(url, { type: 'terminal', small: true })
  console.log('\n[pterosaur] 用网易云音乐 App 扫描下方二维码，并在手机上确认：\n')
  console.log(art)
  resetTimeout()
}

/** 轮询一次扫码状态；803 落盘并退出，800 自动换码。 */
async function poll(): Promise<void> {
  if (finished) return

  let res: { code: number; cookies?: string[] }
  try {
    res = await qrCheck(currentKey)
  } catch {
    return // 上游抖动：保持现状，下次轮询再试
  }

  if (res.code === 803) {
    const cookie = cookieHeaderFromSetCookies(res.cookies)
    if (!cookie) {
      logOnce('登录成功但未取到会话 cookie，正在重试…')
      return
    }
    upsertEnv('NETEASE_COOKIE', cookie)
    upsertEnv('NETEASE_COOKIE_UPDATED_AT', new Date().toISOString())
    const st = await loginStatus(cookie)
    console.log(`\n[pterosaur] 登录成功：${st.nickname ?? '（未知）'}`)
    console.log(`[pterosaur] 凭证已写入 ${ENV_PATH}`)
    console.log('[pterosaur] 重启服务（pnpm dev / pnpm start）后对未登录访客生效。\n')
    shutdown(0)
    return
  }

  if (res.code === 800) {
    console.log('\n[pterosaur] 二维码已过期，自动换一张…')
    try {
      await showQr()
    } catch (e) {
      console.error(`\n[pterosaur] 刷新二维码失败：${(e as Error).message}\n`)
      shutdown(1)
    }
    return
  }

  logOnce(res.code === 802 ? '已扫码，请在手机上确认…' : '等待扫码…')
}

function shutdown(code: number): void {
  if (finished) return
  finished = true
  if (timeoutTimer) clearTimeout(timeoutTimer)
  // NeteaseCloudMusicApi 可能持有 keep-alive 句柄，确保进程真正退出。
  process.exit(code)
}

/** 解析 `--source=<源>`（默认 netease）。 */
function parseSource(): 'netease' | 'qq' {
  const args = process.argv.slice(2)
  const inline = args.find((a) => a.startsWith('--source='))
  const idx = args.indexOf('--source')
  const val = inline ? inline.split('=')[1] : idx >= 0 ? args[idx + 1] : undefined
  return val === 'qq' ? 'qq' : 'netease'
}

async function main(): Promise<void> {
  const source = parseSource()
  if (source !== 'netease') {
    // QQ 的二维码是上游直接返回的 PNG 图片，没有可渲染的「内容字符串」，终端无法出图。
    console.error('\n[pterosaur] QQ 音乐缺省凭证暂不支持命令行扫码（二维码为图片，无法在终端渲染）。')
    console.error('[pterosaur] 请在应用内「登录」处选择 QQ 音乐扫码；网易云缺省凭证请用 pnpm log-in。\n')
    shutdown(1)
    return
  }
  console.log('\n[pterosaur] 扫码登录缺省账号（供未登录访客播放 VIP 曲目）')
  await showQr()
  setInterval(() => void poll(), POLL_MS)
}

process.on('SIGINT', () => {
  console.log('\n[pterosaur] 已取消')
  shutdown(130)
})

main().catch((e: Error) => {
  console.error(`\n[pterosaur] 启动失败：${e.message}\n`)
  shutdown(1)
})
