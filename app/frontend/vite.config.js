import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy mirrors nginx.conf: /api -> backend service on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
