export type CapturedAddressLocation = {
  address: string
  capturedAt: string | null
  latitude: number | null
  longitude: number | null
}

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

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

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
    ]) || formattedAddress
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
    return Promise.resolve()
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise
  }

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const loaderWindow = getGoogleMapsLoaderWindow()
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID)

    loaderWindow[GOOGLE_MAPS_CALLBACK_NAME] = () => {
      resolve()
      delete loaderWindow[GOOGLE_MAPS_CALLBACK_NAME]
    }

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(), { once: true })
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
      delete loaderWindow[GOOGLE_MAPS_CALLBACK_NAME]
      googleMapsScriptPromise = null
      reject()
    }

    document.head.appendChild(script)
  })

  return googleMapsScriptPromise
}

async function getGoogleGeocoder(apiKey: string) {
  if (googleGeocoderPromise) {
    return googleGeocoderPromise
  }

  googleGeocoderPromise = (async () => {
    await loadGoogleMapsScript(apiKey)

    const maps = getGoogleMapsLoaderWindow().google?.maps
    const geocodingLibrary = await maps?.importLibrary?.('geocoding')
    const Geocoder = geocodingLibrary?.Geocoder

    if (!Geocoder) {
      throw new Error('Google Maps Geocoder is unavailable')
    }

    return new Geocoder()
  })()

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
    return Promise.resolve<CapturedAddressLocation>(emptyCapturedAddressLocation)
  }

  return new Promise<CapturedAddressLocation>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          address: '',
          capturedAt: new Date(position.timestamp).toISOString(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      () => {
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

  if (!apiKey) {
    return ''
  }

  return enqueueGoogleGeocodingRequest(async () => {
    const geocoder = await getGoogleGeocoder(apiKey)
    const data = await geocoder.geocode({
      extraComputations: ['ADDRESS_DESCRIPTORS'],
      language: JAPANESE_LANGUAGE_CODE,
      location: {
        lat: latitude,
        lng: longitude,
      },
      region: JAPAN_COUNTRY_CODE,
    })
    const results = toGeocodeResults(data.results)
    const addressResult = selectBestAddressResult(results)

    if (!addressResult) {
      return ''
    }

    return formatCapturedAddress(
      addressResult,
      results,
      toAddressDescriptor(data.address_descriptor),
    )
  })
}

export async function captureCurrentAddressLocation() {
  const location = await getCurrentPositionOnce()

  if (location.latitude === null || location.longitude === null) {
    return location
  }

  try {
    const address = await reverseGeocodeWithGoogle(
      location.latitude,
      location.longitude,
    )

    return {
      ...location,
      address,
    }
  } catch {
    return location
  }
}
