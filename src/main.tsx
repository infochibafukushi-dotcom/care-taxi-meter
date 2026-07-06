import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { appBuildVersion, logDiagnostic } from './utils/diagnostics'
import { unlockScreenOrientation } from './utils/screenOrientation'

const ASSET_CACHE_EPOCH_KEY = 'care-taxi-meter:asset-cache-epoch'

async function syncAssetCacheEpoch(): Promise<boolean> {
  if (!('caches' in window)) {
    return false
  }

  const epoch = appBuildVersion
  const storedEpoch = window.localStorage.getItem(ASSET_CACHE_EPOCH_KEY)

  if (storedEpoch === epoch) {
    return false
  }

  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  window.localStorage.setItem(ASSET_CACHE_EPOCH_KEY, epoch)

  if (storedEpoch !== null) {
    logDiagnostic('asset cache epoch changed, reloading', { storedEpoch, epoch })
    return true
  }

  return false
}

void unlockScreenOrientation()

void syncAssetCacheEpoch().then((shouldReload) => {
  if (shouldReload) {
    window.location.reload()
    return
  }

  startApp()
})

function startApp() {
  if ('serviceWorker' in navigator) {
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) {
        return
      }
      refreshing = true
      window.location.reload()
    })

    void navigator.serviceWorker.ready.then((registration) => {
      void registration.update()
    })
  }

  logDiagnostic('app boot', {
    buildVersion: appBuildVersion,
    href: window.location.href,
    serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
    serviceWorkerControllerState: navigator.serviceWorker?.controller?.state ?? null,
  })

  if ('caches' in window) {
    void caches.keys()
      .then((cacheNames) => {
        logDiagnostic('cache storage names', { cacheNames })
      })
      .catch((error: unknown) => {
        logDiagnostic('cache storage names error', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const updateSW = registerSW({
  immediate: true,
  onRegistered(registration) {
    logDiagnostic('service worker registered', {
      buildVersion: appBuildVersion,
      hasRegistration: Boolean(registration),
      activeState: registration?.active?.state ?? null,
      waitingState: registration?.waiting?.state ?? null,
      installingState: registration?.installing?.state ?? null,
      controller: Boolean(navigator.serviceWorker?.controller),
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
    })
  },
  onNeedRefresh() {
    logDiagnostic('service worker need refresh', {
      buildVersion: appBuildVersion,
      controller: Boolean(navigator.serviceWorker?.controller),
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
    })
    void updateSW(true).then(() => {
      window.location.reload()
    })
  },
  onOfflineReady() {
    logDiagnostic('service worker offline ready', {
      buildVersion: appBuildVersion,
      controller: Boolean(navigator.serviceWorker?.controller),
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
    })
  },
  onRegisterError(error) {
    logDiagnostic('service worker register error', {
      message: error instanceof Error ? error.message : String(error),
    })
  },
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
