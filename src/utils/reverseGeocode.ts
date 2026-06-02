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
  geocoderState: '未確認' | '生成中' | '生成成功' | '生成失敗'
  geocodingExecutionState: '未実行' | '実行中' | '成功' | '失敗' | '0件' | '住所空'
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

type GoogleAddressComponent = {
  long_name?: unknown
  short_name?: unknown
  types?: unknown
}

type GoogleGeocodeResult = {
  address_components?: unknown
  formatted_address?: unknown
  geometry?: unknown
  place_id?: unknown
  types?: unknown
}

type GoogleAddressDescriptorLandmark = {
  display_name?: unknown
  types?: unknown
}

type GoogleAddressDescriptor = {
  landmarks?: unknown
}

type GoogleGeocodeResponse = {
  address_descriptor?: unknown
  results?: unknown
}

type GoogleMapsGeocoderRequest = {
  extraComputations?: string[]
  language?: string
  location: {
    lat: number
    lng: number
  }
  region?: string
}

type GoogleMapsGeocoder = {
  geocode: (
    request: GoogleMapsGeocoderRequest,
  ) => Promise<GoogleGeocodeResponse>
}

type GoogleMapsGeocoderConstructor = new () => GoogleMapsGeocoder

type GoogleMapsGeocodingLibrary = {
  Geocoder?: GoogleMapsGeocoderConstructor
}

type GoogleMapsNamespace = {
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

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const toAddressComponents = (value: unknown): GoogleAddressComponent[] =>
  Array.isArray(value)
    ? value.map((item) => toRecord(item) as GoogleAddressComponent)
    : []

const toGeocodeResults = (value: unknown): GoogleGeocodeResult[] =>
  Array.isArray(value)
    ? value.map((item) => toRecord(item) as GoogleGeocodeResult)
    : []

const toAddressDescriptorLandmarks = (
  value: unknown,
): GoogleAddressDescriptorLandmark[] =>
  Array.isArray(value)
    ? value.map((item) => toRecord(item) as GoogleAddressDescriptorLandmark)
    : []

const toAddressDescriptor = (value: unknown): GoogleAddressDescriptor =>
  toRecord(value) as GoogleAddressDescriptor

const getGoogleMapsLoaderWindow = () => window as GoogleMapsLoaderWindow

const hasGoogleMapsImportLibrary = () =>
  typeof getGoogleMapsLoaderWindow().google?.maps?.importLibrary === 'function'

function joinUniqueAddressParts(parts: string[]) {
  return parts.reduce<string[]>((uniqueParts, part) => {
    if (!part || uniqueParts.includes(part)) {
      return uniqueParts
    }

    return [...uniqueParts, part]
  }, []).join('')
}

function findAddressComponent(
  components: GoogleAddressComponent[],
  componentType: string,
) {
  return components.find((component) =>
    toStringArray(component.types).includes(componentType),
  )
}

function getAddressComponentLongName(
  components: GoogleAddressComponent[],
  componentType: string,
) {
  return toStringValue(findAddressComponent(components, componentType)?.long_name)
}

function normalizeJapaneseAddress(address: string) {
  return address
    .replace(/^日本、?\s*/, '')
    .replace(/^〒\d{3}-?\d{4}\s*/, '')
    .replace(/\s+/g, '')
    .trim()
}

export function formatJapaneseAddressFromGoogleGeocodeResult(
  result: GoogleGeocodeResult,
) {
  const components = toAddressComponents(result.address_components)
  const administrativeAreaLevel1 = getAddressComponentLongName(
    components,
    'administrative_area_level_1',
  )
  const locality = getAddressComponentLongName(components, 'locality')
  const sublocalityLevel1 = getAddressComponentLongName(
    components,
    'sublocality_level_1',
  )
  const sublocalityLevel2 = getAddressComponentLongName(
    components,
    'sublocality_level_2',
  )
  const sublocalityLevel3 = getAddressComponentLongName(
    components,
    'sublocality_level_3',
  )
  const sublocalityLevel4 = getAddressComponentLongName(
    components,
    'sublocality_level_4',
  )
  const route = getAddressComponentLongName(components, 'route')
  const premise = getAddressComponentLongName(components, 'premise')
  const streetNumber = getAddressComponentLongName(components, 'street_number')
  const formattedAddress = normalizeJapaneseAddress(
    toStringValue(result.formatted_address),
  )

  return (
    formattedAddress ||
    joinUniqueAddressParts([
      administrativeAreaLevel1,
      locality,
      sublocalityLevel1,
      sublocalityLevel2,
      sublocalityLevel3,
      sublocalityLevel4,
      route,
      premise,
      streetNumber,
    ])
  )
}

function getResultPriority(result: GoogleGeocodeResult) {
  const types = toStringArray(result.types)

  if (types.includes('street_address')) {
    return 0
  }

  if (types.includes('premise')) {
    return 1
  }

  if (types.includes('subpremise')) {
    return 2
  }

  if (types.includes('establishment') || types.includes('point_of_interest')) {
    return 3
  }

  if (types.includes('route')) {
    return 4
  }

  return 5
}

function selectBestAddressResult(results: GoogleGeocodeResult[]) {
  return [...results].sort(
    (firstResult, secondResult) =>
      getResultPriority(firstResult) - getResultPriority(secondResult),
  )[0]
}

function toDisplayNameText(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }

  const source = toRecord(value)
  return toStringValue(source.text)
}

function getFacilityNameFromResult(result: GoogleGeocodeResult) {
  const types = toStringArray(result.types)
  const isFacilityResult =
    types.includes('establishment') ||
    types.includes('point_of_interest') ||
    types.includes('hospital') ||
    types.includes('health') ||
    types.includes('premise')

  if (!isFacilityResult) {
    return ''
  }

  const components = toAddressComponents(result.address_components)
  return (
    getAddressComponentLongName(components, 'establishment') ||
    getAddressComponentLongName(components, 'point_of_interest') ||
    getAddressComponentLongName(components, 'premise')
  )
}

function getFacilityNameFromAddressDescriptor(
  descriptor: GoogleAddressDescriptor,
) {
  const landmark = toAddressDescriptorLandmarks(descriptor.landmarks).find(
    (candidate) => {
      const displayName = toDisplayNameText(candidate.display_name)
      const types = toStringArray(candidate.types)

      return (
        displayName &&
        (types.includes('establishment') ||
          types.includes('point_of_interest') ||
          types.includes('hospital') ||
          types.includes('health'))
      )
    },
  )

  return toDisplayNameText(landmark?.display_name)
}

function getFacilityNameFromResults(results: GoogleGeocodeResult[]) {
  return results.reduce((facilityName, result) => {
    if (facilityName) {
      return facilityName
    }

    return getFacilityNameFromResult(result)
  }, '')
}

function formatCapturedAddress(
  result: GoogleGeocodeResult,
  results: GoogleGeocodeResult[],
  addressDescriptor: GoogleAddressDescriptor,
) {
  const address = formatJapaneseAddressFromGoogleGeocodeResult(result)
  const facilityName =
    getFacilityNameFromResults(results) ||
    getFacilityNameFromAddressDescriptor(addressDescriptor)

  if (!facilityName || facilityName === address) {
    return address
  }

  return [facilityName, address].filter(Boolean).join('\n')
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
    const Geocoder = geocodingLibrary?.Geocoder

    logReverseGeocodeInfo('Google Maps geocoding library checked.', {
      hasGeocoder: Boolean(Geocoder),
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

async function reverseGeocodeWithGoogle(latitude: number, longitude: number) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

  updateReverseGeocodeDiagnostic({
    address: '',
    emptyAddressReason: '',
    errorMessage: '',
    formattedAddress: '',
    geocodeCalled: false,
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
      const request = {
        extraComputations: ['ADDRESS_DESCRIPTORS'],
        language: JAPANESE_LANGUAGE_CODE,
        location: {
          lat: latitude,
          lng: longitude,
        },
        region: JAPAN_COUNTRY_CODE,
      }

      updateReverseGeocodeDiagnostic({
        geocodeCalled: true,
        geocodingExecutionState: '実行中',
      })
      logReverseGeocodeInfo('Google Geocoding request started.', request)

      const data = await geocoder.geocode(request)
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
        selectedTypes: toStringArray(addressResult?.types),
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

      const address = formatCapturedAddress(
        addressResult,
        results,
        toAddressDescriptor(data.address_descriptor),
      )

      if (!address) {
        updateReverseGeocodeDiagnostic({
          emptyAddressReason: 'reverseGeocodeWithGoogle(): formatCapturedAddress() が空文字を返却',
          errorMessage: 'Google Geocoding result formatting produced an empty address.',
          geocodingExecutionState: '住所空',
        })
        logReverseGeocodeWarning('Google Geocoding result formatting produced an empty address.', {
          formattedAddress: addressResult.formatted_address,
          resultTypes: addressResult.types,
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
        emptyAddressReason: 'reverseGeocodeWithGoogle(): Geocoding例外発生のため住所未取得',
        errorMessage: toErrorMessage(error),
        geocodingExecutionState: '失敗',
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
}) {
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
    const address = await reverseGeocodeWithGoogle(latitude, longitude)
    const capturedLocation = {
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
