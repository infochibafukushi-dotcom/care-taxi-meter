import { collectionGroup, doc, getDoc, getDocs, getFirestore, orderBy, query, where, writeBatch } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { GPS_CAPTURE_INTERVAL_SECONDS } from '../hooks/useCurrentPosition'
import { calculateDistanceMeters } from '../utils/distance'
import type { TenantAccessScope } from './tenancy'
import type {
  GpsLogEntry,
  GpsRouteBounds,
  GpsRouteChunk,
  GpsRoutePoint,
  GpsRouteSummary,
} from '../types/case'

export const GPS_ROUTE_CHUNK_SIZE = 100
export const GPS_ROUTE_RETENTION_DAYS = 40
export const GPS_ROUTE_SCHEMA_VERSION = 1

export type SaveGpsRouteInput = {
  caseRecordId: string
  caseNumber: string
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  vehicleId: string
  vehicleName: string
  closedAt: string
  logs: GpsLogEntry[]
}

export type GpsRouteSummaryInfo = {
  pointCount: number
  chunkCount: number
  savedAt: string
  expiresAt: string
  staffId: string
  staffName: string
  vehicleId: string
  vehicleName: string
  closedAt: string
  caseNumber: string
}

export type GpsRouteSaveStatus = 'saved' | 'unsaved' | 'expired'

export type GpsRouteListItem = {
  caseRecordId: string
  caseNumber: string
  pointCount: number
  chargeableDistanceKm: number
  savedAt: string
  expiresAt: string
  staffId: string
  staffName: string
  vehicleId: string
  vehicleName: string
  closedAt: string
}

export type FetchGpsRouteListOptions = {
  fromClosedAt: string
  toClosedAt: string
  staffId: string
  vehicleId: string
}

const isValidCoordinate = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180 &&
  !(latitude === 0 && longitude === 0)

const toGpsRoutePoint = (log: GpsLogEntry): GpsRoutePoint | null => {
  if (!isValidCoordinate(log.latitude, log.longitude)) {
    return null
  }

  return {
    t: Number.isFinite(log.capturedAt)
      ? log.capturedAt
      : Date.now(),
    lat: log.latitude,
    lng: log.longitude,
    s: Number.isFinite(log.speed)
      ? log.speed
      : 0,
    a: Number.isFinite(log.accuracy) ? log.accuracy : 0,
  }
}

const calculateBounds = (points: GpsRoutePoint[]): GpsRouteBounds => {
  const initial = {
    minLat: points[0].lat,
    maxLat: points[0].lat,
    minLng: points[0].lng,
    maxLng: points[0].lng,
  }

  return points.reduce<GpsRouteBounds>((bounds, point) => ({
    minLat: Math.min(bounds.minLat, point.lat),
    maxLat: Math.max(bounds.maxLat, point.lat),
    minLng: Math.min(bounds.minLng, point.lng),
    maxLng: Math.max(bounds.maxLng, point.lng),
  }), initial)
}

const addDaysIso = (isoString: string, days: number) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    throw new Error('closedAt が不正なため GPS ルートの保存期限を計算できません。')
  }

  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

const getGpsRouteSummaryRef = (caseRecordId: string) => {
  const db = getFirestore(getFirebaseApp())
  return doc(db, 'caseRecords', caseRecordId, 'gpsRoute', 'summary')
}

const getGpsRouteChunkRef = (caseRecordId: string, chunkIndex: number) => {
  const db = getFirestore(getFirebaseApp())
  return doc(db, 'caseRecords', caseRecordId, 'gpsRoute', 'summary', 'chunks', String(chunkIndex))
}

export function getGpsRouteSaveStatus(summary: GpsRouteSummaryInfo | null): GpsRouteSaveStatus {
  if (!summary) {
    return 'unsaved'
  }

  const expiresAt = new Date(summary.expiresAt)
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return 'expired'
  }

  return 'saved'
}

export function formatGpsRouteStatusLabel(
  status: GpsRouteSaveStatus,
  summary: GpsRouteSummaryInfo | null,
): string {
  if (status === 'unsaved') {
    return '未保存'
  }

  if (status === 'expired') {
    return '保存期限超過'
  }

  return `保存済み（${summary?.pointCount ?? 0}件）`
}

export function formatGpsRouteExpiresAt(expiresAt: string): string {
  if (!expiresAt.trim()) {
    return '―'
  }

  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return '―'
  }

  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export async function fetchGpsRouteSummary(
  caseRecordId: string,
): Promise<GpsRouteSummaryInfo | null> {
  const snapshot = await getDoc(getGpsRouteSummaryRef(caseRecordId))
  if (!snapshot.exists()) {
    return null
  }

  const data = snapshot.data()
  return parseGpsRouteSummaryInfo(data)
}

export async function fetchGpsRouteChunks(
  caseRecordId: string,
  chunkCount: number,
): Promise<GpsRoutePoint[]> {
  if (chunkCount <= 0) {
    return []
  }

  const snapshots = await Promise.all(
    Array.from({ length: chunkCount }, (_, chunkIndex) =>
      getDoc(getGpsRouteChunkRef(caseRecordId, chunkIndex)),
    ),
  )

  const points: GpsRoutePoint[] = []
  snapshots.forEach((snapshot) => {
    if (!snapshot.exists()) {
      return
    }

    const data = snapshot.data() as GpsRouteChunk
    if (Array.isArray(data.points)) {
      points.push(...data.points)
    }
  })

  return points
}

export function calculateGpsRouteDistanceKm(points: GpsRoutePoint[]): number {
  if (points.length < 2) {
    return 0
  }

  let totalMeters = 0
  for (let index = 1; index < points.length; index += 1) {
    totalMeters += calculateDistanceMeters(
      { latitude: points[index - 1].lat, longitude: points[index - 1].lng },
      { latitude: points[index].lat, longitude: points[index].lng },
    )
  }

  return totalMeters / 1000
}

const parseGpsRouteSummaryInfo = (
  data: Record<string, unknown>,
): GpsRouteSummaryInfo => ({
  pointCount: typeof data.pointCount === 'number' ? data.pointCount : 0,
  chunkCount: typeof data.chunkCount === 'number' ? data.chunkCount : 0,
  savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
  expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
  staffId: typeof data.staffId === 'string' ? data.staffId : '',
  staffName: typeof data.staffName === 'string' ? data.staffName : '',
  vehicleId: typeof data.vehicleId === 'string' ? data.vehicleId : '',
  vehicleName: typeof data.vehicleName === 'string' ? data.vehicleName : '',
  closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
  caseNumber: typeof data.caseNumber === 'string' ? data.caseNumber : '',
})

export async function fetchGpsRouteList(
  scope: TenantAccessScope,
  caseRecordDistanceById: Map<string, number>,
  options: FetchGpsRouteListOptions,
): Promise<GpsRouteListItem[]> {
  const db = getFirestore(getFirebaseApp())
  const constraints = [
    where('closedAt', '>=', options.fromClosedAt),
    where('closedAt', '<=', options.toClosedAt),
    orderBy('closedAt', 'desc'),
  ]

  if (scope.role === 'manager') {
    constraints.unshift(where('storeId', '==', scope.storeId))
    constraints.unshift(where('franchiseeId', '==', scope.franchiseeId))
  } else if (scope.role === 'owner') {
    constraints.unshift(where('franchiseeId', '==', scope.franchiseeId))
  }

  const snapshot = await getDocs(
    query(collectionGroup(db, 'gpsRoute'), ...constraints),
  )

  const items: GpsRouteListItem[] = []
  snapshot.forEach((documentSnapshot) => {
    if (documentSnapshot.id !== 'summary') {
      return
    }

    const summary = parseGpsRouteSummaryInfo(documentSnapshot.data())
    const caseRecordId = typeof documentSnapshot.data().caseRecordId === 'string'
      ? documentSnapshot.data().caseRecordId
      : documentSnapshot.ref.parent.parent?.id ?? ''

    if (!caseRecordId) {
      return
    }

    if (options.staffId !== 'all' && summary.staffId !== options.staffId) {
      return
    }

    if (options.vehicleId !== 'all' && summary.vehicleId !== options.vehicleId) {
      return
    }

    items.push({
      caseRecordId,
      caseNumber: summary.caseNumber,
      pointCount: summary.pointCount,
      chargeableDistanceKm: caseRecordDistanceById.get(caseRecordId) ?? 0,
      savedAt: summary.savedAt,
      expiresAt: summary.expiresAt,
      staffId: summary.staffId,
      staffName: summary.staffName,
      vehicleId: summary.vehicleId,
      vehicleName: summary.vehicleName,
      closedAt: summary.closedAt,
    })
  })

  return items
}

/**
 * 案件終了時に GPS ログを Firestore サブコレクションへ保存する。
 *
 * 保存先:
 * - caseRecords/{caseRecordId}/gpsRoute/summary
 * - caseRecords/{caseRecordId}/gpsRoute/summary/chunks/{chunkIndex}
 *
 * 将来の期限通知用 collection group index 案:
 * - collectionGroup: chunks, fields: franchiseeId ASC, retentionPhase ASC, expiresAt ASC
 * - collectionGroup: gpsRoute (summary), fields: franchiseeId ASC, retentionPhase ASC, expiresAt ASC
 */
export async function saveGpsRoute({
  caseRecordId,
  caseNumber,
  franchiseeId,
  storeId,
  staffId,
  staffName,
  vehicleId,
  vehicleName,
  closedAt,
  logs,
}: SaveGpsRouteInput): Promise<boolean> {
  console.log('[GPS_ROUTE_DEBUG_3]', {
    caseRecordId,
    rawLogCount: logs.length,
  })

  const points = logs
    .map(toGpsRoutePoint)
    .filter((point): point is GpsRoutePoint => point !== null)

  console.log('[GPS_ROUTE_DEBUG_3_POINTS]', {
    rawLogCount: logs.length,
    validPointCount: points.length,
    nanSpeedCount: logs.filter(
      (log) => !Number.isFinite(log.speed),
    ).length,
  })

  if (points.length === 0) {
    return false
  }

  const chunkCount = Math.ceil(points.length / GPS_ROUTE_CHUNK_SIZE)
  const bounds = calculateBounds(points)
  const capturedFrom = new Date(points[0].t).toISOString()
  const capturedTo = new Date(points[points.length - 1].t).toISOString()
  const savedAt = new Date().toISOString()

  const summary: GpsRouteSummary = {
    schemaVersion: GPS_ROUTE_SCHEMA_VERSION,
    caseRecordId,
    caseNumber,
    franchiseeId,
    storeId,
    staffId,
    staffName,
    vehicleId,
    vehicleName,
    closedAt,
    intervalSeconds: GPS_CAPTURE_INTERVAL_SECONDS,
    pointCount: points.length,
    chunkCount,
    chunkSize: GPS_ROUTE_CHUNK_SIZE,
    bounds,
    capturedFrom,
    capturedTo,
    retentionPhase: 'active',
    expiresAt: addDaysIso(closedAt, GPS_ROUTE_RETENTION_DAYS),
    savedAt,
  }

  const batch = writeBatch(getFirestore(getFirebaseApp()))
  batch.set(getGpsRouteSummaryRef(caseRecordId), summary)

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const from = chunkIndex * GPS_ROUTE_CHUNK_SIZE
    const chunkPoints = points.slice(from, from + GPS_ROUTE_CHUNK_SIZE)
    const chunk: GpsRouteChunk = {
      index: chunkIndex,
      from,
      to: from + chunkPoints.length - 1,
      points: chunkPoints,
    }

    batch.set(getGpsRouteChunkRef(caseRecordId, chunkIndex), chunk)
  }

  try {
    await batch.commit()
    console.log('[GPS_ROUTE_DEBUG_4]', {
      caseRecordId,
      pointCount: points.length,
      chunkCount,
      path: `caseRecords/${caseRecordId}/gpsRoute/summary`,
    })
    return true
  } catch (error) {
    console.error('[GPS_ROUTE_DEBUG_ERROR]', error)
    throw error
  }
}
