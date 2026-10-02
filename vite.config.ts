import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端 API 端口（Hono / @hono/node-server）
const API_PORT = process.env.API_PORT ?? '8788'
const API_TARGET = process.env.API_TARGET ?? `http://127.0.0.1:${API_PORT}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // 开发期把 /api 与音频代理请求转发到 Hono 后端，
      // 从而规避浏览器直连网易云的 CORS 与 http 混合内容问题。
      '/api': { target: API_TARGET, changeOrigin: true },
      '/stream': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
})
