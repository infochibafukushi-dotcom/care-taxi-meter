import { doc, getFirestore, writeBatch } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { GPS_CAPTURE_INTERVAL_SECONDS } from '../hooks/useCurrentPosition'
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
  closedAt: string
  logs: GpsLogEntry[]
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
    t: log.capturedAt,
    lat: log.latitude,
    lng: log.longitude,
    s: log.speed,
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
  closedAt,
  logs,
}: SaveGpsRouteInput): Promise<boolean> {
  const points = logs
    .map(toGpsRoutePoint)
    .filter((point): point is GpsRoutePoint => point !== null)

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

  await batch.commit()
  return true
}
