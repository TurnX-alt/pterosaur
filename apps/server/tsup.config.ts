import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  outDir: 'dist',
  external: ['NeteaseCloudMusicApi', '@hono/node-server'],
  noExternal: ['@pterosaur/shared'],
})