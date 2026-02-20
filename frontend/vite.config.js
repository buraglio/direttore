import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow requests from nginx reverse proxy (any hostname).
    // Vite's default host check blocks non-localhost Host headers,
    // causing an "Invalid Host header" error when proxied through nginx.
    allowedHosts: 'all',
    // Bind to all interfaces so the nginx proxy on the same box can reach it.
    // Default is 127.0.0.1, which works fine for same-host nginx deployments.
    host: '0.0.0.0',
  },
})
