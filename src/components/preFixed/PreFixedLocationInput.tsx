import { useEffect, useId, useRef, useState } from 'react'
import type { RoutePoint } from '../../types/preFixedMeterSession'
import { createRoutePoint } from '../../services/preFixedMeterSession'
import {
  formatRoutePointDisplayLines,
  getRoutePointInputText,
  isCoordinatePairText,
} from '../../utils/routePointDisplay'
import { ensureGoogleMapsApiLoaded } from '../../utils/googleMapsLoader'
import { isRoutePointResolved } from '../../services/resolveRoutePoint'

type PlacePrediction = {
  placeId: string
  primaryText: string
  secondaryText: string
  description: string
}

type GooglePlacesLibraries = {
  AutocompleteService?: new () => {
    getPlacePredictions: (
      request: {
        input: string
        language?: string
        componentRestrictions?: { country: string }
      },
      callback: (
        predictions: Array<{
          place_id?: string
          description?: string
          structured_formatting?: {
            main_text?: string
            secondary_text?: string
          }
        }> | null,
        status: string,
      ) => void,
    ) => void
  }
  PlacesService?: new (attribution: HTMLElement) => {
    getDetails: (
      request: { placeId: string; fields: string[]; language?: string },
      callback: (
        result: {
          place_id?: string
          name?: string
          formatted_address?: string
          geometry?: { location?: { lat: () => number; lng: () => number } }
        } | null,
        status: string,
      ) => void,
    ) => void
  }
  PlacesServiceStatus?: { OK: string; ZERO_RESULTS: string }
}

type PreFixedLocationInputProps = {
  point: RoutePoint
  error?: string
  placeholder?: string
  disabled?: boolean
  isLocating?: boolean
  linkedToOrigin?: boolean
  showSameAsOrigin?: boolean
  showCurrentLocation?: boolean
  showDelete?: boolean
  onChangePoint: (point: RoutePoint) => void
  onSameAsOrigin?: () => void
  onUnlinkOrigin?: () => void
  onCurrentLocation?: () => void
  onDelete?: () => void
}

const searchPlacePredictions = async (query: string): Promise<PlacePrediction[]> => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
  if (!apiKey || query.trim().length < 2) {
    return []
  }

  await ensureGoogleMapsApiLoaded(apiKey)
  const maps = (
    window as Window & {
      google?: { maps?: { importLibrary?: (name: string) => Promise<GooglePlacesLibraries> } }
    }
  ).google?.maps

  const placesLibrary = await maps?.importLibrary?.('places')
  const AutocompleteService = placesLibrary?.AutocompleteService
  const okStatus = placesLibrary?.PlacesServiceStatus?.OK || 'OK'
  if (!AutocompleteService) {
    return []
  }

  const service = new AutocompleteService()
  return new Promise((resolve) => {
    service.getPlacePredictions(
      {
        input: query.trim(),
        language: 'ja',
        componentRestrictions: { country: 'jp' },
      },
      (predictions, status) => {
        if (status !== okStatus || !predictions?.length) {
          resolve([])
          return
        }
        resolve(
          predictions
            .filter((item) => item.place_id)
            .map((item) => ({
              placeId: item.place_id as string,
              primaryText: item.structured_formatting?.main_text || item.description || '',
              secondaryText: item.structured_formatting?.secondary_text || '',
              description: item.description || '',
            })),
        )
      },
    )
  })
}

const fetchPlaceDetails = async (placeId: string): Promise<RoutePoint | null> => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
  if (!apiKey) {
    return null
  }

  await ensureGoogleMapsApiLoaded(apiKey)
  const maps = (
    window as Window & {
      google?: { maps?: { importLibrary?: (name: string) => Promise<GooglePlacesLibraries> } }
    }
  ).google?.maps

  const placesLibrary = await maps?.importLibrary?.('places')
  const PlacesService = placesLibrary?.PlacesService
  const okStatus = placesLibrary?.PlacesServiceStatus?.OK || 'OK'
  if (!PlacesService) {
    return null
  }

  const attribution = document.createElement('div')
  const service = new PlacesService(attribution)

  return new Promise((resolve) => {
    service.getDetails(
      {
        placeId,
        language: 'ja',
        fields: ['place_id', 'name', 'formatted_address', 'geometry'],
      },
      (result, status) => {
        if (status !== okStatus || !result) {
          resolve(null)
          return
        }
        const lat = result.geometry?.location?.lat()
        const lng = result.geometry?.location?.lng()
        const formattedAddress = result.formatted_address?.trim() || ''
        const name = result.name?.trim() || ''
        if (
          typeof lat !== 'number' ||
          typeof lng !== 'number' ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          !formattedAddress
        ) {
          resolve(null)
          return
        }

        resolve(
          createRoutePoint({
            address: formattedAddress,
            formattedAddress,
            label: name || formattedAddress,
            facilityName: name || undefined,
            placeId: result.place_id || placeId,
            lat,
            lng,
            source: 'facility_search',
          }),
        )
      },
    )
  })
}

const pointSyncKey = (point: RoutePoint) =>
  [
    point.placeId || '',
    point.lat ?? '',
    point.lng ?? '',
    point.formattedAddress || '',
    point.address || '',
    point.facilityName || '',
    point.source,
  ].join('|')

export function PreFixedLocationInput({
  point,
  error,
  placeholder = '住所または施設名を入力',
  disabled = false,
  isLocating = false,
  linkedToOrigin = false,
  showSameAsOrigin = false,
  showCurrentLocation = true,
  showDelete = false,
  onChangePoint,
  onSameAsOrigin,
  onUnlinkOrigin,
  onCurrentLocation,
  onDelete,
}: PreFixedLocationInputProps) {
  const listboxId = useId()
  const [draftText, setDraftText] = useState(() => getRoutePointInputText(point))
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isResolvingPlace, setIsResolvingPlace] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const blurTimerRef = useRef<number | null>(null)
  const selectingPredictionRef = useRef(false)
  const lastSyncedKeyRef = useRef(pointSyncKey(point))
  const readOnly = disabled || linkedToOrigin

  useEffect(() => {
    const nextKey = pointSyncKey(point)
    if (nextKey === lastSyncedKeyRef.current) {
      return
    }
    lastSyncedKeyRef.current = nextKey
    if (isFocused || isComposing || selectingPredictionRef.current) {
      return
    }
    setDraftText(getRoutePointInputText(point))
  }, [point, isFocused, isComposing])

  useEffect(() => {
    if (readOnly || isComposing || selectingPredictionRef.current) {
      return undefined
    }

    const trimmed = draftText.trim()
    if (trimmed.length < 2 || isCoordinatePairText(trimmed)) {
      setPredictions([])
      return undefined
    }

    if (isRoutePointResolved(point) && trimmed === getRoutePointInputText(point)) {
      setPredictions([])
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setIsSearching(true)
      void searchPlacePredictions(trimmed)
        .then((items) => {
          if (!cancelled) {
            setPredictions(items)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearching(false)
          }
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draftText, point, readOnly, isComposing])

  useEffect(
    () => () => {
      if (blurTimerRef.current != null) {
        window.clearTimeout(blurTimerRef.current)
      }
    },
    [],
  )

  const displayLines = formatRoutePointDisplayLines(point)
  const showResolvedSummary =
    isRoutePointResolved(point) &&
    !isCoordinatePairText(point.address || '') &&
    Boolean((point.formattedAddress || point.address || '').trim())

  const handleDraftChange = (value: string) => {
    setDraftText(value)
    const nextPoint = createRoutePoint({
      address: value,
      label: value,
      facilityName: value.trim() || undefined,
      source: 'manual',
    })
    lastSyncedKeyRef.current = pointSyncKey(nextPoint)
    onChangePoint(nextPoint)
  }

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    selectingPredictionRef.current = true
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    setIsResolvingPlace(true)
    setPredictions([])
    try {
      const resolved = await fetchPlaceDetails(prediction.placeId)
      if (resolved) {
        const displayName = resolved.facilityName || resolved.label || prediction.primaryText
        lastSyncedKeyRef.current = pointSyncKey(resolved)
        setDraftText(displayName)
        onChangePoint({ ...resolved })
        return
      }
      // details 失敗時は未確定のまま（座標なし）。候補再選択を促す
      const drafting = createRoutePoint({
        address: prediction.primaryText || prediction.description,
        label: prediction.primaryText || prediction.description,
        facilityName: prediction.primaryText || undefined,
        source: 'manual',
      })
      lastSyncedKeyRef.current = pointSyncKey(drafting)
      setDraftText(getRoutePointInputText(drafting))
      onChangePoint(drafting)
    } finally {
      setIsResolvingPlace(false)
      selectingPredictionRef.current = false
    }
  }

  return (
    <div className="pre-fixed-location-input">
      <label className="pre-fixed-full-width">
        住所または施設名
        <input
          value={isLocating ? '' : draftText}
          placeholder={isLocating ? '住所を取得しています…' : placeholder}
          disabled={readOnly || isLocating}
          autoComplete="off"
          role="combobox"
          aria-expanded={predictions.length > 0}
          aria-controls={listboxId}
          onChange={(event) => handleDraftChange(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            setIsComposing(false)
            handleDraftChange(event.currentTarget.value)
          }}
          onBlur={() => {
            setIsFocused(false)
            if (selectingPredictionRef.current) {
              return
            }
            blurTimerRef.current = window.setTimeout(() => {
              if (!selectingPredictionRef.current) {
                setPredictions([])
              }
            }, 200)
          }}
          onFocus={() => {
            setIsFocused(true)
            if (blurTimerRef.current != null) {
              window.clearTimeout(blurTimerRef.current)
            }
          }}
        />
      </label>

      {isLocating || isResolvingPlace ? (
        <p className="save-note" role="status">
          住所を取得しています…
        </p>
      ) : null}

      {predictions.length > 0 ? (
        <ul id={listboxId} className="pre-fixed-place-suggestions" role="listbox">
          {predictions.map((prediction) => (
            <li key={prediction.placeId} role="option">
              <button
                type="button"
                className="pre-fixed-place-suggestion"
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectingPredictionRef.current = true
                }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  selectingPredictionRef.current = true
                }}
                onClick={() => {
                  void handleSelectPrediction(prediction)
                }}
              >
                <strong>{prediction.primaryText}</strong>
                {prediction.secondaryText ? <span>{prediction.secondaryText}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {isSearching ? (
        <p className="save-note" role="status">
          候補を検索しています…
        </p>
      ) : null}

      {showResolvedSummary ? (
        <div className="pre-fixed-location-resolved" role="status">
          {displayLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {linkedToOrigin ? (
        <p className="save-note" role="status">
          出発地と同じ設定中
        </p>
      ) : null}

      {error ? (
        <p className="case-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="pre-fixed-inline-actions">
        {showSameAsOrigin ? (
          linkedToOrigin ? (
            <button className="secondary-action" type="button" onClick={onUnlinkOrigin}>
              出発地と同じを解除
            </button>
          ) : (
            <button className="secondary-action" type="button" onClick={onSameAsOrigin}>
              出発地と同じ
            </button>
          )
        ) : null}
        {showCurrentLocation ? (
          <button
            className="secondary-action"
            type="button"
            disabled={disabled || isLocating || linkedToOrigin}
            onClick={onCurrentLocation}
          >
            {error?.includes('住所を取得できませんでした') ? '住所を再取得' : '現在地を取得'}
          </button>
        ) : null}
        {showDelete ? (
          <button className="secondary-action" type="button" onClick={onDelete}>
            削除
          </button>
        ) : null}
      </div>
    </div>
  )
}
