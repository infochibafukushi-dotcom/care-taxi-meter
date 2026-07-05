import type { WorkSession } from '../types/work'

export const REVIEW_DEMO_BANNER_TEXT =
  '審査用デモ：本番運行記録・売上・通知には保存されません'

export const REVIEW_DEMO_SCENARIO_PRE_FIXED_FARE = 'pre-fixed-fare-demo'

export const REVIEW_DEMO_RESERVATION_ID = 'PF-REVIEW-001'

export const REVIEW_DEMO_VEHICLE_ID = 'demo-vehicle'

export type ReviewDemoSearchParams = {
  pathname: string
  search: string
}

export const parseReviewDemoSearch = (search: string) => new URLSearchParams(search)

export const isReviewDemoQueryActive = (search: string) =>
  parseReviewDemoSearch(search).get('reviewDemo') === '1'

export const isReviewDemoPathActive = (pathname: string) =>
  pathname.startsWith('/review-demo')

export const isReviewDemoActive = ({ pathname, search }: ReviewDemoSearchParams) =>
  isReviewDemoPathActive(pathname) || isReviewDemoQueryActive(search)

export const isPreFixedFareReviewDemoScenario = (search: string) => {
  const scenario = parseReviewDemoSearch(search).get('scenario')?.trim()
  return !scenario || scenario === REVIEW_DEMO_SCENARIO_PRE_FIXED_FARE
}

export const buildReviewDemoSearch = () =>
  `reviewDemo=1&scenario=${encodeURIComponent(REVIEW_DEMO_SCENARIO_PRE_FIXED_FARE)}`

export const withReviewDemoSearch = (path: string) => {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${buildReviewDemoSearch()}`
}

export const REVIEW_DEMO_COMPANY_NAME = '株式会社 千葉福祉サポート'
export const REVIEW_DEMO_STORE_NAME = 'ちばケアタクシー'
export const REVIEW_DEMO_DRIVER_NAME = '審査用デモ乗務員'
export const REVIEW_DEMO_VEHICLE_NAME = '審査用デモ車両'

export const REVIEW_DEMO_PICKUP_ADDRESS = '中央区出洲港8-3-2'
export const REVIEW_DEMO_DESTINATION_ADDRESS = '千葉メディカルセンター'

/** 千葉港付近の固定座標（GPS未使用デモ用） */
export const REVIEW_DEMO_PICKUP_COORDINATES = {
  latitude: 35.5774,
  longitude: 140.1225,
}

export const REVIEW_DEMO_DESTINATION_COORDINATES = {
  latitude: 35.6328,
  longitude: 140.1532,
}

export const REVIEW_DEMO_WORK_SESSION: WorkSession = {
  id: 'review-demo-work-session',
  staffId: 'review-demo-driver',
  staffName: REVIEW_DEMO_DRIVER_NAME,
  staffRole: 'driver',
  companyId: 'review-demo-company',
  franchiseeId: 'review-demo-company',
  companyName: REVIEW_DEMO_COMPANY_NAME,
  storeId: 'review-demo-store',
  storeName: REVIEW_DEMO_STORE_NAME,
  status: 'working',
  clockInAt: '2026-09-01T09:00:00+09:00',
  clockOutAt: null,
  clockInLatitude: REVIEW_DEMO_PICKUP_COORDINATES.latitude,
  clockInLongitude: REVIEW_DEMO_PICKUP_COORDINATES.longitude,
  clockInAccuracy: 0,
  clockOutLatitude: null,
  clockOutLongitude: null,
  clockOutAccuracy: null,
  workSeconds: 0,
}

export const REVIEW_DEMO_CASE_NUMBER_PREFIX = 'DEMO'

let reviewDemoRuntimeEnabled = false

export const setReviewDemoRuntimeEnabled = (enabled: boolean) => {
  reviewDemoRuntimeEnabled = enabled
}

export const isReviewDemoRuntimeEnabled = () => reviewDemoRuntimeEnabled

export const assertNotReviewDemoWrite = (operation: string) => {
  if (reviewDemoRuntimeEnabled) {
    throw new Error(`Review demo mode blocked production write: ${operation}`)
  }
}
