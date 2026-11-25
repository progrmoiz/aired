import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the signed-in dashboard into apps/web, which the Worker serves:
// apps/web/dashboard.html (GET /dashboard, after the Worker's sign-in check)
// and apps/web/dashboard-assets/* (hashed JS and CSS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  publicDir: false,
  build: {
    outDir: '../web',
    emptyOutDir: false,
    assetsDir: 'dashboard-assets',
    // React, Base UI and TanStack Table come to ~180 kB gzipped in one file;
    // fine for a signed-in app page, so don't warn about it.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: fileURLToPath(new URL('./dashboard.html', import.meta.url)) },
  },
  server: {
    // `pnpm dev` here: API calls go to a local `wrangler dev` (port 8787).
    proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787', '/fonts': 'http://localhost:8787' },
  },
})
