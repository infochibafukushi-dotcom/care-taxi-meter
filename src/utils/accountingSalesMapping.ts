import type { StoredCaseRecord } from '../services/caseRecords'
import type { SalesCategoryBreakdown } from '../types/accounting'
import { SALES_CATEGORIES } from '../types/accounting'
import { getActualFareYen, getBillableCaseRecords, isCanceledCaseRecord } from './caseRecords'

const toYen = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(Math.round(value), 0) : 0

export const isConfirmedCaseRecordForAccounting = (caseRecord: StoredCaseRecord) =>
  !isCanceledCaseRecord(caseRecord) &&
  !caseRecord.deleted &&
  (caseRecord.status === 'completed' || caseRecord.status === 'completed_with_passenger_change')

export const getAccountingEligibleCaseRecords = (caseRecords: StoredCaseRecord[]) =>
  getBillableCaseRecords(caseRecords).filter(isConfirmedCaseRecordForAccounting)

export const createEmptySalesBreakdown = (): SalesCategoryBreakdown =>
  SALES_CATEGORIES.reduce((breakdown, category) => {
    breakdown[category] = 0
    return breakdown
  }, {} as SalesCategoryBreakdown)

export const mapCaseRecordToSalesBreakdown = (caseRecord: StoredCaseRecord): SalesCategoryBreakdown => {
  const breakdown = createEmptySalesBreakdown()
  const isPreFixedMeter =
    caseRecord.meterMode === 'fixed' || caseRecord.fareMode === 'pre_fixed_fare'

  if (isPreFixedMeter) {
    // 事前確定M: basicFareYen に追加区間運賃を含む。careOptionFareYen に customFee 等を含む。
    breakdown['運賃収入'] = toYen(caseRecord.basicFareYen)
    breakdown['介助料収入'] =
      toYen(caseRecord.careOptionFareYen) +
      toYen(caseRecord.waitingFareYen) +
      toYen(caseRecord.escortFareYen)
    breakdown['機材利用料収入'] = toYen(caseRecord.specialVehicleFareYen)
    breakdown['ストック'] = 0
    breakdown['その他売上'] = toYen(caseRecord.expenseFareYen)
    return breakdown
  }

  breakdown['運賃収入'] =
    toYen(caseRecord.basicFareYen) +
    toYen(caseRecord.meterTimeFareYen) +
    toYen(caseRecord.waitingFareYen) +
    toYen(caseRecord.nightSurchargeYen) +
    toYen(caseRecord.dispatchFareYen) +
    toYen(caseRecord.additionalRouteFareYen)

  breakdown['介助料収入'] =
    toYen(caseRecord.escortFareYen) +
    toYen(caseRecord.careOptionFareYen) +
    toYen(caseRecord.additionalCareFareYen)
  breakdown['機材利用料収入'] = toYen(caseRecord.specialVehicleFareYen)
  // ストック: 初期版ではメーター案件から自動取得しない（手動売上・将来のFC契約データ用）
  breakdown['ストック'] = 0
  // customFeeFareYen はメーター上「その他」料金。FC月額/ストックの根拠はないためその他売上へ。
  // expenseFareYen は立替実費の回収。初期版では売上「その他売上」に含める（後述の整合性注意あり）。
  breakdown['その他売上'] = toYen(caseRecord.customFeeFareYen) + toYen(caseRecord.expenseFareYen)

  return breakdown
}

export const mergeSalesBreakdowns = (
  left: SalesCategoryBreakdown,
  right: SalesCategoryBreakdown,
): SalesCategoryBreakdown => {
  const merged = createEmptySalesBreakdown()

  SALES_CATEGORIES.forEach((category) => {
    merged[category] = left[category] + right[category]
  })

  return merged
}

export const sumSalesBreakdown = (breakdown: SalesCategoryBreakdown) =>
  SALES_CATEGORIES.reduce((total, category) => total + breakdown[category], 0)

export type AccountingSalesRow = {
  caseRecordId: string
  caseNumber: string
  closedAt: string
  storeName: string
  staffName: string
  totalFareYen: number
  breakdown: SalesCategoryBreakdown
}

export const buildAccountingSalesRows = (caseRecords: StoredCaseRecord[]): AccountingSalesRow[] =>
  getAccountingEligibleCaseRecords(caseRecords).map((caseRecord) => ({
    caseRecordId: caseRecord.id,
    caseNumber: caseRecord.caseNumber,
    closedAt: caseRecord.closedAt,
    storeName: caseRecord.storeName,
    staffName: caseRecord.staffName,
    totalFareYen:
      typeof caseRecord.actualFareYen === 'number' && Number.isFinite(caseRecord.actualFareYen)
        ? caseRecord.actualFareYen
        : caseRecord.totalFareYen,
    breakdown: mapCaseRecordToSalesBreakdown(caseRecord),
  }))

export const aggregateSalesBreakdown = (caseRecords: StoredCaseRecord[]) =>
  getAccountingEligibleCaseRecords(caseRecords).reduce(
    (total, caseRecord) => mergeSalesBreakdowns(total, mapCaseRecordToSalesBreakdown(caseRecord)),
    createEmptySalesBreakdown(),
  )

export const getYearMonthFromIso = (isoString: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  return `${year}-${month}`
}

export const filterCaseRecordsByYearMonth = (caseRecords: StoredCaseRecord[], targetYearMonth: string) =>
  getAccountingEligibleCaseRecords(caseRecords).filter(
    (caseRecord) => getYearMonthFromIso(caseRecord.closedAt) === targetYearMonth,
  )

export type SalesIntegrityCheck = {
  meterBillingTotalYen: number
  plSalesTotalYen: number
  differenceYen: number
}

export const calculateSalesIntegrityCheck = ({
  caseRecords,
  plSalesTotalYen,
}: {
  caseRecords: StoredCaseRecord[]
  plSalesTotalYen: number
}): SalesIntegrityCheck => {
  const meterBillingTotalYen = caseRecords.reduce(
    (total, caseRecord) => total + getActualFareYen(caseRecord),
    0,
  )

  return {
    meterBillingTotalYen,
    plSalesTotalYen,
    differenceYen: plSalesTotalYen - meterBillingTotalYen,
  }
}

export const sumExpenseFareYenFromCaseRecords = (caseRecords: StoredCaseRecord[]) =>
  caseRecords.reduce((total, caseRecord) => total + toYen(caseRecord.expenseFareYen), 0)

export const SALES_INTEGRITY_WARNING =
  'メーター請求額とPL売上合計に差額があります。割引・タクシー券・実費・調整行の扱いを確認してください。'

export const EXPENSE_FARE_SALES_WARNING =
  '実費回収を売上に含める場合、同じ駐車場代・有料道路代等を経費入力すると二重計上になる可能性があります。'
