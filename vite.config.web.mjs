import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const browserPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src https://api.openai.com",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig({
  root: fileURLToPath(new URL('./web/', import.meta.url)),
  base: '/image-prompt-lab/',
  plugins: [
    react(),
    {
      name: 'prompt-lab-browser-policy',
      apply: 'build',
      transformIndexHtml: () => [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: browserPolicy },
        injectTo: 'head-prepend',
      }],
    },
  ],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist-web/', import.meta.url)),
    emptyOutDir: true,
  },
})
