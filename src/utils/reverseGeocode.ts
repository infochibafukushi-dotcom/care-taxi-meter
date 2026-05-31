export type CapturedAddressLocation = {
  address: string
  capturedAt: string | null
  latitude: number | null
  longitude: number | null
}

type NominatimAddress = {
  city?: unknown
  county?: unknown
  house_number?: unknown
  neighbourhood?: unknown
  quarter?: unknown
  road?: unknown
  state?: unknown
  suburb?: unknown
  town?: unknown
  village?: unknown
}

type NominatimReverseResponse = {
  address?: unknown
}

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const NOMINATIM_REQUEST_INTERVAL_MS = 1100

export const emptyCapturedAddressLocation: CapturedAddressLocation = {
  address: '',
  capturedAt: null,
  latitude: null,
  longitude: null,
}

let lastNominatimRequestAt = 0
let nominatimRequestQueue: Promise<void> = Promise.resolve()

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const toAddressObject = (value: unknown): NominatimAddress =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as NominatimAddress)
    : {}

const toAddressPart = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

function joinUniqueAddressParts(parts: string[]) {
  return parts.reduce<string[]>((uniqueParts, part) => {
    if (!part || uniqueParts.includes(part)) {
      return uniqueParts
    }

    return [...uniqueParts, part]
  }, []).join('')
}

export function formatJapaneseAddressFromNominatimAddress(
  address: NominatimAddress,
) {
  const state = toAddressPart(address.state)
  const city = toAddressPart(address.city)
  const town = toAddressPart(address.town)
  const village = toAddressPart(address.village)
  const county = toAddressPart(address.county)
  const suburb = toAddressPart(address.suburb)
  const neighbourhood = toAddressPart(address.neighbourhood)
  const quarter = toAddressPart(address.quarter)
  const road = toAddressPart(address.road)
  const houseNumber = toAddressPart(address.house_number)

  return joinUniqueAddressParts([
    state,
    city || town || village || county,
    suburb,
    neighbourhood || quarter,
    road,
    houseNumber,
  ])
}

function enqueueNominatimRequest<T>(task: () => Promise<T>) {
  const nextRequest = nominatimRequestQueue.then(async () => {
    const elapsedMilliseconds = Date.now() - lastNominatimRequestAt

    if (elapsedMilliseconds < NOMINATIM_REQUEST_INTERVAL_MS) {
      await wait(NOMINATIM_REQUEST_INTERVAL_MS - elapsedMilliseconds)
    }

    lastNominatimRequestAt = Date.now()
    return task()
  })

  nominatimRequestQueue = nextRequest.then(
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

async function reverseGeocodeWithNominatim(latitude: number, longitude: number) {
  return enqueueNominatimRequest(async () => {
    const url = new URL(NOMINATIM_REVERSE_URL)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'ja')

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return ''
    }

    const data = (await response.json()) as NominatimReverseResponse
    return formatJapaneseAddressFromNominatimAddress(
      toAddressObject(data.address),
    )
  })
}

export async function captureCurrentAddressLocation() {
  const location = await getCurrentPositionOnce()

  if (location.latitude === null || location.longitude === null) {
    return location
  }

  try {
    const address = await reverseGeocodeWithNominatim(
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
