import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow requests from nginx reverse proxy (any hostname).
    // Vite's default host check blocks non-localhost Host headers.
    allowedHosts: 'all',
    // Bind to all interfaces so the server is reachable by IP / hostname.
    host: '0.0.0.0',
    // Proxy /api/* to the FastAPI backend when running Vite directly
    // (i.e. http://host:5173). Not needed when accessed through nginx.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/docs': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/redoc': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
