import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 4791,
    strictPort: true,
    // Run the API with COCKPIT_DEV=1 so it accepts requests through this proxy.
    proxy: { '/api': { target: 'http://127.0.0.1:4790', changeOrigin: true } },
  },
})
