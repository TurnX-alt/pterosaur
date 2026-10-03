import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端 API 端口（Hono / @hono/node-server）
const API_PORT = process.env.API_PORT ?? '8788'
const API_TARGET = process.env.API_TARGET ?? `http://127.0.0.1:${API_PORT}`

/**
 * 构建期取当前 commit 的短哈希（前 7 位），注入为全局常量 `__COMMIT_HASH__`。
 * 非 git 环境（如从归档构建）回退为 `dev`。
 */
function commitHash(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    proxy: {
      // 开发期把 /api 与音频代理请求转发到 Hono 后端，
      // 从而规避浏览器直连网易云的 CORS 与 http 混合内容问题。
      '/api': { target: API_TARGET, changeOrigin: true },
      '/stream': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: '../server/dist/client',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
