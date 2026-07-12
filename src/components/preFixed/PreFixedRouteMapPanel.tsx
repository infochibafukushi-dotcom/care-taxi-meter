import { useEffect, useRef } from 'react'
import type { PreFixedRouteCandidate, RoutePoint } from '../../types/preFixedMeterSession'
import { pathFromRouteLegs, type PolylineLatLng } from '../../utils/polylinePath'
import { ensureGoogleMapsApiLoaded } from '../../utils/googleMapsLoader'

type LatLng = {
  lat: number
  lng: number
}

type GoogleMapsMap = {
  fitBounds: (bounds: unknown, padding?: number) => void
  setCenter: (center: LatLng) => void
  setZoom: (zoom: number) => void
}

type GoogleMapsPolyline = {
  setMap: (map: GoogleMapsMap | null) => void
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type GoogleMapsMarker = {
  setMap: (map: GoogleMapsMap | null) => void
}

type GoogleMapsLatLngBounds = {
  extend: (point: LatLng) => void
  isEmpty?: () => boolean
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
  Marker: new (options: {
    map: GoogleMapsMap
    position: LatLng
    label?: string
    title?: string
  }) => GoogleMapsMarker
  Polyline: new (options: Record<string, unknown>) => GoogleMapsPolyline
  SymbolPath?: { FORWARD_CLOSED_ARROW: unknown }
  geometry?: {
    encoding?: {
      decodePath: (encoded: string) => LatLng[]
    }
  }
  importLibrary?: (name: string) => Promise<unknown>
}

const TOKYO_FALLBACK = { lat: 35.6812, lng: 139.7671 }
/** lp-site ROUTE_ARROW_ANIMATION_MS */
const ROUTE_ARROW_ANIMATION_MS = 4500

const STRATEGY_COLORS: Record<string, string> = {
  A: '#C62828',
  B: '#1565C0',
  C: '#F9A825',
  D: '#212121',
}

const prefersReducedMotion = () =>
  Boolean(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

const getGoogleMaps = () => {
  const maps = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google?.maps
  if (!maps?.Map || !maps.Polyline || !maps.LatLngBounds) {
    throw new Error('Google Maps API is unavailable.')
  }
  return maps
}

const resolveCandidatePaths = (candidate: PreFixedRouteCandidate): PolylineLatLng[][] => {
  const legs = Array.isArray(candidate.routeLegs) ? candidate.routeLegs : []
  if (legs.length >= 2) {
    const legPaths = legs
      .map((leg) => pathFromRouteLegs([leg], undefined))
      .filter((path) => path.length >= 2)
    if (legPaths.length >= 2) {
      return legPaths
    }
    if (legPaths.length === 1) {
      return legPaths
    }
  }

  const combined = pathFromRouteLegs(candidate.routeLegs, candidate.polyline)
  return combined.length >= 2 ? [combined] : []
}

export type RouteMapMarker = {
  point: RoutePoint
  role: 'pickup' | 'waypoint' | 'destination'
  label: string
}

export type PreFixedRouteMapRenderResult = {
  success: boolean
  message?: string
  requestId?: number
}

export type PreFixedRouteMapPanelProps = {
  candidates: PreFixedRouteCandidate[]
  selectedRouteId: PreFixedRouteCandidate['id']
  /** fitBounds 失敗時に東京へ戻さず、出発地周辺を表示する */
  fallbackCenter?: LatLng | null
  markerPoints?: RoutePoint[]
  /** 手動フロー（PreFixedRouteSelectionStep）互換 */
  markers?: RouteMapMarker[]
  isLoading?: boolean
  reloadToken?: number
  showSelectedRouteOnly?: boolean
  requestId?: number
  onRenderResult?: (result: PreFixedRouteMapRenderResult) => void
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

export function PreFixedRouteMapPanel({
  candidates,
  selectedRouteId,
  fallbackCenter = null,
  markerPoints = [],
  markers = [],
  isLoading = false,
  reloadToken = 0,
  showSelectedRouteOnly = false,
  requestId,
  onRenderResult,
}: PreFixedRouteMapPanelProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GoogleMapsMap | null>(null)
  const polylinesRef = useRef<GoogleMapsPolyline[]>([])
  const markersRef = useRef<GoogleMapsMarker[]>([])
  const animationCancelersRef = useRef<Array<() => void>>([])
  const onRenderResultRef = useRef(onRenderResult)
  onRenderResultRef.current = onRenderResult

  useEffect(() => {
    let isMounted = true

    const stopAnimations = () => {
      animationCancelersRef.current.forEach((cancel) => cancel())
      animationCancelersRef.current = []
    }

    const clearOverlays = () => {
      stopAnimations()
      polylinesRef.current.forEach((line) => line.setMap(null))
      polylinesRef.current = []
      markersRef.current.forEach((marker) => marker.setMap(null))
      markersRef.current = []
    }

    const report = (result: PreFixedRouteMapRenderResult) => {
      if (!isMounted) {
        return
      }
      onRenderResultRef.current?.({ ...result, requestId })
    }

    const buildArrowIcon = (maps: GoogleMapsNamespace, color: string) => ({
      path: maps.SymbolPath?.FORWARD_CLOSED_ARROW ?? 0,
      scale: 3,
      strokeColor: color,
      strokeOpacity: 0.95,
      strokeWeight: 1,
      fillColor: color,
      fillOpacity: 0.95,
      rotation: 0,
    })

    const startArrowAnimation = (polyline: GoogleMapsPolyline, arrowIconIndex: number) => {
      if (arrowIconIndex < 0 || prefersReducedMotion()) {
        return
      }
      let rafId: number | null = null
      let startTime: number | null = null
      const tick = (now: number) => {
        if (startTime == null) {
          startTime = now
        }
        const elapsed = (now - startTime) % ROUTE_ARROW_ANIMATION_MS
        const offset = (elapsed / ROUTE_ARROW_ANIMATION_MS) * 100
        const icons = polyline.get('icons')
        if (Array.isArray(icons) && icons[arrowIconIndex]) {
          const nextIcons = icons.slice() as Array<Record<string, unknown>>
          nextIcons[arrowIconIndex] = {
            ...nextIcons[arrowIconIndex],
            offset: `${offset.toFixed(2)}%`,
          }
          polyline.set('icons', nextIcons)
        }
        rafId = window.requestAnimationFrame(tick)
      }
      rafId = window.requestAnimationFrame(tick)
      animationCancelersRef.current.push(() => {
        if (rafId != null) {
          window.cancelAnimationFrame(rafId)
        }
      })
    }

    const drawPath = ({
      maps,
      map,
      path,
      color,
      isSelected,
      zIndex,
    }: {
      maps: GoogleMapsNamespace
      map: GoogleMapsMap
      path: PolylineLatLng[]
      color: string
      isSelected: boolean
      zIndex: number
    }) => {
      const icons = [
        {
          icon: buildArrowIcon(maps, color),
          offset: prefersReducedMotion() ? '12%' : '0%',
          repeat: '72px',
        },
      ]
      const line = new maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: isSelected ? 0.92 : 0.35,
        strokeWeight: isSelected ? 6 : 4,
        zIndex,
        icons,
      })
      polylinesRef.current.push(line)
      if (isSelected) {
        startArrowAnimation(line, 0)
      }
    }

    const renderMap = async () => {
      if (isLoading || candidates.length === 0) {
        clearOverlays()
        report({ success: false, message: 'ルート線を表示できませんでした' })
        return
      }

      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
        if (!apiKey) {
          report({ success: false, message: 'ルート線を表示できませんでした' })
          return
        }

        await ensureGoogleMapsApiLoaded(apiKey)
        if (!isMounted) {
          return
        }

        const maps = getGoogleMaps()
        try {
          await maps.importLibrary?.('geometry')
        } catch {
          // pathFromRouteLegs / decodePolyline フォールバックを使う
        }

        const mapElement = mapContainerRef.current
        if (!mapElement) {
          report({ success: false, message: 'ルート線を表示できませんでした' })
          return
        }

        clearOverlays()

        const initialCenter =
          fallbackCenter &&
          Number.isFinite(fallbackCenter.lat) &&
          Number.isFinite(fallbackCenter.lng)
            ? fallbackCenter
            : TOKYO_FALLBACK

        const map =
          mapRef.current ??
          new maps.Map(mapElement, {
            center: initialCenter,
            zoom: 13,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          })
        mapRef.current = map

        const bounds = new maps.LatLngBounds()
        let hasBounds = false
        let drewSelectedPolyline = false

        const routesToDraw = showSelectedRouteOnly
          ? candidates.filter((candidate) => candidate.id === selectedRouteId)
          : candidates

        const ordered = [...routesToDraw].sort((left, right) => {
          if (left.id === selectedRouteId) return 1
          if (right.id === selectedRouteId) return -1
          return 0
        })

        for (const candidate of ordered) {
          const paths = resolveCandidatePaths(candidate)
          if (paths.length === 0) {
            continue
          }

          const isSelected = candidate.id === selectedRouteId
          if (isSelected) {
            drewSelectedPolyline = true
          }

          const color = isSelected
            ? STRATEGY_COLORS[candidate.id] || '#2563eb'
            : '#94a3b8'

          paths.forEach((path, pathIndex) => {
            path.forEach((point) => {
              bounds.extend(point)
              hasBounds = true
            })
            drawPath({
              maps,
              map,
              path,
              color,
              isSelected,
              zIndex: isSelected ? 10 + pathIndex : 1 + pathIndex,
            })
          })
        }

        const resolvedMarkers =
          markers.length > 0
            ? markers
            : markerPoints.map((point, index) => ({
                point,
                role:
                  index === 0
                    ? ('pickup' as const)
                    : index === markerPoints.length - 1
                      ? ('destination' as const)
                      : ('waypoint' as const),
                label:
                  index === 0 ? 'S' : index === markerPoints.length - 1 ? 'G' : String(index),
              }))

        resolvedMarkers.forEach((marker) => {
          const { point } = marker
          if (typeof point.lat !== 'number' || typeof point.lng !== 'number') {
            return
          }
          if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
            return
          }
          const position = { lat: point.lat, lng: point.lng }
          bounds.extend(position)
          hasBounds = true
          markersRef.current.push(
            new maps.Marker({
              map,
              position,
              label: marker.label,
              title: point.label || point.address,
            }),
          )
        })

        if (hasBounds) {
          map.fitBounds(bounds, 48)
        } else if (fallbackCenter) {
          map.setCenter(fallbackCenter)
          map.setZoom(13)
        }

        if (!drewSelectedPolyline) {
          report({ success: false, message: 'ルート線を表示できませんでした' })
          return
        }

        report({ success: true })
      } catch (error) {
        console.warn('Failed to render pre-fixed route map.', error)
        report({ success: false, message: 'ルート線を表示できませんでした' })
      }
    }

    const onPageHide = () => {
      stopAnimations()
    }
    window.addEventListener('pagehide', onPageHide)

    void renderMap()

    return () => {
      isMounted = false
      window.removeEventListener('pagehide', onPageHide)
      clearOverlays()
    }
  }, [
    candidates,
    selectedRouteId,
    fallbackCenter,
    markerPoints,
    markers,
    isLoading,
    reloadToken,
    showSelectedRouteOnly,
    requestId,
  ])

  return (
    <div
      ref={mapContainerRef}
      className={`pre-fixed-route-map-panel${isLoading ? ' is-loading' : ''}`}
      aria-label="ルート候補マップ"
      role="img"
    />
  )
}
