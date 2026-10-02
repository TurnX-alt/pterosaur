import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./apps/web/src/test/setup.ts'],
    include: ['apps/*/src/**/*.{test,spec}.{ts,tsx}', 'packages/*/src/**/*.{test,spec}.ts'],
    css: false,
    restoreMocks: true,
  },
})