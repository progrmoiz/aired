import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the signed-in dashboard into apps/web, which the Worker serves:
// apps/web/dashboard.html (GET /dashboard, after the Worker's sign-in check)
// and apps/web/dashboard-assets/* (hashed JS and CSS).
/**
 * Country flags for the Views page (components/source-icon.tsx): copy
 * country-flag-icons' 3x2 SVGs to dashboard-assets/flags/<CODE>.svg, so the
 * browser loads only the flags it shows, from this origin, and none of
 * them weigh on the bundle.
 */
function countryFlags(): Plugin {
  return {
    name: 'aired-country-flags',
    apply: 'build',
    closeBundle() {
      const from = fileURLToPath(new URL('./node_modules/country-flag-icons/3x2/', import.meta.url))
      const to = fileURLToPath(new URL('../web/dashboard-assets/flags/', import.meta.url))
      mkdirSync(to, { recursive: true })
      for (const f of readdirSync(from)) if (/^[A-Z]{2}\.svg$/.test(f)) cpSync(from + f, to + f)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), countryFlags()],
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
