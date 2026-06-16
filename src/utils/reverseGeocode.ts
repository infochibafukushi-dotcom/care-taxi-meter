export type CapturedAddressLocation = {
  address: string
  capturedAt: string | null
  latitude: number | null
  longitude: number | null
}


export type ReverseGeocodeDiagnosticState = {
  address: string
  emptyAddressReason: string
  errorMessage: string
  formattedAddress: string
  geocodeCalled: boolean
  geocodeCallbackState: '未開始' | '開始' | '完了' | '失敗' | 'タイムアウト'
  geocoderState: '未確認' | '生成中' | '生成成功' | '生成失敗'
  geocodingExecutionState: '未実行' | '実行中' | '成功' | '失敗' | '0件' | '住所空' | 'タイムアウト'
  googleMapsApiLoadState: '未確認' | 'ロード中' | '成功' | '失敗'
  googleResponseJson: string
  lastUpdatedAt: string | null
  latitude: number | null
  longitude: number | null
  responseCount: number | null
  reverseGeocodeCalled: boolean
  selectedFormattedAddress: string
}

type ReverseGeocodeDiagnosticListener = (
  state: ReverseGeocodeDiagnosticState,
) => void

type GoogleGeocodeResult = {
  formatted_address?: unknown
  geometry?: unknown
  place_id?: unknown
}

type GoogleGeocodeResponse = {
  address_descriptor?: unknown
  results?: unknown
}

type GoogleMapsGeocoderRequest = {
  fulfillOnZeroResults?: boolean

  language?: string
  location: {
    lat: number
    lng: number
  }
  region?: string
}

type GoogleMapsGeocoderStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR'
  | 'ERROR'
  | string

type GoogleMapsGeocoderCallback = (
  results: GoogleGeocodeResult[] | null | undefined,
  status: GoogleMapsGeocoderStatus,
) => void

type GoogleMapsGeocoder = {
  geocode: (
    request: GoogleMapsGeocoderRequest,
    callback?: GoogleMapsGeocoderCallback,
  ) => Promise<GoogleGeocodeResponse> | void
}

type GoogleMapsGeocoderConstructor = new () => GoogleMapsGeocoder

type GoogleMapsGeocodingLibrary = {
  Geocoder?: GoogleMapsGeocoderConstructor
}

type GoogleMapsNamespace = {
  Geocoder?: GoogleMapsGeocoderConstructor
  importLibrary?: (libraryName: 'geocoding') => Promise<GoogleMapsGeocodingLibrary>
}

type GoogleMapsLoaderWindow = Window & {
  __careTaxiGoogleMapsReady?: () => void
  google?: {
    maps?: GoogleMapsNamespace
  }
}

const GOOGLE_MAPS_SCRIPT_URL = 'https://maps.googleapis.com/maps/api/js'
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-javascript-api'
const GOOGLE_MAPS_CALLBACK_NAME = '__careTaxiGoogleMapsReady'
const GOOGLE_GEOCODING_REQUEST_INTERVAL_MS = 100
const GOOGLE_MAPS_SCRIPT_LOAD_TIMEOUT_MS = 15000
const GOOGLE_GEOCODING_RESPONSE_TIMEOUT_MS = 15000
const GOOGLE_GEOCODING_CALLBACK_FALLBACK_DELAY_MS = 3000
const DIAGNOSTIC_LOG_PREFIX = '[住所取得診断]'
const JAPAN_COUNTRY_CODE = 'JP'
const JAPANESE_LANGUAGE_CODE = 'ja'

export const emptyCapturedAddressLocation: CapturedAddressLocation = {
  address: '',
  capturedAt: null,
  latitude: null,
  longitude: null,
}

let lastGoogleGeocodingRequestAt = 0
let googleGeocodingRequestQueue: Promise<void> = Promise.resolve()
let googleMapsScriptPromise: Promise<void> | null = null
let googleGeocoderPromise: Promise<GoogleMapsGeocoder> | null = null


const initialReverseGeocodeDiagnosticState: ReverseGeocodeDiagnosticState = {
  address: '',
  emptyAddressReason: '',
  errorMessage: '',
  formattedAddress: '',
  geocodeCalled: false,
  geocodeCallbackState: '未開始',
  geocoderState: '未確認',
  geocodingExecutionState: '未実行',
  googleMapsApiLoadState: '未確認',
  googleResponseJson: '',
  lastUpdatedAt: null,
  latitude: null,
  longitude: null,
  responseCount: null,
  reverseGeocodeCalled: false,
  selectedFormattedAddress: '',
}

let reverseGeocodeDiagnosticState = initialReverseGeocodeDiagnosticState
const reverseGeocodeDiagnosticListeners = new Set<ReverseGeocodeDiagnosticListener>()

export function getReverseGeocodeDiagnosticState() {
  return reverseGeocodeDiagnosticState
}

export function subscribeReverseGeocodeDiagnostic(
  listener: ReverseGeocodeDiagnosticListener,
) {
  reverseGeocodeDiagnosticListeners.add(listener)
  listener(reverseGeocodeDiagnosticState)

  return () => {
    reverseGeocodeDiagnosticListeners.delete(listener)
  }
}

function updateReverseGeocodeDiagnostic(
  nextState: Partial<ReverseGeocodeDiagnosticState>,
) {
  reverseGeocodeDiagnosticState = {
    ...reverseGeocodeDiagnosticState,
    ...nextState,
    lastUpdatedAt: new Date().toISOString(),
  }
  reverseGeocodeDiagnosticListeners.forEach((listener) => {
    listener(reverseGeocodeDiagnosticState)
  })
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const logReverseGeocodeInfo = (message: string, details?: unknown) => {
  console.log(`${DIAGNOSTIC_LOG_PREFIX} ${message}`, details ?? '')
}

const logReverseGeocodeWarning = (message: string, details?: unknown) => {
  console.warn(`${DIAGNOSTIC_LOG_PREFIX} ${message}`, details ?? '')
}

const logReverseGeocodeError = (message: string, details?: unknown) => {
  console.error(`${DIAGNOSTIC_LOG_PREFIX} ${message}`, details ?? '')
}

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isGoogleGeocodingTimeoutError = (error: unknown) =>
  /Google Geocoding .* timed out/i.test(toErrorMessage(error))

const isPromiseLike = <T>(value: unknown): value is PromiseLike<T> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function'

const toDiagnosticJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2).slice(0, 3000)
  } catch {
    return String(value)
  }
}

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const toStringValue = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const toGeocodeResults = (value: unknown): GoogleGeocodeResult[] =>
  Array.isArray(value)
    ? value.map((item) => toRecord(item) as GoogleGeocodeResult)
    : []

const getGoogleMapsLoaderWindow = () => window as GoogleMapsLoaderWindow

const hasGoogleMapsImportLibrary = () =>
  typeof getGoogleMapsLoaderWindow().google?.maps?.importLibrary === 'function'

export function normalizeGoogleFormattedAddress(formattedAddress: string) {
  return formattedAddress
    .replace(/^日本、?\s*/, '')
    .replace(/^〒\s*\d{3}-?\d{4}\s*/, '')
    .replace(/\s+/g, '')
    .trim()
}

export function formatJapaneseAddressFromGoogleGeocodeResult(
  result: GoogleGeocodeResult,
) {
  return normalizeGoogleFormattedAddress(toStringValue(result.formatted_address))
}

function selectBestAddressResult(results: GoogleGeocodeResult[]) {
  return results.find((result) =>
    Boolean(formatJapaneseAddressFromGoogleGeocodeResult(result)),
  )
}

function formatCapturedAddress(result: GoogleGeocodeResult) {
  return formatJapaneseAddressFromGoogleGeocodeResult(result)
}

function loadGoogleMapsScript(apiKey: string) {
  if (hasGoogleMapsImportLibrary()) {
    updateReverseGeocodeDiagnostic({ googleMapsApiLoadState: '成功' })
    logReverseGeocodeInfo('Google Maps JavaScript API is already loaded.')
    return Promise.resolve()
  }

  if (googleMapsScriptPromise) {
    logReverseGeocodeInfo('Google Maps JavaScript API load is already in progress.')
    return googleMapsScriptPromise
  }

  updateReverseGeocodeDiagnostic({ googleMapsApiLoadState: 'ロード中' })
  logReverseGeocodeInfo('Google Maps JavaScript API load started.', {
    hasApiKey: Boolean(apiKey),
    scriptId: GOOGLE_MAPS_SCRIPT_ID,
  })

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const loaderWindow = getGoogleMapsLoaderWindow()
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID)
    let timeoutId: number | null = null

    const finish = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      delete loaderWindow[GOOGLE_MAPS_CALLBACK_NAME]
    }

    const resolveLoad = (source: string) => {
      updateReverseGeocodeDiagnostic({ googleMapsApiLoadState: '成功' })
      logReverseGeocodeInfo('Google Maps JavaScript API load succeeded.', {
        hasImportLibrary: hasGoogleMapsImportLibrary(),
        source,
      })
      finish()
      resolve()
    }

    const rejectLoad = (error: Error) => {
      updateReverseGeocodeDiagnostic({
        errorMessage: error.message,
        googleMapsApiLoadState: '失敗',
      })
      logReverseGeocodeError('Google Maps JavaScript API load failed.', {
        hasImportLibrary: hasGoogleMapsImportLibrary(),
        message: error.message,
      })
      finish()
      googleMapsScriptPromise = null
      reject(error)
    }

    timeoutId = window.setTimeout(() => {
      rejectLoad(
        new Error(
          'Google Maps JavaScript API load timed out. API key / referrer restriction / Maps JavaScript API setting may be invalid.',
        ),
      )
    }, GOOGLE_MAPS_SCRIPT_LOAD_TIMEOUT_MS)

    loaderWindow[GOOGLE_MAPS_CALLBACK_NAME] = () => {
      resolveLoad('callback')
    }

    if (existingScript) {
      logReverseGeocodeInfo('Google Maps JavaScript API script tag already exists.')
      existingScript.addEventListener('load', () => resolveLoad('existing-script-load'), { once: true })
      existingScript.addEventListener(
        'error',
        () => rejectLoad(new Error('Existing Google Maps JavaScript API script failed to load.')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    const url = new URL(GOOGLE_MAPS_SCRIPT_URL)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('language', JAPANESE_LANGUAGE_CODE)
    url.searchParams.set('region', JAPAN_COUNTRY_CODE)
    url.searchParams.set('v', 'weekly')
    url.searchParams.set('loading', 'async')
    url.searchParams.set('callback', GOOGLE_MAPS_CALLBACK_NAME)

    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = url.toString()
    script.onerror = () => {
      rejectLoad(new Error('Google Maps JavaScript API script network/error event occurred.'))
    }

    document.head.appendChild(script)
  })

  return googleMapsScriptPromise
}

async function getGoogleGeocoder(apiKey: string) {
  if (googleGeocoderPromise) {
    logReverseGeocodeInfo('Google Maps Geocoder instance is already being prepared/reused.')
    return googleGeocoderPromise
  }

  updateReverseGeocodeDiagnostic({ geocoderState: '生成中' })

  googleGeocoderPromise = (async () => {
    await loadGoogleMapsScript(apiKey)

    const maps = getGoogleMapsLoaderWindow().google?.maps
    logReverseGeocodeInfo('Google Maps namespace checked.', {
      hasImportLibrary: typeof maps?.importLibrary === 'function',
    })

    const geocodingLibrary = await maps?.importLibrary?.('geocoding')
    const Geocoder = geocodingLibrary?.Geocoder || maps?.Geocoder

    logReverseGeocodeInfo('Google Maps geocoding library checked.', {
      hasDirectGeocoder: Boolean(maps?.Geocoder),
      hasGeocoder: Boolean(Geocoder),
      hasImportedGeocoder: Boolean(geocodingLibrary?.Geocoder),
    })

    if (!Geocoder) {
      updateReverseGeocodeDiagnostic({
        errorMessage: 'Google Maps Geocoder is unavailable',
        geocoderState: '生成失敗',
      })
      throw new Error('Google Maps Geocoder is unavailable')
    }

    updateReverseGeocodeDiagnostic({ geocoderState: '生成成功' })
    return new Geocoder()
  })().catch((error: unknown) => {
    updateReverseGeocodeDiagnostic({
      errorMessage: toErrorMessage(error),
      geocoderState: '生成失敗',
    })
    googleGeocoderPromise = null
    throw error
  })

  return googleGeocoderPromise
}

function enqueueGoogleGeocodingRequest<T>(task: () => Promise<T>) {
  const nextRequest = googleGeocodingRequestQueue.then(async () => {
    const elapsedMilliseconds = Date.now() - lastGoogleGeocodingRequestAt

    if (elapsedMilliseconds < GOOGLE_GEOCODING_REQUEST_INTERVAL_MS) {
      await wait(GOOGLE_GEOCODING_REQUEST_INTERVAL_MS - elapsedMilliseconds)
    }

    lastGoogleGeocodingRequestAt = Date.now()
    return task()
  })

  googleGeocodingRequestQueue = nextRequest.then(
    () => undefined,
    () => undefined,
  )

  return nextRequest
}

function getCurrentPositionOnce() {
  if (!('geolocation' in navigator)) {
    logReverseGeocodeWarning('Geolocation API is unavailable in this browser.')
    return Promise.resolve<CapturedAddressLocation>(emptyCapturedAddressLocation)
  }

  logReverseGeocodeInfo('GPS acquisition started for reverse geocoding.')

  return new Promise<CapturedAddressLocation>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          address: '',
          capturedAt: new Date(position.timestamp).toISOString(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }
        logReverseGeocodeInfo('GPS acquisition succeeded for reverse geocoding.', {
          accuracy: position.coords.accuracy,
          capturedAt: location.capturedAt,
          latitude: location.latitude,
          longitude: location.longitude,
        })
        resolve(location)
      },
      (error) => {
        logReverseGeocodeError('GPS acquisition failed for reverse geocoding.', {
          code: error.code,
          message: error.message,
        })
        resolve(emptyCapturedAddressLocation)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    )
  })
}

function runGoogleGeocodeWithTimeout(
  geocoder: GoogleMapsGeocoder,
  request: GoogleMapsGeocoderRequest,
) {
  logReverseGeocodeInfo('Google Geocoding promise request started.', request)
  updateReverseGeocodeDiagnostic({
    geocodeCallbackState: '開始',
    geocodingExecutionState: '実行中',
  })

  return new Promise<GoogleGeocodeResponse>((resolve, reject) => {
    let callbackFallbackTimeoutId: number | null = null
    let isCallbackFallbackStarted = false
    let isSettled = false
    const clearCallbackFallbackTimeout = () => {
      if (callbackFallbackTimeoutId !== null) {
        window.clearTimeout(callbackFallbackTimeoutId)
        callbackFallbackTimeoutId = null
      }
    }
    const timeoutId = window.setTimeout(() => {
      if (isSettled) {
        return
      }

      isSettled = true
      clearCallbackFallbackTimeout()
      const error = new Error(
        `Google Geocoding response timed out after ${GOOGLE_GEOCODING_RESPONSE_TIMEOUT_MS}ms.`,
      )

      updateReverseGeocodeDiagnostic({
        emptyAddressReason: 'geocoder.geocode(): Promise/callbackが15秒以内に完了せずタイムアウト',
        errorMessage: error.message,
        geocodeCallbackState: 'タイムアウト',
        geocodingExecutionState: 'タイムアウト',
      })
      logReverseGeocodeError('Google Geocoding response timed out.', {
        message: error.message,
        request,
      })
      reject(error)
    }, GOOGLE_GEOCODING_RESPONSE_TIMEOUT_MS)

    const settleWithResponse = (
      response: GoogleGeocodeResponse,
      source: 'promise' | 'callback',
      status?: GoogleMapsGeocoderStatus,
    ) => {
      if (isSettled) {
        return
      }

      isSettled = true
      window.clearTimeout(timeoutId)
      clearCallbackFallbackTimeout()
      const normalizedResults = toGeocodeResults(response.results)

      logReverseGeocodeInfo('Google Geocoding response completed.', {
        resultCount: normalizedResults.length,
        source,
        status,
      })

      updateReverseGeocodeDiagnostic({
        geocodeCallbackState: '完了',
        googleResponseJson: toDiagnosticJson({
          ...response,
          results: normalizedResults,
          source,
          status,
        }),
        responseCount: normalizedResults.length,
      })
      resolve({ ...response, results: normalizedResults })
    }

    const settleWithError = (error: unknown, source: 'promise' | 'callback' | 'call') => {
      if (isSettled) {
        return
      }

      isSettled = true
      window.clearTimeout(timeoutId)
      clearCallbackFallbackTimeout()
      updateReverseGeocodeDiagnostic({
        errorMessage: toErrorMessage(error),
        geocodeCallbackState: '失敗',
        geocodingExecutionState: '失敗',
      })
      logReverseGeocodeError('Google Geocoding request failed.', {
        message: toErrorMessage(error),
        rawError: error,
        source,
      })
      reject(error)
    }

    const runCallbackGeocode = () => {
      if (isSettled || isCallbackFallbackStarted) {
        return
      }

      isCallbackFallbackStarted = true
      clearCallbackFallbackTimeout()
      logReverseGeocodeInfo('Google Geocoding callback fallback started.', request)

      const callback: GoogleMapsGeocoderCallback = (results, status) => {
        console.log(`${DIAGNOSTIC_LOG_PREFIX} Google Geocoding callback invoked.`, {
          isSettled,
          resultCount: toGeocodeResults(results).length,
          status,
        })

        if (isSettled) {
          return
        }

        const normalizedResults = toGeocodeResults(results)

        if (status !== 'OK' && status !== 'ZERO_RESULTS') {
          updateReverseGeocodeDiagnostic({
            googleResponseJson: toDiagnosticJson({ results: normalizedResults, status }),
            responseCount: normalizedResults.length,
          })
          settleWithError(
            new Error(`Google Geocoding callback failed with status: ${status}`),
            'callback',
          )
          return
        }

        settleWithResponse({ results: normalizedResults }, 'callback', status)
      }

      try {
        geocoder.geocode(request, callback)
      } catch (error) {
        settleWithError(error, 'callback')
      }
    }

    try {
      const geocodePromise = geocoder.geocode(request)

      if (isPromiseLike<GoogleGeocodeResponse>(geocodePromise)) {
        callbackFallbackTimeoutId = window.setTimeout(() => {
          logReverseGeocodeWarning('Google Geocoding promise is slow; starting callback fallback.', {
            fallbackDelayMs: GOOGLE_GEOCODING_CALLBACK_FALLBACK_DELAY_MS,
            request,
          })
          runCallbackGeocode()
        }, GOOGLE_GEOCODING_CALLBACK_FALLBACK_DELAY_MS)

        void geocodePromise.then(
          (response) => {
            settleWithResponse(response, 'promise')
          },
          (error: unknown) => {
            if (isCallbackFallbackStarted && !isSettled) {
              logReverseGeocodeWarning(
                'Google Geocoding promise failed after callback fallback started; waiting for callback.',
                {
                  message: toErrorMessage(error),
                },
              )
              return
            }

            settleWithError(error, 'promise')
          },
        )
        return
      }

      runCallbackGeocode()
    } catch (error) {
      settleWithError(error, 'call')
    }
  })
}

async function reverseGeocodeWithGoogle(
  latitude: number,
  longitude: number,
): Promise<string> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

  updateReverseGeocodeDiagnostic({
    address: '',
    emptyAddressReason: '',
    errorMessage: '',
    formattedAddress: '',
    geocodeCalled: false,
    geocodeCallbackState: '未開始',
    geocodingExecutionState: '未実行',
    latitude,
    longitude,
    googleResponseJson: '',
    responseCount: null,
    reverseGeocodeCalled: true,
    selectedFormattedAddress: '',
  })

  logReverseGeocodeInfo('reverseGeocodeWithGoogle called.', {
    hasApiKey: Boolean(apiKey),
    latitude,
    longitude,
  })

  if (!apiKey) {
    updateReverseGeocodeDiagnostic({
      emptyAddressReason: 'reverseGeocodeWithGoogle(): APIキー未設定のため空文字を返却',
      errorMessage: 'VITE_GOOGLE_MAPS_API_KEY is not set.',
      geocodingExecutionState: '失敗',
    })
    logReverseGeocodeWarning(
      'VITE_GOOGLE_MAPS_API_KEY is not set. Reverse geocoding will be skipped.',
    )
    return ''
  }

  return enqueueGoogleGeocodingRequest(async () => {
    try {
      const geocoder = await getGoogleGeocoder(apiKey)
      const request: GoogleMapsGeocoderRequest = {
        fulfillOnZeroResults: true,
        language: JAPANESE_LANGUAGE_CODE,
        location: {
          lat: latitude,
          lng: longitude,
        },
        region: JAPAN_COUNTRY_CODE.toLowerCase(),
      }

      updateReverseGeocodeDiagnostic({
        geocodeCalled: true,
        geocodingExecutionState: '実行中',
      })
      logReverseGeocodeInfo('Google Geocoding request started.', request)

      const data = await runGoogleGeocodeWithTimeout(geocoder, request)
      const results = toGeocodeResults(data.results)
      const addressResult = selectBestAddressResult(results)

      const selectedFormattedAddress = toStringValue(addressResult?.formatted_address)

      updateReverseGeocodeDiagnostic({
        formattedAddress: selectedFormattedAddress,
        googleResponseJson: toDiagnosticJson(data),
        responseCount: results.length,
        selectedFormattedAddress,
      })

      logReverseGeocodeInfo('Google Geocoding response received.', {
        hasAddressDescriptor: Boolean(data.address_descriptor),
        resultCount: results.length,
        selectedFormattedAddress,
      })

      if (!addressResult) {
        updateReverseGeocodeDiagnostic({
          emptyAddressReason: 'reverseGeocodeWithGoogle(): Googleレスポンス0件のため空文字を返却',
          errorMessage: 'Google Geocoding returned no address results.',
          geocodingExecutionState: '0件',
        })
        logReverseGeocodeWarning('Google Geocoding returned no address results.', data)
        return ''
      }

      const address = formatCapturedAddress(addressResult)

      if (!address) {
        updateReverseGeocodeDiagnostic({
          emptyAddressReason: 'reverseGeocodeWithGoogle(): formatCapturedAddress() が空文字を返却',
          errorMessage: 'Google Geocoding result formatting produced an empty address.',
          geocodingExecutionState: '住所空',
        })
        logReverseGeocodeWarning('Google Geocoding result formatting produced an empty address.', {
          formattedAddress: addressResult.formatted_address,
        })
        return ''
      }

      updateReverseGeocodeDiagnostic({
        address,
        emptyAddressReason: '',
        geocodingExecutionState: '成功',
      })

      logReverseGeocodeInfo('Address formatted from Google Geocoding response.', {
        address,
      })

      return address
    } catch (error) {
      updateReverseGeocodeDiagnostic({
        emptyAddressReason: isGoogleGeocodingTimeoutError(error)
          ? 'reverseGeocodeWithGoogle(): Geocodingタイムアウトのため住所未取得'
          : 'reverseGeocodeWithGoogle(): Geocoding例外発生のため住所未取得',
        errorMessage: toErrorMessage(error),
        geocodingExecutionState: isGoogleGeocodingTimeoutError(error) ? 'タイムアウト' : '失敗',
      })
      logReverseGeocodeError('Google Geocoding failed.', {
        message: toErrorMessage(error),
        rawError: error,
      })
      throw error
    }
  })
}

export async function captureAddressLocationFromCoordinates({
  capturedAt = new Date().toISOString(),
  latitude,
  longitude,
}: {
  capturedAt?: string | null
  latitude: number
  longitude: number
}): Promise<CapturedAddressLocation> {
  const location: CapturedAddressLocation = {
    address: '',
    capturedAt,
    latitude,
    longitude,
  }

  logReverseGeocodeInfo('Reverse geocoding started from provided GPS coordinates.', {
    capturedAt: location.capturedAt,
    latitude: location.latitude,
    longitude: location.longitude,
  })

  try {
    const address: string = await reverseGeocodeWithGoogle(latitude, longitude)
    const capturedLocation: CapturedAddressLocation = {
      ...location,
      address,
    }

    logReverseGeocodeInfo('Address capture completed.', {
      hasAddress: Boolean(address),
      location: capturedLocation,
    })

    if (!address) {
      updateReverseGeocodeDiagnostic({
        emptyAddressReason:
          reverseGeocodeDiagnosticState.emptyAddressReason ||
          'captureAddressLocationFromCoordinates(): 逆ジオコーディング結果が空文字',
      })
      logReverseGeocodeWarning('Address capture completed with an empty address.', capturedLocation)
    }

    return capturedLocation
  } catch (error) {
    logReverseGeocodeError('Address capture failed; returning GPS-only location.', {
      location,
      message: toErrorMessage(error),
    })
    return location
  }
}

export async function captureCurrentAddressLocation() {
  const location = await getCurrentPositionOnce()
  const { latitude, longitude } = location

  if (latitude === null || longitude === null) {
    logReverseGeocodeWarning('Reverse geocoding skipped because latitude/longitude is empty.', location)
    return location
  }

  return captureAddressLocationFromCoordinates({
    capturedAt: location.capturedAt,
    latitude,
    longitude,
  })
}
