import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const githubPagesBase = '/care-taxi-meter/'

// https://vite.dev/config/
export default defineConfig({
  base: githubPagesBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa.svg'],
      manifest: {
        name: '介護タクシー専用メーター',
        short_name: '介護タクシー',
        description: '介護タクシー専用メーターアプリのPWA初期設定',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: githubPagesBase,
        scope: githubPagesBase,
        icons: [
          {
            src: `${githubPagesBase}pwa.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: `${githubPagesBase}index.html`,
      },
    }),
  ],
})
