import { useEffect, useRef } from 'react'
import type { PreFixedRouteCandidate } from '../../types/preFixedMeterSession'
import { ensureGoogleMapsApiLoaded } from '../../utils/googleMapsLoader'

type LatLng = {
  lat: number
  lng: number
}

type GoogleMapsMap = {
  fitBounds: (bounds: unknown) => void
  setCenter: (center: LatLng) => void
  setZoom: (zoom: number) => void
}

type GoogleMapsPolyline = {
  setMap: (map: GoogleMapsMap | null) => void
}

type GoogleMapsLatLngBounds = {
  extend: (point: LatLng) => void
}

type GoogleMapsNamespace = {
  LatLngBounds: new () => GoogleMapsLatLngBounds
  Map: new (
    element: HTMLElement,
    options: {
      center: LatLng
      fullscreenControl: boolean
      mapTypeControl: boolean
      streetViewControl: boolean
      zoom: number
    },
  ) => GoogleMapsMap
  Polyline: new (options: {
    map: GoogleMapsMap
    path: LatLng[]
    strokeColor: string
    strokeOpacity: number
    strokeWeight: number
    zIndex?: number
  }) => GoogleMapsPolyline
  geometry?: {
    encoding?: {
      decodePath: (encoded: string) => LatLng[]
    }
  }
}

const getGoogleMaps = () => {
  const maps = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google?.maps
  if (!maps?.Map || !maps.Polyline || !maps.LatLngBounds) {
    throw new Error('Google Maps API is unavailable.')
  }
  return maps
}

const decodePolyline = (encoded: string): LatLng[] => {
  const maps = getGoogleMaps()
  if (maps.geometry?.encoding?.decodePath) {
    return maps.geometry.encoding.decodePath(encoded)
  }
  return []
}

type PreFixedRouteMapPanelProps = {
  candidates: PreFixedRouteCandidate[]
  selectedRouteId: PreFixedRouteCandidate['id']
}

export function PreFixedRouteMapPanel({
  candidates,
  selectedRouteId,
}: PreFixedRouteMapPanelProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GoogleMapsMap | null>(null)
  const polylinesRef = useRef<GoogleMapsPolyline[]>([])

  useEffect(() => {
    if (candidates.length === 0) {
      return undefined
    }

    let isMounted = true

    const renderMap = async () => {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
        if (!apiKey) {
          return
        }

        await ensureGoogleMapsApiLoaded(apiKey)
        if (!isMounted) {
          return
        }

        const mapElement = mapContainerRef.current
        if (!mapElement) {
          return
        }

        const maps = getGoogleMaps()
        polylinesRef.current.forEach((line) => line.setMap(null))
        polylinesRef.current = []

        const map =
          mapRef.current ??
          new maps.Map(mapElement, {
            center: { lat: 35.6812, lng: 139.7671 },
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          })
        mapRef.current = map

        const bounds = new maps.LatLngBounds()
        let hasBounds = false

        for (const candidate of candidates) {
          const encoded = candidate.polyline?.trim()
          if (!encoded) {
            continue
          }

          const path = decodePolyline(encoded)
          if (path.length === 0) {
            continue
          }

          path.forEach((point) => {
            bounds.extend(point)
            hasBounds = true
          })

          const isSelected = candidate.id === selectedRouteId
          polylinesRef.current.push(
            new maps.Polyline({
              map,
              path,
              strokeColor: isSelected ? '#2563eb' : '#94a3b8',
              strokeOpacity: isSelected ? 0.95 : 0.45,
              strokeWeight: isSelected ? 6 : 4,
              zIndex: isSelected ? 2 : 1,
            }),
          )
        }

        if (hasBounds) {
          map.fitBounds(bounds)
        }
      } catch (error) {
        console.warn('Failed to render pre-fixed route map.', error)
      }
    }

    void renderMap()

    return () => {
      isMounted = false
    }
  }, [candidates, selectedRouteId])

  return (
    <div
      ref={mapContainerRef}
      className="pre-fixed-route-map-panel"
      aria-label="ルート候補マップ"
      role="img"
    />
  )
}
