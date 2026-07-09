import {
  collection,
  getCountFromServer,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { activeTripSnapshotStorageKey } from './activeTripSnapshot'
import { preFixedMeterSessionStorageKey } from './preFixedMeterSession'
import {
  checkReservationPreOpeningDeleteCapability,
  countTenantReservationsFromApi,
  deleteTenantReservationsPreOpening,
  type ReservationApiDeleteCapability,
} from './reservationPreOpeningReset'
import { reservationTripContextStorageKey } from './reservationTripContext'
import type { TenantScope } from './tenancy'

const functionsRegion = 'asia-northeast1'
const RESET_CONFIRMATION_TEXT = 'RESET'

export type PreOpeningDataCategoryCounts = {
  browserTemporaryData: number
  reservationApiRecords: number
  tripsAndSales: number
  accounting: number
  storageFiles: number
}

export type PreOpeningDataResetResult = {
  deletedCounts: PreOpeningDataCategoryCounts
  deletedByCollection: Record<string, number>
  clearedBrowserItems: number
  deletedReservationApiRecords: number
  reservationApiDeleteSkipped: boolean
  reservationApiDeleteMessage: string
  failedItems: Array<{ collection: string; documentId: string; message: string }>
  preservedSettings: boolean
}

type ResetCallableRequest = {
  franchiseeId: string
  storeId: string
  executedBy: string
  executedByName: string
}

type ResetCallableResponse = {
  deletedCounts: {
    reservations: number
    trips: number
    sales: number
    accounting: number
    storageFiles: number
  }
  deletedByCollection: Record<string, number>
  failedItems: Array<{ collection: string; documentId: string; message: string }>
  preservedSettings: boolean
}

const tenantScopedCollections = {
  tripsAndSales: ['caseRecords', 'workSessions', 'staffAttendance', 'caseCounters'],
  accounting: [
    'accountingExpenses',
    'accountingReceipts',
    'accountingAdjustments',
    'accountingExports',
    'accountingSales',
    'accountingSettlementAuxiliary',
    'accountingFixedAssets',
  ],
} as const

const browserStorageKeysToClear = [
  preFixedMeterSessionStorageKey,
  reservationTripContextStorageKey,
  activeTripSnapshotStorageKey,
  'careTaxiMeterTestReservationFlags',
  'careTaxiMeterPostSettlementLock',
  'careTaxiMeterInputHistory',
  'careTaxiMeterCurrentWorkSession',
] as const

const countTenantCollection = async (
  collectionName: string,
  scope: TenantScope,
) => {
  const db = getFirestore(getFirebaseApp())
  const snapshot = await getCountFromServer(
    query(
      collection(db, collectionName),
      where('franchiseeId', '==', scope.franchiseeId),
      where('storeId', '==', scope.storeId),
    ),
  )
  return snapshot.data().count
}

const countCaseCounters = async (scope: TenantScope) => {
  const db = getFirestore(getFirebaseApp())
  const snapshot = await getDocs(
    query(collection(db, 'caseCounters'), where('storeId', '==', scope.storeId)),
  )
  return snapshot.docs.filter((documentSnapshot) => {
    const data = documentSnapshot.data()
    const franchiseeId =
      typeof data.franchiseeId === 'string'
        ? data.franchiseeId
        : typeof data.companyId === 'string'
          ? data.companyId
          : ''
    return franchiseeId === scope.franchiseeId
  }).length
}

const countReceiptStorageFiles = async (scope: TenantScope) => {
  const db = getFirestore(getFirebaseApp())
  const snapshot = await getDocs(
    query(
      collection(db, 'accountingReceipts'),
      where('franchiseeId', '==', scope.franchiseeId),
      where('storeId', '==', scope.storeId),
    ),
  )

  return snapshot.docs.filter((documentSnapshot) => {
    const storagePath = documentSnapshot.data().storagePath
    return (
      typeof storagePath === 'string' &&
      storagePath.startsWith(`accounting/${scope.franchiseeId}/${scope.storeId}/`)
    )
  }).length
}

const countBrowserTemporaryItems = () => {
  let count = 0
  for (const key of browserStorageKeysToClear) {
    if (typeof window === 'undefined') {
      continue
    }
    if (window.localStorage.getItem(key) || window.sessionStorage.getItem(key)) {
      count += 1
    }
  }
  return count
}

export const isPreOpeningResetConfirmationValid = (value: string) =>
  value.trim() === RESET_CONFIRMATION_TEXT

export const summarizeCategoryCounts = (
  collectionCounts: Record<string, number>,
  browserTemporaryData: number,
  reservationApiRecords: number,
  storageFiles: number,
): PreOpeningDataCategoryCounts => ({
  browserTemporaryData,
  reservationApiRecords,
  tripsAndSales:
    (collectionCounts.caseRecords ?? 0) +
    (collectionCounts.workSessions ?? 0) +
    (collectionCounts.staffAttendance ?? 0) +
    (collectionCounts.caseCounters ?? 0),
  accounting:
    (collectionCounts.accountingExpenses ?? 0) +
    (collectionCounts.accountingReceipts ?? 0) +
    (collectionCounts.accountingAdjustments ?? 0) +
    (collectionCounts.accountingExports ?? 0) +
    (collectionCounts.accountingSales ?? 0) +
    (collectionCounts.accountingSettlementAuxiliary ?? 0) +
    (collectionCounts.accountingFixedAssets ?? 0),
  storageFiles,
})

export async function loadReservationPreOpeningDeleteCapability(): Promise<ReservationApiDeleteCapability> {
  return checkReservationPreOpeningDeleteCapability()
}

export async function countPreOpeningBusinessData(
  scope: TenantScope,
): Promise<PreOpeningDataCategoryCounts> {
  const collectionCounts: Record<string, number> = {}

  for (const collectionName of tenantScopedCollections.tripsAndSales) {
    if (collectionName === 'caseCounters') {
      collectionCounts.caseCounters = await countCaseCounters(scope)
      continue
    }
    collectionCounts[collectionName] = await countTenantCollection(collectionName, scope)
  }

  for (const collectionName of tenantScopedCollections.accounting) {
    collectionCounts[collectionName] = await countTenantCollection(collectionName, scope)
  }

  const [storageFiles, browserTemporaryData, reservationApiRecords] = await Promise.all([
    countReceiptStorageFiles(scope),
    Promise.resolve(countBrowserTemporaryItems()),
    countTenantReservationsFromApi(scope).catch(() => 0),
  ])

  return summarizeCategoryCounts(
    collectionCounts,
    browserTemporaryData,
    reservationApiRecords,
    storageFiles,
  )
}

export const clearPreOpeningBrowserTemporaryData = () => {
  if (typeof window === 'undefined') {
    return 0
  }

  let clearedCount = 0
  for (const key of browserStorageKeysToClear) {
    if (window.localStorage.getItem(key)) {
      window.localStorage.removeItem(key)
      clearedCount += 1
    }
    if (window.sessionStorage.getItem(key)) {
      window.sessionStorage.removeItem(key)
      clearedCount += 1
    }
  }
  return clearedCount
}

export async function executePreOpeningBusinessDataReset({
  franchiseeId,
  storeId,
  executedBy,
  executedByName,
  confirmText,
}: TenantScope & {
  executedBy: string
  executedByName: string
  confirmText: string
}): Promise<PreOpeningDataResetResult> {
  const reservationDeleteResult = await deleteTenantReservationsPreOpening({
    franchiseeId,
    storeId,
    confirmText,
    executedBy,
  })

  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const resetCallable = httpsCallable<ResetCallableRequest, ResetCallableResponse>(
    functions,
    'resetPreOpeningBusinessData',
  )

  const response = await resetCallable({
    franchiseeId,
    storeId,
    executedBy,
    executedByName,
  })

  const clearedBrowserItems = clearPreOpeningBrowserTemporaryData()
  const deletedCounts: PreOpeningDataCategoryCounts = {
    browserTemporaryData: clearedBrowserItems,
    reservationApiRecords: reservationDeleteResult.deletedCount,
    tripsAndSales: response.data.deletedCounts.trips ?? 0,
    accounting: response.data.deletedCounts.accounting ?? 0,
    storageFiles: response.data.deletedCounts.storageFiles ?? 0,
  }

  return {
    deletedCounts,
    deletedByCollection: response.data.deletedByCollection,
    clearedBrowserItems,
    deletedReservationApiRecords: reservationDeleteResult.deletedCount,
    reservationApiDeleteSkipped: reservationDeleteResult.skipped,
    reservationApiDeleteMessage: reservationDeleteResult.message,
    failedItems: response.data.failedItems ?? [],
    preservedSettings: response.data.preservedSettings ?? true,
  }
}
