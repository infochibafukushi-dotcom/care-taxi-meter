import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const githubPagesBase = '/care-taxi-meter/'
const appBasePath = githubPagesBase.replace(/\/$/, '')
const driverApiProxyPath = `${appBasePath}/api/driver`

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const reservationOrigin = env.RESERVATION_V4_ORIGIN?.trim()
  const meterDriverToken = env.METER_DRIVER_TOKEN?.trim()

  const reservationDriverProxy: ProxyOptions | undefined = reservationOrigin
    ? {
        target: reservationOrigin,
        changeOrigin: true,
        secure: true,
        rewrite: (path: string) =>
          path.startsWith(appBasePath) ? path.slice(appBasePath.length) || '/' : path,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (meterDriverToken) {
              proxyReq.setHeader('Authorization', `Bearer ${meterDriverToken}`)
            }
          })
        },
      }
    : undefined

  return {
  base: githubPagesBase,
  define: {
    'import.meta.env.VITE_APP_BUILD_VERSION': JSON.stringify(
      process.env.VITE_APP_BUILD_VERSION ?? new Date().toISOString(),
    ),
  },
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
  server: reservationDriverProxy
    ? {
        proxy: {
          [driverApiProxyPath]: reservationDriverProxy,
        },
      }
    : undefined,
  }
})
