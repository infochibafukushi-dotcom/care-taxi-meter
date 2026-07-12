export const GPS_LOCATION_LABEL = '現在地'
export const GPS_ADDRESS_FALLBACK = '現在地（位置情報取得済み）'
export const ADDRESS_RESOLVING_MESSAGE = '住所を取得しています…'
/** 概要・状態表示用。入力値や検索語には使わない */
export const ROUTE_POINT_UNSET_STATUS = '未設定'

const COORDINATE_PAIR_PATTERN = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/
const STATUS_LABELS = new Set([ROUTE_POINT_UNSET_STATUS, '未入力'])

/** 緯度経度のカンマ区切り文字列かどうか */
export const isCoordinatePairText = (value: string): boolean =>
  COORDINATE_PAIR_PATTERN.test(value.trim())

const stripStatusLabel = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed || STATUS_LABELS.has(trimmed)) {
    return ''
  }
  return trimmed
}

/** 画面表示用に緯度経度文字列を除外した安全な文字列へ変換する */
export const toSafeDisplayText = (value: string, fallback = '未入力'): string => {
  const trimmed = stripStatusLabel(value)
  if (!trimmed || isCoordinatePairText(trimmed)) {
    return fallback
  }
  return trimmed
}

export const formatRoutePointDisplayLines = (point: {
  label?: string
  address?: string
  facilityName?: string
  formattedAddress?: string
  source?: string
}): string[] => {
  const facilityName = stripStatusLabel(point.facilityName || '')
  const label = stripStatusLabel(point.label || '')
  const formatted = stripStatusLabel(point.formattedAddress || '')
  const address = stripStatusLabel(point.address || '')
  const safeFacility = facilityName && !isCoordinatePairText(facilityName) ? facilityName : ''
  const safeLabel = label && !isCoordinatePairText(label) ? label : ''
  const detailRaw = formatted || address
  const detail = detailRaw && !isCoordinatePairText(detailRaw) ? detailRaw : ''

  const title =
    safeFacility ||
    (safeLabel && safeLabel !== detail ? safeLabel : '') ||
    (point.source === 'gps' && detail ? GPS_LOCATION_LABEL : '')

  if (title && detail && title !== detail) {
    return [title, detail]
  }
  if (detail) {
    return [detail]
  }
  if (title && title !== GPS_LOCATION_LABEL) {
    return [title]
  }
  return [ROUTE_POINT_UNSET_STATUS]
}

/** ルート概要用（未確定は状態のみ。確定後は施設名と住所を分離） */
export const formatRoutePointOverviewLines = (point: {
  label?: string
  address?: string
  facilityName?: string
  formattedAddress?: string
  source?: string
  lat?: number
  lng?: number
  placeId?: string
}): string[] => {
  const hasCoords =
    typeof point.lat === 'number' &&
    Number.isFinite(point.lat) &&
    typeof point.lng === 'number' &&
    Number.isFinite(point.lng)
  const address = stripStatusLabel(point.formattedAddress || point.address || '')
  const needsPlaceId = point.source === 'facility_search' || point.source === 'facility_block'
  const resolved =
    hasCoords &&
    Boolean(address) &&
    !isCoordinatePairText(address) &&
    (!needsPlaceId || Boolean(point.placeId?.trim()))

  if (!resolved) {
    return [ROUTE_POINT_UNSET_STATUS]
  }
  return formatRoutePointDisplayLines(point)
}

/** 入力欄 value 専用。状態ラベルや座標文字列は返さない */
export const getRoutePointInputText = (point: {
  label?: string
  address?: string
  facilityName?: string
  formattedAddress?: string
}): string => {
  const facilityName = stripStatusLabel(point.facilityName || '')
  const label = stripStatusLabel(point.label || '')
  const address = stripStatusLabel(point.formattedAddress || point.address || '')
  const candidates = [facilityName, label, address].filter(
    (value) => value && !isCoordinatePairText(value),
  )
  return candidates[0] || ''
}
