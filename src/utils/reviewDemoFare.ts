import type { StoredCaseRecord } from '../services/caseRecords'
import type { FareBreakdown } from '../services/fare'
import {
  REVIEW_DEMO_ASSIST_FEE_YEN,
  REVIEW_DEMO_PRE_FIXED_FARE_YEN,
  REVIEW_DEMO_SCHEDULED_AT,
  REVIEW_DEMO_TOTAL_FARE_YEN,
} from '../fixtures/reviewDemoPreFixedFare'

export const REVIEW_DEMO_FARE_COMPOSITION_NOTE =
  '事前確定運賃3,740円に、介助料金1,100円を加算した合計額です。'

export const isReviewDemoCaseRecord = (caseRecord: { id: string }) =>
  caseRecord.id.startsWith('review-demo-')

/** 審査用デモ領収書の利用日は予約日時、通常モードは案件終了日時 */
export function resolveReceiptServiceDateIso(caseRecord: StoredCaseRecord): string {
  return isReviewDemoCaseRecord(caseRecord) ? REVIEW_DEMO_SCHEDULED_AT : caseRecord.closedAt
}

export function buildReviewDemoFixedFareBreakdown(
  baseBreakdown: FareBreakdown,
): FareBreakdown {
  const extraRoute = Math.max(baseBreakdown.additionalRouteFareYen ?? 0, 0)
  const extraCare = Math.max(baseBreakdown.careOptionFareYen ?? 0, 0)
  const extraWaiting = baseBreakdown.waitingFareYen + baseBreakdown.escortFareYen
  const extraExpense = baseBreakdown.expenseFareYen
  const otherChargesYen = extraRoute + extraCare + extraWaiting + extraExpense

  const lineItems: FareBreakdown['lineItems'] = [
    { label: '事前確定運賃', amountYen: REVIEW_DEMO_PRE_FIXED_FARE_YEN },
    { label: '介助料金', amountYen: REVIEW_DEMO_ASSIST_FEE_YEN },
  ]

  if (extraRoute > 0) {
    lineItems.push({ label: '追加区間運賃', amountYen: extraRoute })
  }
  if (extraCare > 0) {
    lineItems.push({ label: '追加介助料', amountYen: extraCare })
  }
  if (extraWaiting > 0) {
    lineItems.push({ label: '待機/付き添い料金', amountYen: extraWaiting })
  }
  if (extraExpense > 0) {
    lineItems.push({ label: '実費', amountYen: extraExpense })
  }

  const discountableFareYen = REVIEW_DEMO_PRE_FIXED_FARE_YEN
  const discountedBaseFareYen = Math.max(
    discountableFareYen - baseBreakdown.disabilityDiscountAmount,
    0,
  )
  const totalFareYen = Math.max(
    discountedBaseFareYen -
      baseBreakdown.taxiTicketAmountYen +
      REVIEW_DEMO_ASSIST_FEE_YEN +
      otherChargesYen,
    0,
  )

  return {
    ...baseBreakdown,
    basicFareYen: REVIEW_DEMO_PRE_FIXED_FARE_YEN + extraRoute,
    normalFareYen: REVIEW_DEMO_PRE_FIXED_FARE_YEN + extraRoute,
    careOptionFareYen: REVIEW_DEMO_ASSIST_FEE_YEN + extraCare,
    additionalCareFareYen: extraCare,
    grossFareYen: REVIEW_DEMO_TOTAL_FARE_YEN + otherChargesYen,
    discountableFareYen,
    totalFareYen,
    lineItems,
    originalConfirmedFareYen: REVIEW_DEMO_PRE_FIXED_FARE_YEN,
  }
}
