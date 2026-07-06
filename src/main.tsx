import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { appBuildVersion, logDiagnostic } from './utils/diagnostics'
import { unlockScreenOrientation } from './utils/screenOrientation'

void unlockScreenOrientation()

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
    void updateSW(true)
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
