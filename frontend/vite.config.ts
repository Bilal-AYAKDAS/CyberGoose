import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron üretimde dist/index.html'i file:// ile yükler; göreli yollar gerekir.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5502',
      '/ws': {
        target: 'ws://127.0.0.1:5502',
        ws: true,
      },
    },
  },
})
