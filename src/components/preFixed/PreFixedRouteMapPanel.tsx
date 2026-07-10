import { useEffect, useRef, useState } from 'react'
import type { PreFixedRouteCandidate, RoutePoint } from '../../types/preFixedMeterSession'
import { ensureGoogleMapsApiLoaded, loadGoogleMapsPolylineDecoder } from '../../utils/googleMapsLoader'
import { decodePolylinePath, type LatLngLiteral } from '../../utils/polyline'

type GoogleMapsMap = {
  fitBounds: (bounds: unknown, padding?: number) => void
  setCenter: (center: LatLngLiteral) => void
  setZoom: (zoom: number) => void
}

type GoogleMapsMarker = {
  setMap: (map: GoogleMapsMap | null) => void
}

type GoogleMapsPolyline = {
  setMap: (map: GoogleMapsMap | null) => void
}

type GoogleMapsLatLngBounds = {
  extend: (point: LatLngLiteral) => void
}

type GoogleMapsNamespace = {
  LatLngBounds: new () => GoogleMapsLatLngBounds
  Map: new (
    element: HTMLElement,
    options: {
      center: LatLngLiteral
      fullscreenControl: boolean
      mapTypeControl: boolean
      streetViewControl: boolean
      zoom: number
    },
  ) => GoogleMapsMap
  Marker: new (options: {
    map: GoogleMapsMap
    position: LatLngLiteral
    label?: string | { text: string; color?: string }
    title?: string
    zIndex?: number
  }) => GoogleMapsMarker
  Polyline: new (options: {
    map: GoogleMapsMap
    path: LatLngLiteral[]
    strokeColor: string
    strokeOpacity: number
    strokeWeight: number
    zIndex?: number
  }) => GoogleMapsPolyline
}

const getGoogleMaps = () => {
  const maps = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google?.maps
  if (!maps?.Map || !maps.Polyline || !maps.LatLngBounds || !maps.Marker) {
    throw new Error('Google Maps API is unavailable.')
  }
  return maps
}

const MAP_LOAD_ERROR_MESSAGE =
  '地図を表示できませんでした。通信状況を確認して再読み込みしてください。'

const MAP_ROUTE_LINE_ERROR_MESSAGE =
  'ルート線を表示できませんでした。出発地と目的地を確認して、もう一度検索してください。'

export type RouteMapMarker = {
  point: RoutePoint
  role: 'pickup' | 'waypoint' | 'destination'
  label: string
}

export type PreFixedRouteMapPanelProps = {
  candidates: PreFixedRouteCandidate[]
  selectedRouteId: PreFixedRouteCandidate['id']
  markers?: RouteMapMarker[]
  isLoading?: boolean
  reloadToken?: number
  showSelectedRouteOnly?: boolean
}

export function buildRouteMapMarkers(
  pickup: RoutePoint,
  stops: RoutePoint[],
  destination: RoutePoint,
): RouteMapMarker[] {
  const result: RouteMapMarker[] = [
    { point: pickup, role: 'pickup', label: '発' },
    ...stops.map((point, index) => ({
      point,
      role: 'waypoint' as const,
      label: `${index + 1}`,
    })),
    { point: destination, role: 'destination', label: '着' },
  ]

  return result.filter((marker) => marker.point.lat != null && marker.point.lng != null)
}

const buildFallbackMarkersFromPath = (path: LatLngLiteral[]): RouteMapMarker[] => {
  if (path.length === 0) {
    return []
  }

  const pickupPoint = path[0]
  const destinationPoint = path[path.length - 1]

  return [
    {
      point: {
        label: '出発地',
        address: '',
        lat: pickupPoint.lat,
        lng: pickupPoint.lng,
        source: 'unknown',
      },
      role: 'pickup',
      label: '発',
    },
    {
      point: {
        label: '目的地',
        address: '',
        lat: destinationPoint.lat,
        lng: destinationPoint.lng,
        source: 'unknown',
      },
      role: 'destination',
      label: '着',
    },
  ]
}

export function PreFixedRouteMapPanel({
  candidates,
  selectedRouteId,
  markers = [],
  isLoading = false,
  reloadToken = 0,
  showSelectedRouteOnly = false,
}: PreFixedRouteMapPanelProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GoogleMapsMap | null>(null)
  const polylinesRef = useRef<GoogleMapsPolyline[]>([])
  const mapMarkersRef = useRef<GoogleMapsMarker[]>([])
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    polylinesRef.current.forEach((line) => line.setMap(null))
    polylinesRef.current = []
    mapMarkersRef.current.forEach((marker) => marker.setMap(null))
    mapMarkersRef.current = []

    if (isLoading || candidates.length === 0) {
      setMapError('')
      return undefined
    }

    let isMounted = true

    const renderMap = async () => {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
        if (!apiKey) {
          if (isMounted) {
            setMapError(MAP_LOAD_ERROR_MESSAGE)
          }
          return
        }

        await ensureGoogleMapsApiLoaded(apiKey)
        const googleDecode = await loadGoogleMapsPolylineDecoder(apiKey)
        if (!isMounted) {
          return
        }

        const mapElement = mapContainerRef.current
        if (!mapElement) {
          return
        }

        const maps = getGoogleMaps()
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

        const routesToDraw = showSelectedRouteOnly
          ? candidates.filter((candidate) => candidate.id === selectedRouteId)
          : candidates

        const selectedRoute = routesToDraw[0]
        const encoded = selectedRoute?.polyline?.trim() ?? ''
        const selectedPath = encoded ? decodePolylinePath(encoded, googleDecode) : []

        if (showSelectedRouteOnly && (!encoded || selectedPath.length === 0)) {
          if (isMounted) {
            setMapError(MAP_ROUTE_LINE_ERROR_MESSAGE)
          }
          return
        }

        const bounds = new maps.LatLngBounds()
        let hasBounds = false

        const markerSources =
          markers.length > 0 ? markers : buildFallbackMarkersFromPath(selectedPath)

        for (const marker of markerSources) {
          if (marker.point.lat == null || marker.point.lng == null) {
            continue
          }
          const position = { lat: marker.point.lat, lng: marker.point.lng }
          bounds.extend(position)
          hasBounds = true
          mapMarkersRef.current.push(
            new maps.Marker({
              map,
              position,
              label: marker.label,
              title:
                marker.role === 'pickup'
                  ? '出発地'
                  : marker.role === 'destination'
                    ? '目的地'
                    : `経由地${marker.label}`,
              zIndex: marker.role === 'pickup' ? 5 : marker.role === 'destination' ? 4 : 3,
            }),
          )
        }

        for (const candidate of routesToDraw) {
          const routeEncoded = candidate.polyline?.trim()
          if (!routeEncoded) {
            continue
          }

          const path = decodePolylinePath(routeEncoded, googleDecode)
          if (path.length === 0) {
            continue
          }

          path.forEach((point) => {
            bounds.extend(point)
            hasBounds = true
          })

          const isSelected = !showSelectedRouteOnly || candidate.id === selectedRouteId
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
          map.fitBounds(bounds, 48)
        }

        if (isMounted) {
          setMapError('')
        }
      } catch (error) {
        console.warn('Failed to render pre-fixed route map.', error)
        if (isMounted) {
          setMapError(MAP_LOAD_ERROR_MESSAGE)
        }
      }
    }

    void renderMap()

    return () => {
      isMounted = false
    }
  }, [candidates, selectedRouteId, markers, isLoading, reloadToken, showSelectedRouteOnly])

  return (
    <div className="pre-fixed-route-map-shell">
      <div
        ref={mapContainerRef}
        className={`pre-fixed-route-map-panel${isLoading ? ' is-loading' : ''}`}
        aria-label="ルート候補マップ"
        role="img"
      />
      {isLoading ? (
        <p className="save-note pre-fixed-route-map-status" role="status">
          ルートを検索しています…
        </p>
      ) : null}
      {mapError ? (
        <p className="case-error pre-fixed-route-map-status" role="alert">
          {mapError}
        </p>
      ) : null}
    </div>
  )
}
