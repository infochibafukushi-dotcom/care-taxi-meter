import { useEffect, useRef, useState } from 'react'
import {
  calculateGpsRouteDistanceKm,
  fetchGpsRouteChunks,
  type GpsRouteSaveStatus,
} from '../../services/gpsRoutes'
import type { GpsRoutePoint } from '../../types/case'
import { ensureGoogleMapsApiLoaded } from '../../utils/googleMapsLoader'

type LatLng = {
  lat: number
  lng: number
}

type GpsRouteMapDialogProps = {
  caseRecordId: string
  chunkCount: number
  dropoff: LatLng | null
  isOpen: boolean
  onClose: () => void
  pickup: LatLng | null
  pointCount: number
  saveStatus: GpsRouteSaveStatus
}

type GoogleMapsMap = {
  fitBounds: (bounds: unknown) => void
  setCenter: (center: LatLng) => void
  setZoom: (zoom: number) => void
}

type GoogleMapsMarker = {
  setMap: (map: GoogleMapsMap | null) => void
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
  Marker: new (options: {
    label?: string
    map: GoogleMapsMap
    position: LatLng
    title?: string
  }) => GoogleMapsMarker
  Polyline: new (options: {
    map: GoogleMapsMap
    path: LatLng[]
    strokeColor: string
    strokeOpacity: number
    strokeWeight: number
  }) => GoogleMapsPolyline
}

const getGoogleMaps = () => {
  const maps = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google?.maps
  if (!maps?.Map || !maps.Marker || !maps.Polyline || !maps.LatLngBounds) {
    throw new Error('Google Maps API is unavailable.')
  }

  return maps
}

const toLatLng = (point: GpsRoutePoint): LatLng => ({
  lat: point.lat,
  lng: point.lng,
})

const isValidLatLng = (value: LatLng | null): value is LatLng =>
  value !== null &&
  Number.isFinite(value.lat) &&
  Number.isFinite(value.lng)

export function GpsRouteMapDialog({
  caseRecordId,
  chunkCount,
  dropoff,
  isOpen,
  onClose,
  pickup,
  pointCount,
  saveStatus,
}: GpsRouteMapDialogProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GoogleMapsMap | null>(null)
  const markersRef = useRef<GoogleMapsMarker[]>([])
  const polylineRef = useRef<GoogleMapsPolyline | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null)
  const [loadedPointCount, setLoadedPointCount] = useState(0)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    let isMounted = true

    const renderMap = async () => {
      setIsLoading(true)
      setErrorMessage('')
      setRouteDistanceKm(null)
      setLoadedPointCount(0)

      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
        await ensureGoogleMapsApiLoaded(apiKey)

        const points = await fetchGpsRouteChunks(caseRecordId, chunkCount)
        if (!isMounted) {
          return
        }

        if (points.length === 0) {
          setErrorMessage('GPSルートの座標データがありません。')
          return
        }

        const path = points.map(toLatLng)
        const distanceKm = calculateGpsRouteDistanceKm(points)
        setRouteDistanceKm(distanceKm)
        setLoadedPointCount(points.length)

        const mapElement = mapContainerRef.current
        if (!mapElement) {
          return
        }

        const maps = getGoogleMaps()
        markersRef.current.forEach((marker) => marker.setMap(null))
        markersRef.current = []
        polylineRef.current?.setMap(null)
        polylineRef.current = null

        const map = mapRef.current ?? new maps.Map(mapElement, {
          center: path[0],
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        })
        mapRef.current = map

        polylineRef.current = new maps.Polyline({
          map,
          path,
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 4,
        })

        const startPosition = isValidLatLng(pickup) ? pickup : path[0]
        const endPosition = isValidLatLng(dropoff) ? dropoff : path[path.length - 1]

        markersRef.current = [
          new maps.Marker({
            map,
            position: startPosition,
            label: '出',
            title: '出発地',
          }),
          new maps.Marker({
            map,
            position: endPosition,
            label: '着',
            title: '到着地',
          }),
        ]

        const bounds = new maps.LatLngBounds()
        path.forEach((point) => bounds.extend(point))
        if (isValidLatLng(pickup)) {
          bounds.extend(pickup)
        }
        if (isValidLatLng(dropoff)) {
          bounds.extend(dropoff)
        }
        map.fitBounds(bounds)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorMessage(
          error instanceof Error ? error.message : 'GPSルート地図の表示に失敗しました。',
        )
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void renderMap()

    return () => {
      isMounted = false
    }
  }, [caseRecordId, chunkCount, dropoff, isOpen, pickup])

  if (!isOpen) {
    return null
  }

  const statusNote = saveStatus === 'expired' ? '保存期限超過' : null

  return (
    <div className="receipt-dialog-backdrop gps-route-map-backdrop" role="presentation">
      <section
        aria-labelledby="gps-route-map-title"
        aria-modal="true"
        className="receipt-dialog gps-route-map-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">GPS Route</p>
            <h2 id="gps-route-map-title">GPS軌跡</h2>
          </div>
        </header>

        {statusNote ? (
          <p className="gps-route-map-expired-note" role="status">
            {statusNote}
          </p>
        ) : null}

        {isLoading ? (
          <p className="empty-note">GPSルートを読み込んでいます...</p>
        ) : null}

        {errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="gps-route-map-stats" aria-label="GPSルート統計">
          <div>
            <span>GPS点数</span>
            <strong>{loadedPointCount || pointCount}点</strong>
          </div>
          <div>
            <span>総距離</span>
            <strong>
              {routeDistanceKm === null ? '―' : `${routeDistanceKm.toFixed(3)} km`}
            </strong>
          </div>
        </div>

        <div
          ref={mapContainerRef}
          className="gps-route-map-container"
          aria-label="GPSルート地図"
        />

        <div className="receipt-dialog-actions">
          <button className="receipt-dialog-secondary" type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </section>
    </div>
  )
}
