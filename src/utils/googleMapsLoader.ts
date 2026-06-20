const GOOGLE_MAPS_SCRIPT_URL = 'https://maps.googleapis.com/maps/api/js'
export const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-javascript-api'
const GOOGLE_MAPS_CALLBACK_NAME = '__careTaxiGoogleMapsReady'
const GOOGLE_MAPS_SCRIPT_LOAD_TIMEOUT_MS = 15000

type GoogleMapsLoaderWindow = Window & {
  __careTaxiGoogleMapsReady?: () => void
  google?: {
    maps?: {
      Map?: unknown
      importLibrary?: (libraryName: string) => Promise<unknown>
    }
  }
}

let googleMapsScriptPromise: Promise<void> | null = null

const getLoaderWindow = () => window as GoogleMapsLoaderWindow

export const isGoogleMapsApiLoaded = () => {
  const maps = getLoaderWindow().google?.maps
  return typeof maps?.Map === 'function' || typeof maps?.importLibrary === 'function'
}

export async function ensureGoogleMapsApiLoaded(apiKey: string): Promise<void> {
  if (!apiKey.trim()) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY is not set.')
  }

  if (isGoogleMapsApiLoaded()) {
    return
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise
  }

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const loaderWindow = getLoaderWindow()
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID)
    let timeoutId: number | null = null

    const finish = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      delete loaderWindow[GOOGLE_MAPS_CALLBACK_NAME]
    }

    const resolveLoad = () => {
      finish()
      resolve()
    }

    const rejectLoad = (error: Error) => {
      finish()
      googleMapsScriptPromise = null
      reject(error)
    }

    timeoutId = window.setTimeout(() => {
      rejectLoad(new Error('Google Maps JavaScript API load timed out.'))
    }, GOOGLE_MAPS_SCRIPT_LOAD_TIMEOUT_MS)

    loaderWindow[GOOGLE_MAPS_CALLBACK_NAME] = () => {
      resolveLoad()
    }

    if (existingScript) {
      existingScript.addEventListener('load', () => resolveLoad(), { once: true })
      existingScript.addEventListener(
        'error',
        () => rejectLoad(new Error('Google Maps JavaScript API script failed to load.')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    const url = new URL(GOOGLE_MAPS_SCRIPT_URL)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('language', 'ja')
    url.searchParams.set('region', 'JP')
    url.searchParams.set('v', 'weekly')
    url.searchParams.set('loading', 'async')
    url.searchParams.set('callback', GOOGLE_MAPS_CALLBACK_NAME)

    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = url.toString()
    script.onerror = () => {
      rejectLoad(new Error('Google Maps JavaScript API script network error occurred.'))
    }

    document.head.appendChild(script)
  })

  return googleMapsScriptPromise
}
