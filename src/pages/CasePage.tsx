import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Dispatch, SetStateAction } from 'react'
import { FareBreakdownPanel as MeterFareBreakdownPanel } from '../components/case/FareBreakdownPanel'
import { GpsPanel } from '../components/case/GpsPanel'
import { KeypadModal } from '../components/case/KeypadModal'
import { MeterBlackoutOverlay } from '../components/case/MeterBlackoutOverlay'
import { ObdConnectionIndicator } from '../components/case/ObdConnectionIndicator'
import { ObdConnectionRequiredDialog } from '../components/case/ObdConnectionRequiredDialog'
import { ObdConnectFab } from '../components/case/ObdConnectFab'
import { PostSettlementBanner } from '../components/case/PostSettlementBanner'
import { PassengerChangePostSettlementBanner } from '../components/case/PassengerChangePostSettlementBanner'
import { PreFixedFareConfirmedRouteDialog } from '../components/case/PreFixedFareConfirmedRouteDialog'
import { PreFixedFarePassengerChangeDialog } from '../components/case/PreFixedFarePassengerChangeDialog'
import { PreFixedFareRouteChangeDialog } from '../components/case/PreFixedFareRouteChangeDialog'
import { WaitingMovementAlert } from '../components/case/WaitingMovementAlert'
import { SettlementPanel } from '../components/case/SettlementPanel'
import { TopReturnFab } from '../components/case/TopReturnFab'
import { useMeterBlackout } from '../hooks/useMeterBlackout'
import { useNightPeriodAccumulator } from '../hooks/useNightPeriodAccumulator'
import { useMeterTelemetry } from '../hooks/useMeterTelemetry'
import { useWaitingMovementAlert } from '../hooks/useWaitingMovementAlert'
import { isFirebaseConfigured } from '../lib/firebase'
import { useOperationTimers } from '../hooks/useOperationTimers'
import type { TimerSeconds } from '../hooks/useOperationTimers'
import { useWorkSession } from '../hooks/useWorkSession'
import {
  basicFareSettings,
  buildFixedFareBreakdown,
  calculateFareBreakdown,
  calculateFareIncreaseProgress,
  calculateTimeFareIncreaseProgress,
  careOptionMaster,
  escortFareSettings,
  formatFareYen,
  waitingFareSettings,
} from '../services/fare'
import { fetchCaseRecord, generateCaseNumber, saveCaseRecord } from '../services/caseRecords'
import { saveGpsRoute } from '../services/gpsRoutes'
import { fetchCompanyById, getCompanyMeterPermissions } from '../services/companies'
import { updateWorkSessionActiveTrip } from '../services/workSessions'
import { createAuditLog } from '../services/auditLogs'
import {
  applyActiveTripRestoration,
  clearActiveTripSnapshot,
  getActiveTripSnapshotElapsedSeconds,
  readActiveTripSnapshot,
  saveActiveTripSnapshot,
} from '../services/activeTripSnapshot'
import type { ActiveTripSnapshot, TimerStartedAtMap } from '../services/activeTripSnapshot'
import {
  clearPostSettlementLock,
  readPostSettlementLock,
  writePostSettlementLock,
} from '../services/postSettlementLock'
import { readReservationTripContext, clearReservationTripContext } from '../services/reservationTripContext'
import type { ReservationTripContext } from '../services/reservationTripContext'
import {
  buildConfirmedRouteStops,
  buildConfirmedRouteView,
  formatRoutePathLabel,
  getCurrentSegmentStops,
  openGoogleMapsNavigation,
} from '../services/preFixedFareRoute'
import { completeFixedFareRun } from '../services/reservationApi'
import { waitForFirebaseAuthUser } from '../services/firebaseAuth'
import {
  claimVehicleForCaseStart,
  releaseVehicleFromCase,
  VEHICLE_IN_USE_MESSAGE,
} from '../services/vehicleAvailability'
import { getSelectableVehicles } from '../services/vehicles'
import type { CaseNumberAssignment, FareSnapshot, StoredCaseRecord } from '../services/caseRecords'
import {
  defaultMeterSettings,
  fetchMeterSettings,
  fixedTimeFareUnitSeconds,
  selectMeterModeSettings,
  subscribeMeterSettings,
} from '../services/meterSettings'
import { calculateMeterComparisonFares } from '../services/meterComparisonFare'
import { calculateTimeMeterFareIncreaseProgress, formatTimeMeterFareIncreaseProgressLabel } from '../services/timeMeterFare'
import {
  defaultMeterPermissions,
  getAllowedMeterModes,
  isMeterModeAllowed,
} from '../services/subscriptionPlans'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  DispatchMenuItem,
  SpecialVehicleMenuItem,
  TimeFareSettings,
} from '../services/fare'
import type { ExpensePreset, MeterSettings } from '../services/meterSettings'
import type { MeterPermissions, Vehicle } from '../types/work'
import {
  FARE_MODE_PRE_FIXED,
  PRE_FIXED_FARE_PASSENGER_CHANGE_NOTE,
  PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
  buildCompleteFixedFareRunPayload,
  type PreFixedFareException,
} from '../types/preFixedFare'
import type {
  PreFixedFareRouteChangeLog,
  PreFixedFareRouteStop,
} from '../types/preFixedFareRouteChange'
import { tenantScopeFromSession } from '../services/tenancy'
import { extractAreaFromAddress } from '../utils/address'
import { formatCaseDateTime } from '../utils/caseRecords'
import { defaultMidnightEarlyMorningSettings } from '../utils/nightSurcharge'
import {
  createEmptyPaymentAmounts,
  isProtectedOperationStatus,
  meterModeLabels,
  resolveRawMeterMode,
  resolveMeterSettingsMode,
  writeStoredMeterMode,
} from '../utils/meterConstants'
import { downloadReceiptPdf } from '../utils/receiptPdf'
import { formatTimerClock } from '../utils/time'
import { buildThermalReceiptEscPos } from '../utils/thermalReceiptEscPos'
import { downloadThermalReceiptPdf, openThermalReceiptPdf } from '../utils/thermalReceiptPdf'
import { thermalPrinterService } from '../services/escPosPrinterConnection'
import type { EscPosConnectionStageDiagnostic } from '../services/escPosPrinterConnection'
import {
  captureAddressLocationFromCoordinates,
  captureCurrentAddressLocation,
  emptyCapturedAddressLocation,
  getReverseGeocodeDiagnosticState,
  subscribeReverseGeocodeDiagnostic,
} from '../utils/reverseGeocode'
import type {
  CapturedAddressLocation,
  ReverseGeocodeDiagnosticState,
} from '../utils/reverseGeocode'
import type {
  ActivityHistoryEntry,
  ActivityHistoryType,
  ExpenseItem,
  MeterMode,
  OperationStatus,
  PaymentAllocation,
  PaymentMethod,
  GpsPosition,
  CustomFeeItem,
  SelectedCareOption,
  TaxiTicket,
  StatusTone,
  TimerKey,
} from '../types/case'
import { getReviewDemoMeterSettings } from '../services/reviewDemoMeterSettings'
import {
  buildReviewDemoSavedCaseRecord,
  createReviewDemoCaseNumberAssignment,
  REVIEW_DEMO_VEHICLE,
} from '../services/reviewDemoCaseRecord'
import { markReviewDemoRunCompleted } from '../services/reviewDemoRunState'
import {
  clearReviewDemoActiveTripSnapshot,
  clearReviewDemoReservationTripContext,
  readReviewDemoActiveTripSnapshot,
  readReviewDemoPostSettlementLock,
  readReviewDemoReservationTripContext,
  saveReviewDemoActiveTripSnapshot,
  writeReviewDemoPostSettlementLock,
} from '../services/reviewDemoStorage'
import {
  captureReviewDemoCurrentLocation,
  captureReviewDemoDropoffLocation,
  captureReviewDemoPickupLocation,
} from '../utils/reviewDemoLocation'
import {
  REVIEW_DEMO_RESERVATION_ID,
  REVIEW_DEMO_VEHICLE_ID,
  REVIEW_DEMO_WORK_SESSION,
  withReviewDemoSearch,
} from '../utils/reviewDemo'
import {
  REVIEW_DEMO_FARE_COMPOSITION_NOTE,
  buildReviewDemoFixedFareBreakdown,
} from '../utils/reviewDemoFare'

type KeypadTarget = {
  amountYen: number
  mode: 'care' | 'customFee' | 'expense'
  name: string
  sourceId?: string
}

type InputHistory = {
  amountYen: number
  id: string
  mode: 'care' | 'customFee' | 'expense'
  name: string
}


const formatPrinterConnectionStageLabel = (stage: EscPosConnectionStageDiagnostic) => {
  const statusLabel =
    stage.status === 'success' ? '成功' : stage.status === 'skipped' ? 'スキップ' : '失敗'

  return `${stage.stage} (${stage.connectionMethod}): ${statusLabel} - ${stage.detail}`
}

const isPrinterConnectionFailureMessage = (message: string) =>
  message.includes('プリンター接続')

type CaseSaveState = 'error' | 'idle' | 'saved' | 'saving'
type SettlementFlowStep = 'receipt' | 'saved'

const inputHistoryStorageKey = 'careTaxiMeterInputHistory'
const isDevelopmentMode = import.meta.env.DEV
const paymentMethods: PaymentMethod[] = ['現金', 'クレジット', 'QR決済', '請求書', 'その他']
const emptyTimerSeconds: TimerSeconds = {
  accompanying: 0,
  driving: 0,
  waiting: 0,
}
const emptyActivityHistories: ActivityHistoryEntry[] = []

const statusToneMap: Record<OperationStatus, StatusTone> = {
  空車: 'vacant',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
  走行中: 'driving',
  精算前: 'settlement',
  精算修正: 'settlement',
  案件終了: 'closed',
}

const activeTimerMap: Partial<Record<OperationStatus, TimerKey>> = {
  走行中: 'driving',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
}

let lastRestorationDecision: {
  caseNumber: string
  capturedAt: string
  shouldApplyElapsed: boolean
} | null = null

type RestoredTripState = {
  elapsedSeconds: number
  shouldBridgeGpsDistance: boolean
  snapshot: ActiveTripSnapshot | null
}

const resolveActiveTripRestoration = (snapshot: ActiveTripSnapshot | null): RestoredTripState => {
  if (!snapshot) {
    return { elapsedSeconds: 0, shouldBridgeGpsDistance: false, snapshot: null }
  }

  const offlineSeconds = getActiveTripSnapshotElapsedSeconds(snapshot)
  const isActivityTimer =
    snapshot.activeTimer === 'waiting' || snapshot.activeTimer === 'accompanying'
  const cachedDecision = lastRestorationDecision &&
    lastRestorationDecision.caseNumber === snapshot.caseNumber &&
    lastRestorationDecision.capturedAt === snapshot.capturedAt
      ? lastRestorationDecision
      : null

  let shouldApplyElapsed: boolean
  if (cachedDecision) {
    shouldApplyElapsed = cachedDecision.shouldApplyElapsed
  } else if (offlineSeconds <= 600) {
    shouldApplyElapsed = true
  } else if (isActivityTimer) {
    const activityLabel = snapshot.activeTimer === 'waiting' ? '待機' : '付き添い'
    shouldApplyElapsed = window.confirm(
      `${activityLabel}中のまま一定時間が経過しています。閉じていた時間も${activityLabel}時間として加算しますか？\n\n「OK」で加算して復元、「キャンセル」で加算せずに復元します。`,
    )
  } else {
    shouldApplyElapsed =
      offlineSeconds <= 1800
        ? window.confirm(
            `未終了の運行データがあります。前回保存から${Math.floor(offlineSeconds / 60)}分経過しています。復元までの時間を運行に加算しますか？`,
          )
        : false
  }

  lastRestorationDecision = {
    caseNumber: snapshot.caseNumber,
    capturedAt: snapshot.capturedAt,
    shouldApplyElapsed,
  }

  const restoredSnapshot = applyActiveTripRestoration(snapshot, shouldApplyElapsed)

  return {
    elapsedSeconds: offlineSeconds,
    // Distance is never bridged for waiting / accompanying; only while driving.
    shouldBridgeGpsDistance:
      shouldApplyElapsed && snapshot.status === '走行中' && Boolean(snapshot.gps.position),
    snapshot: restoredSnapshot,
  }
}

const loadInputHistory = () => {
  try {
    const historyJson = localStorage.getItem(inputHistoryStorageKey)
    return historyJson ? (JSON.parse(historyJson) as InputHistory[]) : []
  } catch {
    return []
  }
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`

const activityStatusMap: Record<ActivityHistoryType, OperationStatus> = {
  accompanying: '院内付き添い中',
  waiting: '待機中',
}

const statusActivityMap: Partial<Record<OperationStatus, ActivityHistoryType>> = {
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
}

const getActivityLabel = (type: ActivityHistoryType) =>
  type === 'waiting' ? '待機' : '付き添い'

const formatDateTimeLocalValue = (isoString: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 16)
}

const activityTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
})

const formatActivityClock = (isoString: string) => {
  const date = new Date(isoString)
  return Number.isNaN(date.getTime()) ? '--:--' : activityTimeFormatter.format(date)
}

const parseDateTimeLocalValue = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const calculateActivityHistorySeconds = (
  histories: ActivityHistoryEntry[],
  type: ActivityHistoryType,
) =>
  histories
    .filter((history) => history.type === type && history.startAt && history.endAt)
    .reduce((totalSeconds, history) => {
      const startAt = new Date(history.startAt).getTime()
      const endAt = new Date(history.endAt).getTime()
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return totalSeconds
      }
      return totalSeconds + Math.floor((endAt - startAt) / 1000)
    }, 0)

const calculateActivityHistoryMinutes = (history: ActivityHistoryEntry) => {
  const seconds = calculateActivityHistorySeconds([history], history.type)
  return Math.max(Math.round(seconds / 60), 0)
}

const createRestoredActivityHistories = (
  snapshot: ActiveTripSnapshot | null | undefined,
): ActivityHistoryEntry[] => {
  if (!snapshot) {
    return []
  }
  return snapshot.activityHistories
}

const createRestoredActiveActivity = (
  snapshot: ActiveTripSnapshot | null | undefined,
): ActivityHistoryEntry | null => {
  if (!snapshot) {
    return null
  }

  const activityType = statusActivityMap[snapshot.status]
  if (!activityType) {
    return null
  }

  const startedAtFromTimer = snapshot.timerStartedAt?.[activityType]
  if (startedAtFromTimer) {
    return {
      endAt: '',
      id: createId(`activity-${activityType}`),
      startAt: startedAtFromTimer,
      type: activityType,
    }
  }

  // Legacy snapshots without timerStartedAt: derive start from restored timer totals.
  const closedSeconds = calculateActivityHistorySeconds(snapshot.activityHistories, activityType)
  const segmentSeconds = Math.max(snapshot.timers[activityType] - closedSeconds, 0)
  const startAt =
    segmentSeconds > 0
      ? new Date(Date.now() - segmentSeconds * 1000).toISOString()
      : new Date().toISOString()

  return {
    endAt: '',
    id: createId(`activity-${activityType}`),
    startAt,
    type: activityType,
  }
}

const toPositiveNumber = (value: string, minimum = 0) =>
  Math.max(Number(value) || minimum, minimum)

const createFareSnapshot = ({
  assistItems,
  basicFare,
  dispatchMenuItems,
  escortFare,
  expensePresets,
  meterSettings,
  specialVehicleMenuItems,
  waitingFare,
}: {
  assistItems: CareOptionMasterItem[]
  basicFare: BasicFareSettings
  dispatchMenuItems: DispatchMenuItem[]
  escortFare: TimeFareSettings
  expensePresets: ExpensePreset[]
  meterSettings: MeterSettings
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  waitingFare: TimeFareSettings
}): FareSnapshot => ({
  assistItems: assistItems.map((item) => ({ ...item })),
  basicFare: { ...basicFare },
  capturedAt: new Date().toISOString(),
  disabilityDiscount: {
    appliesTo: ['basicFare', 'meterTimeFare'],
    discountRate: meterSettings.discount.method === 'percentage' ? meterSettings.discount.value / 100 : 0,
    enabled: true,
    rounding: 'floorToTenYen',
  },
  dispatchMenuItems: dispatchMenuItems.map((item) => ({ ...item })),
  escortFare: { ...escortFare },
  expensePresets: expensePresets.map((preset, index) => ({
    ...preset,
    amount: preset.defaultAmountYen,
    enabled: true,
    sortOrder: index + 1,
  })),
  meterTimeFare: { ...meterSettings.meterTimeFare },
  midnightEarlyMorning: {
    appliesTo: ['basicFare'],
    enabled: defaultMidnightEarlyMorningSettings.enabled,
    endTime: defaultMidnightEarlyMorningSettings.endTime,
    startTime: defaultMidnightEarlyMorningSettings.startTime,
    surchargeRate: defaultMidnightEarlyMorningSettings.surchargeRate,
  },
  specialVehicleMenuItems: specialVehicleMenuItems.map((item) => ({ ...item })),
  taxiVoucher: {
    multipleAllowed: true,
    storesMunicipalityName: true,
    storesVoucherNumber: true,
  },
  timeSpecificFare: {
    enabled: false,
    fixedFareYen: 0,
    timeBands: [],
  },
  waitingFare: { ...waitingFare },
})

const getReverseGeocodeCauseLabel = ({
  diagnostic,
  dropoffLocation,
  pickupLocation,
}: {
  diagnostic: ReverseGeocodeDiagnosticState
  dropoffLocation: CapturedAddressLocation
  pickupLocation: CapturedAddressLocation
}) => {
  if (!diagnostic.reverseGeocodeCalled) {
    return 'E: reverseGeocodeWithGoogle() 未実行'
  }

  if (diagnostic.errorMessage.includes('VITE_GOOGLE_MAPS_API_KEY')) {
    return 'A: APIキー未設定'
  }

  if (
    /RefererNotAllowedMapError|InvalidKeyMapError|ApiTargetBlockedMapError/.test(
      diagnostic.errorMessage,
    )
  ) {
    return 'B: APIキー制限'
  }

  if (/ApiNotActivatedMapError/.test(diagnostic.errorMessage)) {
    return 'C: Maps JavaScript API無効'
  }

  if (diagnostic.googleMapsApiLoadState === '失敗') {
    return 'H: Google Maps APIロード失敗（エラー詳細確認）'
  }

  if (diagnostic.geocoderState === '生成失敗') {
    return 'C: Maps JavaScript API / Geocoder生成失敗'
  }

  if (!diagnostic.geocodeCalled) {
    return 'E: geocode() 未実行'
  }

  if (diagnostic.geocodingExecutionState === '0件') {
    return 'F: Googleレスポンス0件'
  }

  if (
    diagnostic.geocodingExecutionState === 'タイムアウト' ||
    /timed out/i.test(diagnostic.errorMessage)
  ) {
    return 'H: geocoder.geocode() Promise/callbackタイムアウト'
  }

  if (diagnostic.geocodingExecutionState === '失敗') {
    if (/not authorized|REQUEST_DENIED|API project is not authorized/i.test(diagnostic.errorMessage)) {
      return 'D: Geocoding API無効'
    }

    return 'H: Geocoding失敗（エラー詳細確認）'
  }

  if (diagnostic.geocodingExecutionState === '住所空') {
    return 'H: Google結果の住所整形で空文字'
  }

  if (
    diagnostic.address &&
    !pickupLocation.address &&
    !dropoffLocation.address
  ) {
    return 'G: 取得後に画面反映失敗'
  }

  if (diagnostic.address) {
    return '住所取得成功'
  }

  return '未確定: 操作後の診断ログ待ち'
}

const getInitialStatusAfterReset = (mode: MeterMode): OperationStatus =>
  mode === 'time' ? '待機中' : '空車'

const buildPreFixedFarePassengerChangeException = (
  confirmedFareYen: number,
  position: { latitude: number; longitude: number; accuracy: number } | null,
): PreFixedFareException => ({
  type: 'passenger_requested_change',
  reasonLabel: PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
  endedAt: new Date().toISOString(),
  endedLocation: {
    lat: position?.latitude ?? null,
    lng: position?.longitude ?? null,
    accuracy: position?.accuracy ?? null,
  },
  originalFixedFareYen: confirmedFareYen,
  fareModeBeforeEnd: FARE_MODE_PRE_FIXED,
  nextOperationRequired: 'start_new_meter_trip',
  note: PRE_FIXED_FARE_PASSENGER_CHANGE_NOTE,
})

/** 事前確定M: 運行中に追加する介助オプション（元の確定運賃内の介助とは別明細） */
const PRE_FIXED_ADDITIONAL_CARE_PRESETS = [
  { id: 'additional-boarding', name: '追加乗降介助' },
  { id: 'store-escort', name: '店内付き添い' },
  { id: 'hospital-escort', name: '院内付き添い' },
  { id: 'stretcher-extra', name: 'ストレッチャー追加作業' },
] as const

const PRE_FIXED_EXPENSE_QUICK_PRESETS = [
  { id: 'parking', name: '駐車場代' },
  { id: 'toll', name: '有料道路代' },
  { id: 'facility', name: '施設利用料' },
  { id: 'other-advance', name: 'その他立替金' },
] as const

export function CasePage({ reviewDemoMode = false }: { reviewDemoMode?: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const vehicleIdFromQuery = searchParams.get('vehicleId') ?? (reviewDemoMode ? REVIEW_DEMO_VEHICLE_ID : '')
  const meterModeFromQuery = searchParams.get('meterMode')
  const reservationIdFromQuery =
    searchParams.get('reservationId')?.trim() ?? (reviewDemoMode ? REVIEW_DEMO_RESERVATION_ID : '')
  const sourceCaseRecordId = searchParams.get('caseRecordId') ?? ''
  const [reservationTripContext] = useState<ReservationTripContext | null>(() => {
    if (!reservationIdFromQuery) {
      return null
    }

    return reviewDemoMode
      ? readReviewDemoReservationTripContext(reservationIdFromQuery)
      : readReservationTripContext(reservationIdFromQuery)
  })
  const [restoredTripState] = useState(() => {
    const postSettlementLock = reviewDemoMode
      ? readReviewDemoPostSettlementLock()
      : readPostSettlementLock()
    const activeTripSnapshot = reviewDemoMode
      ? readReviewDemoActiveTripSnapshot()
      : readActiveTripSnapshot()

    if (postSettlementLock) {
      if (reviewDemoMode) {
        clearReviewDemoActiveTripSnapshot()
      } else {
        clearActiveTripSnapshot()
      }
      return { elapsedSeconds: 0, shouldBridgeGpsDistance: false, snapshot: null }
    }

    return resolveActiveTripRestoration(activeTripSnapshot)
  })
  const restoredTripSnapshot = restoredTripState.snapshot
  const [fixedFareRun, setFixedFareRun] = useState<{
    confirmedFareYen: number
    reservationId: string
    snapshotHash: string
  } | null>(() => {
    if (
      restoredTripSnapshot?.meterMode === 'fixed' &&
      typeof restoredTripSnapshot.reservationId === 'string' &&
      restoredTripSnapshot.reservationId
    ) {
      return {
        reservationId: restoredTripSnapshot.reservationId,
        confirmedFareYen:
          restoredTripSnapshot.confirmedFareYen ?? restoredTripSnapshot.fareTotalYen,
        snapshotHash: restoredTripSnapshot.snapshotHash ?? '',
      }
    }

    if (reservationTripContext) {
      return {
        reservationId: reservationTripContext.reservationId,
        confirmedFareYen: reservationTripContext.confirmedFareYen,
        snapshotHash: reservationTripContext.snapshotHash,
      }
    }

    return null
  })
  const [caseNumber, setCaseNumber] = useState(restoredTripSnapshot?.caseNumber ?? '未採番')
  const [, setIsFareSnapshotLocked] = useState(Boolean(restoredTripSnapshot?.fareSnapshot))
  const fareSnapshotRef = useRef<FareSnapshot | null>(restoredTripSnapshot?.fareSnapshot ?? null)
  const caseNumberAssignmentRef = useRef<CaseNumberAssignment | null>(
    restoredTripSnapshot?.caseNumberAssignment ?? null,
  )
  const [status, setStatus] = useState<OperationStatus>(restoredTripSnapshot?.status ?? '空車')
  const [activeTimer, setActiveTimer] = useState<TimerKey | null>(restoredTripSnapshot?.activeTimer ?? null)
  const [activityHistories, setActivityHistories] = useState<ActivityHistoryEntry[]>(
    createRestoredActivityHistories(restoredTripSnapshot) ?? emptyActivityHistories,
  )
  const [activeActivity, setActiveActivity] = useState<ActivityHistoryEntry | null>(() =>
    createRestoredActiveActivity(restoredTripSnapshot),
  )
  const [timerStartedAt, setTimerStartedAt] = useState<TimerStartedAtMap>(
    () => restoredTripSnapshot?.timerStartedAt ?? {},
  )
  const [billableTimeStarted, setBillableTimeStarted] = useState({
    accompanying: restoredTripSnapshot?.billableTimeStarted.accompanying ?? false,
    waiting: restoredTripSnapshot?.billableTimeStarted.waiting ?? false,
  })
  const [isGpsActive, setIsGpsActive] = useState(
    Boolean(restoredTripSnapshot) && restoredTripSnapshot?.meterMode !== 'fixed',
  )
  const [isCareModalOpen, setIsCareModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false)
  const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false)
  const [isBusinessDistanceVisible, setIsBusinessDistanceVisible] = useState(false)
  const [isSettlementFlowOpen, setIsSettlementFlowOpen] = useState(false)
  const [isSettlementConfirmOpen, setIsSettlementConfirmOpen] = useState(false)
  const [settlementEditBaseline, setSettlementEditBaseline] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [meterMode, setMeterMode] = useState<MeterMode>(() =>
    resolveRawMeterMode({
      queryMode: meterModeFromQuery,
      snapshotMeterMode: restoredTripSnapshot?.meterMode,
    }),
  )
  const [meterPermissions, setMeterPermissions] = useState<MeterPermissions>(defaultMeterPermissions)
  const [areMeterPermissionsLoaded, setAreMeterPermissionsLoaded] = useState(false)
  const [meterModeToast, setMeterModeToast] = useState('')
  const [tripStartNotice, setTripStartNotice] = useState('')
  const [isFixedCompleteLoading, setIsFixedCompleteLoading] = useState(false)
  const [fixedCompleteState, setFixedCompleteState] = useState<'idle' | 'done' | 'error'>('idle')
  const [isPassengerChangeDialogOpen, setIsPassengerChangeDialogOpen] = useState(false)
  const [pendingPassengerChangeException, setPendingPassengerChangeException] =
    useState<PreFixedFareException | null>(
      () => restoredTripSnapshot?.preFixedFareException ?? null,
    )
  const pendingPassengerChangeExceptionRef = useRef(pendingPassengerChangeException)
  pendingPassengerChangeExceptionRef.current = pendingPassengerChangeException
  const [isConfirmedRouteDialogOpen, setIsConfirmedRouteDialogOpen] = useState(false)
  const [isRouteChangeDialogOpen, setIsRouteChangeDialogOpen] = useState(false)
  const [isRouteChangePreStartDialogOpen, setIsRouteChangePreStartDialogOpen] = useState(false)
  const [additionalRouteFareYen, setAdditionalRouteFareYen] = useState(
    restoredTripSnapshot?.additionalRouteFareYen ?? 0,
  )
  const [additionalCareFareYen, setAdditionalCareFareYen] = useState(
    restoredTripSnapshot?.additionalCareFareYen ?? 0,
  )
  const [routeChangeLogs, setRouteChangeLogs] = useState<PreFixedFareRouteChangeLog[]>(
    restoredTripSnapshot?.routeChangeLogs ?? [],
  )
  const [preFixedOverallStops, setPreFixedOverallStops] = useState<PreFixedFareRouteStop[]>(
    () =>
      restoredTripSnapshot?.preFixedOverallStops ??
      buildConfirmedRouteStops(reservationTripContext),
  )
  const [preFixedSegmentIndex, setPreFixedSegmentIndex] = useState(
    restoredTripSnapshot?.preFixedSegmentIndex ?? 0,
  )
  const [routeChangeNotice, setRouteChangeNotice] = useState('')
  const [isObdConnectionDialogOpen, setIsObdConnectionDialogOpen] = useState(false)
  const [obdConnectionDialogVariant, setObdConnectionDialogVariant] = useState<'mid-trip' | 'pre-trip'>('pre-trip')
  const [settingsMessage, setSettingsMessage] = useState(
    restoredTripSnapshot
      ? '未終了の運行データを復元しました。'
      : 'Firestore設定を確認中です。',
  )
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null)
  const [inputHistory, setInputHistory] = useState<InputHistory[]>(loadInputHistory)
  const [selectedCareOptions, setSelectedCareOptions] = useState<
    SelectedCareOption[]
  >(restoredTripSnapshot?.selectedCareOptions ?? [])
  const [customFees, setCustomFees] = useState<CustomFeeItem[]>(
    restoredTripSnapshot?.customFees ?? [],
  )
  const [selectedDispatchCharges, setSelectedDispatchCharges] = useState<
    SelectedCareOption[]
  >(restoredTripSnapshot?.selectedDispatchCharges ?? [])
  const [selectedSpecialVehicleCharges, setSelectedSpecialVehicleCharges] = useState<
    SelectedCareOption[]
  >(restoredTripSnapshot?.selectedSpecialVehicleCharges ?? [])
  const [expenses, setExpenses] = useState<ExpenseItem[]>(restoredTripSnapshot?.selectedExpenses ?? [])
  const [isDisabilityDiscount, setIsDisabilityDiscount] = useState(restoredTripSnapshot?.isDisabilityDiscount ?? false)
  const [settlementDiscount, setSettlementDiscount] = useState(defaultMeterSettings.discount)
  const [taxiTickets, setTaxiTickets] = useState<TaxiTicket[]>(restoredTripSnapshot?.taxiTickets ?? [])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(restoredTripSnapshot?.paymentMethod ?? '現金')
  const [paymentAmounts, setPaymentAmounts] = useState<Record<PaymentMethod, number>>(
    restoredTripSnapshot?.paymentAmounts ?? createEmptyPaymentAmounts,
  )
  const [receiptName, setReceiptName] = useState('')
  const [caseSaveState, setCaseSaveState] = useState<CaseSaveState>('idle')
  const [caseSaveMessage, setCaseSaveMessage] = useState(
    restoredTripSnapshot
      ? '未終了の運行データを復元しました。'
      : reviewDemoMode
        ? '審査用デモ設定で運行できます。精算・終了で保存します（本番には保存されません）。'
        : isFirebaseConfigured
          ? '精算・終了で支払方法を選択して保存します。'
          : 'Firebase接続設定が未完了です。GitHub Pagesの環境変数を確認してください。',
  )
  const [printerConnectionDiagnostics, setPrinterConnectionDiagnostics] = useState<
    EscPosConnectionStageDiagnostic[]
  >([])
  const [currentBasicFareSettings, setCurrentBasicFareSettings] =
    useState<BasicFareSettings>(restoredTripSnapshot?.fareSnapshot?.basicFare ?? basicFareSettings)
  const [currentWaitingFareSettings, setCurrentWaitingFareSettings] =
    useState<TimeFareSettings>(restoredTripSnapshot?.fareSnapshot?.waitingFare ?? waitingFareSettings)
  const [currentEscortFareSettings, setCurrentEscortFareSettings] =
    useState<TimeFareSettings>(restoredTripSnapshot?.fareSnapshot?.escortFare ?? escortFareSettings)
  const [currentCareOptionMaster, setCurrentCareOptionMaster] =
    useState<CareOptionMasterItem[]>(restoredTripSnapshot?.fareSnapshot?.assistItems ?? careOptionMaster)
  const [currentDispatchMenuItems, setCurrentDispatchMenuItems] = useState<DispatchMenuItem[]>(
    restoredTripSnapshot?.fareSnapshot?.dispatchMenuItems ?? defaultMeterSettings.dispatchMenuItems,
  )
  const [currentSpecialVehicleMenuItems, setCurrentSpecialVehicleMenuItems] = useState<SpecialVehicleMenuItem[]>(
    restoredTripSnapshot?.fareSnapshot?.specialVehicleMenuItems ?? defaultMeterSettings.specialVehicleMenuItems,
  )
  const [currentExpensePresets, setCurrentExpensePresets] = useState<ExpensePreset[]>(
    restoredTripSnapshot?.fareSnapshot?.expensePresets ?? defaultMeterSettings.expensePresets,
  )
  const [currentMeterSettings, setCurrentMeterSettings] =
    useState<MeterSettings>(defaultMeterSettings)
  const [savedCaseRecord, setSavedCaseRecord] = useState<StoredCaseRecord | null>(
    null,
  )
  const [meterResetKey, setMeterResetKey] = useState(0)
  const [sessionResetKey, setSessionResetKey] = useState(0)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState(restoredTripSnapshot?.selectedVehicleId ?? '')
  const [settlementFlowStep, setSettlementFlowStep] =
    useState<SettlementFlowStep>('receipt')
  const [postSettlementLock, setPostSettlementLock] = useState(() =>
    reviewDemoMode ? readReviewDemoPostSettlementLock() : readPostSettlementLock(),
  )
  const operationStartedAtRef = useRef(restoredTripSnapshot?.operationStartedAt ?? '')
  const operationEndedAtRef = useRef(restoredTripSnapshot?.operationEndedAt ?? '')
  const latestMeterSettingsRef = useRef<MeterSettings>(defaultMeterSettings)
  const settlementHoldTimerRef = useRef<number | null>(null)
  const resumeHoldTimerRef = useRef<number | null>(null)
  const [pickupLocation, setPickupLocation] = useState<CapturedAddressLocation>(
    restoredTripSnapshot?.pickupLocation ?? emptyCapturedAddressLocation,
  )
  const [dropoffLocation, setDropoffLocation] = useState<CapturedAddressLocation>(
    restoredTripSnapshot?.dropoffLocation ?? emptyCapturedAddressLocation,
  )
  const pickupLocationRef = useRef<CapturedAddressLocation>(
    restoredTripSnapshot?.pickupLocation ?? emptyCapturedAddressLocation,
  )
  const dropoffLocationRef = useRef<CapturedAddressLocation>(
    restoredTripSnapshot?.dropoffLocation ?? emptyCapturedAddressLocation,
  )
  const pickupCapturePromiseRef = useRef<Promise<CapturedAddressLocation> | null>(
    null,
  )
  const dropoffCapturePromiseRef = useRef<Promise<CapturedAddressLocation> | null>(
    null,
  )
  const [reverseGeocodeDiagnostic, setReverseGeocodeDiagnostic] =
    useState<ReverseGeocodeDiagnosticState>(getReverseGeocodeDiagnosticState)
  const elapsedTimers = useOperationTimers(
    activeTimer,
    meterResetKey > 0 || sessionResetKey > 0
      ? emptyTimerSeconds
      : (restoredTripSnapshot?.timers ?? emptyTimerSeconds),
    sessionResetKey,
  )
  const isTimeMeterInitialWaiting =
    meterMode === 'time' &&
    status === '待機中' &&
    !billableTimeStarted.waiting &&
    !operationStartedAtRef.current
  const isTripStarted =
    status !== '空車' &&
    status !== '案件終了' &&
    !isTimeMeterInitialWaiting
  const isDistanceAccumulating =
    meterMode !== 'fixed' && isGpsActive && status !== '待機中'

  const midnightSettings = useMemo(() => {
    const snapshot = fareSnapshotRef.current?.midnightEarlyMorning
    if (snapshot?.enabled && snapshot.startTime && snapshot.endTime) {
      return {
        enabled: true,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        surchargeRate: snapshot.surchargeRate,
      }
    }

    return defaultMidnightEarlyMorningSettings
  }, [caseNumber])
  const initialObdTelemetryState = useMemo(
    () =>
      restoredTripSnapshot?.meterMode === 'obd'
        ? {
            businessDistanceKm: restoredTripSnapshot.distances.businessDistanceKm,
            chargeableDistanceKm: restoredTripSnapshot.distances.chargeableDistanceKm,
            currentSpeedKmh: restoredTripSnapshot.gps.currentSpeedKmh,
            lowSpeedSeconds: restoredTripSnapshot.gps.lowSpeedSeconds,
            movementState: restoredTripSnapshot.gps.movementState,
          }
        : undefined,
    [restoredTripSnapshot],
  )
  const gps = useMeterTelemetry({
    initialObdState: initialObdTelemetryState,
    isActive: !reviewDemoMode && meterMode !== 'fixed' && isGpsActive,
    isDistanceAccumulating,
    lowSpeedThresholdKmh: currentMeterSettings.meterTimeFare.lowSpeedThresholdKmh,
    meterMode,
    meterResetKey,
    sessionResetKey,
  })
  const connectObd = gps.connectObd
  const disconnectObd = gps.disconnectObd
  const nightPeriodMetrics = useNightPeriodAccumulator({
    chargeableDistanceKm: gps.chargeableDistanceKm,
    drivingSeconds: elapsedTimers.seconds.driving,
    isActive: meterMode !== 'fixed' && isGpsActive && status !== '空車' && status !== '案件終了',
    isDrivingActive: status === '走行中',
    midnightSettings,
    resetKey: meterResetKey,
  })
  const obdRestoreConnectAttemptedRef = useRef(false)
  const obdIdleConnectAttemptedRef = useRef(false)
  const applyMeterMode = (nextMode: MeterMode) => {
    if (nextMode === 'fixed') {
      return
    }

    setMeterMode(nextMode)
    setCurrentMeterSettings(selectMeterModeSettings(latestMeterSettingsRef.current, nextMode))
    setMeterModeToast(`${meterModeLabels[nextMode]}に切り替えました`)
  }
  const baseWorkSession = useWorkSession()
  const workSession = reviewDemoMode
    ? { ...baseWorkSession, currentSession: REVIEW_DEMO_WORK_SESSION }
    : baseWorkSession
  const persistActiveTripSnapshot = (snapshot: ActiveTripSnapshot) => {
    if (reviewDemoMode) {
      saveReviewDemoActiveTripSnapshot(snapshot)
      return
    }

    saveActiveTripSnapshot(snapshot)
  }
  const clearPersistedActiveTripSnapshot = () => {
    if (reviewDemoMode) {
      clearReviewDemoActiveTripSnapshot()
      return
    }

    clearActiveTripSnapshot()
  }
  const syncedActiveTripKeyRef = useRef('')

  useEffect(() => {
    if (!reviewDemoMode) {
      return
    }

    if (!reservationTripContext && !restoredTripSnapshot) {
      navigate(withReviewDemoSearch('/review-demo/reservations'), { replace: true })
    }
  }, [navigate, reservationTripContext, restoredTripSnapshot, reviewDemoMode])

  const currentScope = tenantScopeFromSession(workSession.currentSession)
  const currentFranchiseeId = currentScope.franchiseeId
  const currentStoreId = currentScope.storeId
  const allowedMeterModes = useMemo(
    () => getAllowedMeterModes(meterPermissions),
    [meterPermissions],
  )
  const closedWaitingSeconds = calculateActivityHistorySeconds(activityHistories, 'waiting')
  const closedAccompanyingSeconds = calculateActivityHistorySeconds(activityHistories, 'accompanying')
  const adjustedWaitingSeconds = closedWaitingSeconds + (
    activeActivity?.type === 'waiting'
      ? Math.max(elapsedTimers.seconds.waiting - closedWaitingSeconds, 0)
      : 0
  )
  const adjustedAccompanyingSeconds = closedAccompanyingSeconds + (
    activeActivity?.type === 'accompanying'
      ? Math.max(elapsedTimers.seconds.accompanying - closedAccompanyingSeconds, 0)
      : 0
  )
  const waitingFareSeconds = billableTimeStarted.waiting
    ? Math.max(adjustedWaitingSeconds, 1)
    : 0
  const escortFareSeconds = billableTimeStarted.accompanying
    ? Math.max(adjustedAccompanyingSeconds, 1)
    : 0

  const isBlackoutEnabled =
    meterMode === 'obd' && (status === '待機中' || status === '院内付き添い中')
  const blackoutStatusLabel = status === '待機中' ? '待機中' : '付き添い中'
  const blackoutElapsedSeconds = status === '待機中'
    ? adjustedWaitingSeconds
    : adjustedAccompanyingSeconds
  const meterBlackout = useMeterBlackout({
    elapsedSeconds: blackoutElapsedSeconds,
    isEnabled: isBlackoutEnabled,
    statusLabel: blackoutStatusLabel,
  })

  const waitingMovementAlert = useWaitingMovementAlert({
    currentSpeedKmh: gps.currentSpeedKmh,
    gpsPosition: gps.gpsRaw.position,
    isEnabled: meterMode === 'obd' && status === '待機中',
    isUsingObdTelemetry: gps.isUsingObdTelemetry,
  })

  const isCaseClosed = status === '案件終了'
  const shouldPersistTripSnapshot = isProtectedOperationStatus(status) && caseSaveState !== 'saved'
  const isSettlementInProgress =
    status === '精算前' ||
    status === '精算修正' ||
    (status === '案件終了' && caseSaveState !== 'saved')
  const isCaseInProgress =
    shouldPersistTripSnapshot || caseSaveState === 'saving' || isSettlementInProgress
  const isPostSettlementAwaitingNewCase =
    (caseSaveState === 'saved' && status === '案件終了') ||
    Boolean(postSettlementLock)
  const canSaveReceiptPdf =
    Boolean(savedCaseRecord) &&
    status === '案件終了' &&
    caseSaveState === 'saved'
  const postSettlementCaseNumber =
    savedCaseRecord?.caseNumber ?? postSettlementLock?.caseNumber ?? caseNumber
  const isBillingWaiting = status === '待機中' && billableTimeStarted.waiting
  const isActiveTripStatus =
    status === '走行中' ||
    isBillingWaiting ||
    status === '院内付き添い中' ||
    status === '精算前' ||
    status === '精算修正' ||
    (status === '案件終了' && !isPostSettlementAwaitingNewCase)
  const canShowTopFab =
    !isActiveTripStatus &&
    (status === '空車' ||
      isTimeMeterInitialWaiting ||
      isPostSettlementAwaitingNewCase ||
      (!isTripStarted && !isGpsActive))

  useEffect(() => {
    if (reviewDemoMode) {
      return
    }

    const workSessionId = workSession.currentSession?.id
    if (!workSessionId) {
      return
    }

    const remoteStatus = shouldPersistTripSnapshot ? status : null
    const syncKey = `${workSessionId}:${remoteStatus ?? 'none'}:${remoteStatus ? caseNumber : ''}`
    if (syncedActiveTripKeyRef.current === syncKey) {
      return
    }

    syncedActiveTripKeyRef.current = syncKey
    updateWorkSessionActiveTrip({
      caseNumber,
      status: remoteStatus,
      workSessionId,
    }).catch((error) => {
      console.warn('Failed to sync active trip status to work session.', error)
      syncedActiveTripKeyRef.current = ''
    })
  }, [caseNumber, shouldPersistTripSnapshot, status, workSession.currentSession?.id])

  const canStartFixedTrip =
    meterMode === 'fixed' &&
    Boolean(reservationTripContext) &&
    !isTripStarted &&
    Boolean(workSession.currentSession) &&
    Boolean(selectedVehicleId) &&
    status === '空車'
  const canStartTrip =
    meterMode === 'fixed'
      ? canStartFixedTrip
      : !isTripStarted &&
        Boolean(workSession.currentSession) &&
        Boolean(selectedVehicleId) &&
        (status === '空車' || isTimeMeterInitialWaiting)
  const canStartWaiting = status === '走行中' && caseSaveState !== 'saving'
  const canEndWaiting = status === '待機中' && caseSaveState !== 'saving' && billableTimeStarted.waiting
  const canStartAccompanying = status === '走行中' && caseSaveState !== 'saving'
  const canEndAccompanying = status === '院内付き添い中' && caseSaveState !== 'saving'
  const canOpenSettlement = status === '走行中' && meterMode !== 'fixed'
  const canEndFixedTrip =
    meterMode === 'fixed' &&
    (status === '走行中' || status === '待機中' || status === '院内付き添い中') &&
    Boolean(fixedFareRun || reservationTripContext)
  /** 事前確定M: 精算中・終了後はルート変更不可 */
  const isFixedRouteChangeBlocked =
    meterMode === 'fixed' &&
    (
      status === '精算前' ||
      status === '精算修正' ||
      status === '案件終了' ||
      caseSaveState === 'saving' ||
      caseSaveState === 'saved' ||
      Boolean(savedCaseRecord)
    )
  /** 事前確定M: 運行中（走行・待機・付き添い）のみルート変更フローを直接開始 */
  const canStartFixedRouteChangeFlow =
    meterMode === 'fixed' &&
    isTripStarted &&
    (status === '走行中' || status === '待機中' || status === '院内付き添い中') &&
    !isFixedRouteChangeBlocked
  const canArriveFixedSegment =
    meterMode === 'fixed' &&
    status === '走行中' &&
    Boolean(fixedFareRun) &&
    preFixedOverallStops.length >= 2 &&
    preFixedSegmentIndex < preFixedOverallStops.length - 2
  const fareMode =
    meterMode === 'fixed' && fixedFareRun ? FARE_MODE_PRE_FIXED : null
  const canEndWithPassengerChange =
    fareMode === FARE_MODE_PRE_FIXED &&
    (status === '走行中' || status === '待機中' || status === '院内付き添い中') &&
    Boolean(fixedFareRun)
  const hasPassengerChangeTermination = Boolean(pendingPassengerChangeException)
  const isFixedInOperation =
    meterMode === 'fixed' &&
    (status === '走行中' || status === '待機中' || status === '院内付き添い中')
  const isFixedPreSettlement =
    meterMode === 'fixed' &&
    (status === '精算前' || status === '精算修正') &&
    !savedCaseRecord &&
    caseSaveState !== 'saved'
  const isFixedPassengerChangePreSettlement =
    isFixedPreSettlement && hasPassengerChangeTermination
  const isFixedClosed =
    meterMode === 'fixed' &&
    (status === '案件終了' || Boolean(savedCaseRecord) || caseSaveState === 'saved')
  const canEditCharges =
    meterMode === 'fixed'
      ? isFixedInOperation || (isFixedPreSettlement && !hasPassengerChangeTermination)
      : status === '精算修正' || (status !== '精算前' && !isCaseClosed && caseSaveState !== 'saving')
  /** 事前確定M: 運行中・通常精算前は追加介助を編集可。旅客都合途中終了後は無効 */
  const canAddAssistCharge =
    meterMode === 'fixed'
      ? isFixedInOperation || (isFixedPreSettlement && !hasPassengerChangeTermination)
      : canEditCharges
  /**
   * 事前確定M: 運行前・運行中・精算前で実費追加可。
   * 旅客都合途中終了後（精算前）も可。精算完了後（案件終了・保存済み）は不可。
   */
  const canAddExpenseCharge =
    meterMode === 'fixed'
      ? !isFixedClosed &&
        (
          (!isTripStarted && status === '空車') ||
          isFixedInOperation ||
          isFixedPreSettlement
        )
      : canEditCharges
  const canAddDispatchCharge = meterMode === 'fixed' ? false : canEditCharges
  const canAddSpecialVehicleCharge = meterMode === 'fixed' ? false : canEditCharges
  const canOpenDispatchModal = meterMode === 'fixed' ? false : canEditCharges
  const canOpenFixedSettlement =
    meterMode === 'fixed' &&
    status === '精算前' &&
    caseSaveState !== 'saved' &&
    !savedCaseRecord

  useEffect(() => () => {
    if (settlementHoldTimerRef.current !== null) {
      window.clearTimeout(settlementHoldTimerRef.current)
    }
    if (resumeHoldTimerRef.current !== null) {
      window.clearTimeout(resumeHoldTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!postSettlementLock || restoredTripSnapshot) {
      return
    }

    clearPersistedActiveTripSnapshot()
    setStatus('案件終了')
    setCaseSaveState('saved')
    setSettlementFlowStep('saved')
    setIsSettlementFlowOpen(true)
    setCaseSaveMessage(
      `案件 ${postSettlementLock.caseNumber} の精算が完了しています。「新しい案件を開始」から次の案件へ進んでください。`,
    )
  }, [postSettlementLock, restoredTripSnapshot])

  useEffect(() => {
    if (!isCaseInProgress) {
      return undefined
    }

    const leaveOperationMessage =
      '案件進行中です。\n\n戻ると案件データが失われる可能性があります。\n\n本当に戻りますか？'
    const reloadOperationMessage =
      '案件進行中です。\n\nページを再読み込みすると、\n案件データが失われる可能性があります。'
    let allowOperationLeave = false
    const guardedHistoryState = {
      ...(window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}),
      careTaxiMeterGuard: true,
    }
    window.history.pushState(guardedHistoryState, '', window.location.href)

    const handlePopState = () => {
      if (window.confirm(leaveOperationMessage)) {
        allowOperationLeave = true
        return
      }

      window.history.pushState(guardedHistoryState, '', window.location.href)
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowOperationLeave) {
        return undefined
      }

      event.preventDefault()
      event.returnValue = reloadOperationMessage
      return reloadOperationMessage
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const isReloadShortcut =
        event.key === 'F5' ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')

      if (!isReloadShortcut) {
        return
      }

      event.preventDefault()

      if (window.confirm(reloadOperationMessage)) {
        allowOperationLeave = true
        window.location.reload()
      }
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [isCaseInProgress])

  useEffect(() => {
    if (!isPostSettlementAwaitingNewCase) {
      return undefined
    }

    const postSettlementMessage =
      '精算が完了しています。\n\n「新しい案件を開始」から次の案件を開始してください。'
    const reloadPostSettlementMessage =
      '精算が完了しています。\n\nページを再読み込みしても、\n「新しい案件を開始」から次の案件を開始してください。'
    const guardedHistoryState = {
      ...(window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}),
      careTaxiMeterPostSettlementGuard: true,
    }
    window.history.pushState(guardedHistoryState, '', window.location.href)

    const handlePopState = () => {
      window.alert(postSettlementMessage)
      window.history.pushState(guardedHistoryState, '', window.location.href)
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = reloadPostSettlementMessage
      return reloadPostSettlementMessage
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const isReloadShortcut =
        event.key === 'F5' ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')

      if (!isReloadShortcut) {
        return
      }

      event.preventDefault()
      window.alert(reloadPostSettlementMessage)
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [isPostSettlementAwaitingNewCase])


  useEffect(() => {
    if (!reviewDemoMode) {
      return
    }

    const settings = getReviewDemoMeterSettings()
    latestMeterSettingsRef.current = settings
    const selectedSettings = selectMeterModeSettings(settings, resolveMeterSettingsMode(meterMode))
    setCurrentMeterSettings(selectedSettings)
    setCurrentBasicFareSettings(selectedSettings.basicFare)
    setCurrentWaitingFareSettings(selectedSettings.waitingFare)
    setCurrentEscortFareSettings(selectedSettings.escortFare)
    setCurrentCareOptionMaster(selectedSettings.assistItems)
    setCurrentDispatchMenuItems(selectedSettings.dispatchMenuItems)
    setCurrentSpecialVehicleMenuItems(selectedSettings.specialVehicleMenuItems)
    setCurrentExpensePresets(settings.expensePresets)
    setAreMeterPermissionsLoaded(true)
    setMeterPermissions({ gps: true, time: true, obd: true })
    setVehicles([REVIEW_DEMO_VEHICLE])
    setSelectedVehicleId(REVIEW_DEMO_VEHICLE.id)
    setSettingsMessage('審査用デモ設定を読み込みました。')
  }, [meterMode, reviewDemoMode])


  useEffect(() => {
    if (reviewDemoMode) {
      return undefined
    }

    let isMounted = true

    const unsubscribe = subscribeMeterSettings(
      { franchiseeId: currentFranchiseeId, storeId: currentStoreId },
      (settings: MeterSettings) => {
        if (!isMounted) {
          return
        }

        if (fareSnapshotRef.current) {
          setSettingsMessage('案件開始時の料金設定スナップショットで計算中です。')
          return
        }

        latestMeterSettingsRef.current = settings
        const selectedSettings = selectMeterModeSettings(settings, resolveMeterSettingsMode(meterMode))
        setCurrentMeterSettings(selectedSettings)
        setCurrentBasicFareSettings(selectedSettings.basicFare)
        setCurrentWaitingFareSettings(selectedSettings.waitingFare)
        setCurrentEscortFareSettings(selectedSettings.escortFare)
        setCurrentCareOptionMaster(selectedSettings.assistItems)
        setCurrentDispatchMenuItems(selectedSettings.dispatchMenuItems)
        setCurrentSpecialVehicleMenuItems(selectedSettings.specialVehicleMenuItems)
        setCurrentExpensePresets(settings.expensePresets)
        if (!operationStartedAtRef.current) {
          setSettlementDiscount(selectedSettings.discount)
        }
        setSettingsMessage('Firestore設定をリアルタイム反映しています。')
      },
      (error: Error) => {
        if (!isMounted) {
          return
        }

        setSettingsMessage(
          error instanceof Error
            ? `Firestore設定を読み込めませんでした。${error.message}`
            : 'Firestore設定を読み込めませんでした。',
        )
      },
    )

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [currentFranchiseeId, currentStoreId, meterMode])


  useEffect(() => {
    if (reviewDemoMode) {
      return undefined
    }

    let isMounted = true

    void (async () => {
      const firebaseUser = await waitForFirebaseAuthUser()
      if (!isMounted || !firebaseUser) {
        return
      }

      try {
        const loadedVehicles = await getSelectableVehicles({
          franchiseeId: currentFranchiseeId,
          storeId: currentStoreId,
          role: workSession.currentSession?.staffRole,
        })
        if (!isMounted) {
          return
        }

        setVehicles(loadedVehicles)
        const matchedVehicle = loadedVehicles.find((vehicle) => vehicle.id === vehicleIdFromQuery)
        const fallbackVehicle = loadedVehicles[0]
        setSelectedVehicleId((currentVehicleId) => {
          const currentVehicle = loadedVehicles.find((vehicle) => vehicle.id === currentVehicleId)

          return currentVehicle?.id ?? matchedVehicle?.id ?? fallbackVehicle?.id ?? ''
        })
      } catch (error) {
        console.error('Failed to load vehicles', error)
      }
    })()

    return () => {
      isMounted = false
    }
  }, [currentFranchiseeId, currentStoreId, vehicleIdFromQuery, workSession.currentSession])


  useEffect(() => {
    if (!sourceCaseRecordId || restoredTripSnapshot) {
      return undefined
    }

    let isMounted = true
    fetchCaseRecord(sourceCaseRecordId)
      .then((caseRecord) => {
        if (!isMounted) {
          return
        }

        if (!caseRecord) {
          setCaseSaveState('error')
          setCaseSaveMessage('案内開始する案件が見つかりませんでした。')
          setSettingsMessage('案件情報を読み込めませんでした。')
          return
        }

        setCaseSaveState('idle')
        setCaseSaveMessage('案件詳細から案内を開始しました。送迎開始ボタンで運行を開始してください。')
        setSettingsMessage(`案件 ${caseRecord.caseNumber} の案内を開始できます。`)

        if (caseRecord.pickupAddress) {
          const pickup = {
            address: caseRecord.pickupAddress,
            capturedAt: caseRecord.pickupCapturedAt || null,
            latitude: caseRecord.pickupLatitude,
            longitude: caseRecord.pickupLongitude,
          }
          pickupLocationRef.current = pickup
          setPickupLocation(pickup)
        }

        if (caseRecord.dropoffAddress) {
          const dropoff = {
            address: caseRecord.dropoffAddress,
            capturedAt: caseRecord.dropoffCapturedAt || null,
            latitude: caseRecord.dropoffLatitude,
            longitude: caseRecord.dropoffLongitude,
          }
          dropoffLocationRef.current = dropoff
          setDropoffLocation(dropoff)
        }

        if (caseRecord.vehicleId) {
          setSelectedVehicleId((currentVehicleId) => currentVehicleId || caseRecord.vehicleId)
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setCaseSaveState('error')
        setCaseSaveMessage(error instanceof Error ? `案件情報の読み込みに失敗しました。${error.message}` : '案件情報の読み込みに失敗しました。')
        setSettingsMessage('案件情報を読み込めませんでした。')
      })

    return () => {
      isMounted = false
    }
  }, [restoredTripSnapshot, sourceCaseRecordId])

  useEffect(() => {
    if (!reservationTripContext) {
      return
    }

    setFixedFareRun((current) => {
      if (current?.reservationId === reservationTripContext.reservationId) {
        return {
          ...current,
          confirmedFareYen: reservationTripContext.confirmedFareYen,
          snapshotHash: reservationTripContext.snapshotHash,
        }
      }

      return {
        reservationId: reservationTripContext.reservationId,
        confirmedFareYen: reservationTripContext.confirmedFareYen,
        snapshotHash: reservationTripContext.snapshotHash,
      }
    })

    if (!restoredTripSnapshot) {
      setCaseSaveState('idle')
      setCaseSaveMessage(
        reviewDemoMode
          ? '予約連携の事前確定運賃を読み込みました。'
          : '予約連携の事前確定Mを読み込みました。',
      )
      setSettingsMessage(`予約 ${reservationTripContext.reservationId} の案内を開始できます。`)
    }

    if (reservationTripContext.pickupAddress.trim()) {
      const pickup = {
        address: reservationTripContext.pickupAddress.trim(),
        capturedAt: null,
        latitude: null,
        longitude: null,
      }
      pickupLocationRef.current = pickup
      setPickupLocation(pickup)
    }

    if (reservationTripContext.dropoffAddress.trim()) {
      const dropoff = {
        address: reservationTripContext.dropoffAddress.trim(),
        capturedAt: null,
        latitude: null,
        longitude: null,
      }
      dropoffLocationRef.current = dropoff
      setDropoffLocation(dropoff)
    }

    setPreFixedOverallStops((current) =>
      current.length >= 2 ? current : buildConfirmedRouteStops(reservationTripContext),
    )
  }, [reservationTripContext, restoredTripSnapshot])

  useEffect(() => subscribeReverseGeocodeDiagnostic(setReverseGeocodeDiagnostic), [])

  useEffect(() => {
    if (obdRestoreConnectAttemptedRef.current) {
      return
    }

    if (!isGpsActive || meterMode !== 'obd' || status !== '走行中') {
      return
    }

    obdRestoreConnectAttemptedRef.current = true
    void connectObd({ interactive: false, isReconnect: true })
  }, [connectObd, isGpsActive, meterMode, status])

  useEffect(() => {
    if (obdIdleConnectAttemptedRef.current) {
      return
    }

    if (
      meterMode !== 'obd' ||
      status !== '空車' ||
      isGpsActive ||
      gps.isObdConnectedForStart
    ) {
      return
    }

    obdIdleConnectAttemptedRef.current = true
    void connectObd({ interactive: false, isReconnect: true })
  }, [connectObd, gps.isObdConnectedForStart, isGpsActive, meterMode, status])

  const reverseGeocodeCauseLabel = getReverseGeocodeCauseLabel({
    diagnostic: reverseGeocodeDiagnostic,
    dropoffLocation,
    pickupLocation,
  })


  const fareBreakdown = calculateFareBreakdown({
    distanceKm: gps.chargeableDistanceKm,
    waitingSeconds: waitingFareSeconds,
    escortSeconds: escortFareSeconds,
    meterTimeSeconds: gps.lowSpeedSeconds,
    dispatchCharges: selectedDispatchCharges,
    specialVehicleCharges: selectedSpecialVehicleCharges,
    careOptions: selectedCareOptions,
    customFees,
    expenses,
    isDisabilityDiscount,
    taxiTickets,
    settings: {
      basicFare: currentBasicFareSettings,
      escortFare: currentEscortFareSettings,
      meterTimeFare: currentMeterSettings.meterTimeFare,
      waitingFare: currentWaitingFareSettings,
      discount: settlementDiscount,
    },
    meterMode,
    drivingSeconds: elapsedTimers.seconds.driving,
    timeMeterSettings: currentMeterSettings.time,
    midnightSettings,
    nightChargeableDistanceKm: nightPeriodMetrics.nightChargeableDistanceKm,
    nightDrivingSeconds: nightPeriodMetrics.nightDrivingSeconds,
  })

  const resolvedConfirmedFareYen = useMemo(() => {
    if (fixedFareRun && Number.isFinite(fixedFareRun.confirmedFareYen)) {
      return Math.max(Math.round(fixedFareRun.confirmedFareYen), 0)
    }

    if (reservationTripContext && Number.isFinite(reservationTripContext.confirmedFareYen)) {
      return Math.max(Math.round(reservationTripContext.confirmedFareYen), 0)
    }

    if (
      reservationTripContext &&
      Number.isFinite(reservationTripContext.fixedFareTotalYen)
    ) {
      return Math.max(Math.round(reservationTripContext.fixedFareTotalYen), 0)
    }

    return 0
  }, [fixedFareRun, reservationTripContext])

  const settlementBreakdown = useMemo(() => {
    // 事前確定Mでは距離加算の通常内訳を使わず、予約確定運賃ベースの内訳のみ表示する。
    if (meterMode === 'fixed') {
      const baseBreakdown = buildFixedFareBreakdown({
        confirmedFareYen: resolvedConfirmedFareYen,
        additionalRouteFareYen,
        additionalCareFareYen,
        dispatchCharges: selectedDispatchCharges,
        specialVehicleCharges: selectedSpecialVehicleCharges,
        careOptions: selectedCareOptions,
        customFees,
        expenses,
        waitingSeconds: waitingFareSeconds,
        escortSeconds: escortFareSeconds,
        isDisabilityDiscount,
        taxiTickets,
        settings: {
          escortFare: currentEscortFareSettings,
          waitingFare: currentWaitingFareSettings,
          discount: settlementDiscount,
        },
      })

      return reviewDemoMode
        ? buildReviewDemoFixedFareBreakdown(baseBreakdown)
        : baseBreakdown
    }

    return fareBreakdown
  }, [
    additionalCareFareYen,
    additionalRouteFareYen,
    customFees,
    currentEscortFareSettings,
    currentWaitingFareSettings,
    escortFareSeconds,
    expenses,
    fareBreakdown,
    isDisabilityDiscount,
    meterMode,
    resolvedConfirmedFareYen,
    reviewDemoMode,
    selectedCareOptions,
    selectedDispatchCharges,
    selectedSpecialVehicleCharges,
    settlementDiscount,
    taxiTickets,
    waitingFareSeconds,
  ])

  const confirmedRouteView = useMemo(
    () => buildConfirmedRouteView(reservationTripContext),
    [reservationTripContext],
  )
  const currentSegmentStops = useMemo(
    () => getCurrentSegmentStops(preFixedOverallStops, preFixedSegmentIndex),
    [preFixedOverallStops, preFixedSegmentIndex],
  )
  const overallRouteLabel = useMemo(
    () => formatRoutePathLabel(preFixedOverallStops),
    [preFixedOverallStops],
  )
  const currentSegmentLabel = useMemo(
    () => formatRoutePathLabel(currentSegmentStops),
    [currentSegmentStops],
  )

  const paymentTotalYen = paymentMethods.reduce(
    (total, method) => total + Math.max(Math.round(paymentAmounts[method]) || 0, 0),
    0,
  )
  const payments: PaymentAllocation[] = paymentMethods
    .map((method) => ({
      amount: Math.max(Math.round(paymentAmounts[method]) || 0, 0),
      id: `payment-${method}`,
      type: method,
    }))
    .filter((payment) => payment.amount > 0)

  useEffect(() => {
    if (!shouldPersistTripSnapshot) {
      return
    }

    persistActiveTripSnapshot({
      activeTimer,
      activityHistories,
      billableTimeStarted,
      caseNumber,
      caseNumberAssignment: caseNumberAssignmentRef.current,
      capturedAt: new Date().toISOString(),
      distances: {
        businessDistanceKm: gps.businessDistanceKm,
        chargeableDistanceKm: gps.chargeableDistanceKm,
      },
      dropoffLocation,
      fareSnapshot: fareSnapshotRef.current,
      fareTotalYen: settlementBreakdown.totalFareYen,
      gps: {
        currentSpeedKmh: gps.currentSpeedKmh,
        gpsLogCount: gps.gpsLogCount,
        lowSpeedSeconds: gps.lowSpeedSeconds,
        movementState: gps.movementState,
        position: gps.position,
        speedSource: gps.speedSource,
      },
      isDisabilityDiscount,
      operationEndedAt: operationEndedAtRef.current,
      operationStartedAt: operationStartedAtRef.current,
      paymentAmounts,
      paymentMethod,
      pickupLocation,
      selectedCareOptions,
      selectedDispatchCharges,
      selectedExpenses: expenses,
      customFees,
      selectedSpecialVehicleCharges,
      selectedVehicleId,
      status,
      meterMode,
      timerStartedAt,
      ...(meterMode === 'fixed' && fixedFareRun
        ? {
            reservationId: fixedFareRun.reservationId,
            confirmedFareYen: fixedFareRun.confirmedFareYen,
            snapshotHash: fixedFareRun.snapshotHash,
            additionalRouteFareYen,
            additionalCareFareYen,
            routeChangeLogs,
            preFixedOverallStops,
            preFixedSegmentIndex,
            preFixedFareException: pendingPassengerChangeExceptionRef.current,
          }
        : {}),
      taxiTickets,
      timers: elapsedTimers.seconds,
    })
  }, [
    additionalCareFareYen,
    additionalRouteFareYen,
    pendingPassengerChangeException,
    preFixedOverallStops,
    preFixedSegmentIndex,
    routeChangeLogs,
    activeTimer,
    activityHistories,
    billableTimeStarted,
    caseNumber,
    dropoffLocation,
    elapsedTimers.seconds,
    expenses,
    fareBreakdown.totalFareYen,
    settlementBreakdown.totalFareYen,
    fixedFareRun,
    gps.businessDistanceKm,
    gps.chargeableDistanceKm,
    gps.currentSpeedKmh,
    gps.gpsLogCount,
    gps.lowSpeedSeconds,
    gps.movementState,
    gps.position,
    gps.speedSource,
    isDisabilityDiscount,
    settlementDiscount,
    shouldPersistTripSnapshot,
    meterMode,
    paymentAmounts,
    paymentMethod,
    pickupLocation,
    selectedCareOptions,
    selectedDispatchCharges,
    customFees,
    selectedSpecialVehicleCharges,
    selectedVehicleId,
    status,
    taxiTickets,
    timerStartedAt,
  ])

  const fareIncrease = calculateFareIncreaseProgress(
    gps.chargeableDistanceKm,
    currentBasicFareSettings,
  )
  const fareIncreasePercent = Math.round(fareIncrease.progressRate * 100)
  const distanceFareUnitKm =
    gps.chargeableDistanceKm <= currentBasicFareSettings.initialDistanceKm
      ? currentBasicFareSettings.initialDistanceKm
      : currentBasicFareSettings.additionalDistanceKm
  const distanceFareElapsedMeters = Math.max(
    0,
    Math.round((distanceFareUnitKm - fareIncrease.remainingDistanceKm) * 1000),
  )
  const distanceFareUnitMeters = Math.round(distanceFareUnitKm * 1000)
  const gpsTimeFareIncrease = calculateTimeFareIncreaseProgress(
    gps.lowSpeedSeconds,
    currentMeterSettings.meterTimeFare,
  )
  const timeMeterFareIncreaseProgress =
    meterMode === 'time'
      ? calculateTimeMeterFareIncreaseProgress(
          elapsedTimers.seconds.driving,
          currentMeterSettings.time.discount,
          currentMeterSettings.time.legal,
        )
      : null
  const timeFareIncreasePercent =
    meterMode === 'time'
      ? Math.round((timeMeterFareIncreaseProgress?.progressRate ?? 0) * 100)
      : Math.round(gpsTimeFareIncrease.progressRate * 100)
  const timeFareIndicatorLabel =
    meterMode === 'time'
      ? (timeMeterFareIncreaseProgress?.label ?? '時間加算まで')
      : '時間加算まで'
  const gpsTimeFareElapsedSeconds = Math.max(
    0,
    Math.round(
      currentMeterSettings.meterTimeFare.unitSeconds - gpsTimeFareIncrease.remainingSeconds,
    ),
  )
  const currentSpeedValueLabel =
    gps.currentSpeedKmh == null ? '取得中...' : gps.currentSpeedKmh.toFixed(1)

  const enabledCareOptions = useMemo(
    () =>
      currentCareOptionMaster
        .filter((item) => item.enabled && item.id !== 'otherAssist')
        .sort(
          (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
        ),
    [currentCareOptionMaster],
  )
  const enabledDispatchMenuItems = useMemo(
    () =>
      currentDispatchMenuItems
        .filter((item) => item.enabled)
        .sort(
          (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
        ),
    [currentDispatchMenuItems],
  )
  const enabledSpecialVehicleMenuItems = useMemo(
    () =>
      currentSpecialVehicleMenuItems
        .filter((item) => item.enabled)
        .sort(
          (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
        ),
    [currentSpecialVehicleMenuItems],
  )
  const selectedCareOptionIds = useMemo(
    () => new Set(selectedCareOptions.map((option) => option.masterId)),
    [selectedCareOptions],
  )
  const selectedDispatchChargeIds = useMemo(
    () => new Set(selectedDispatchCharges.map((charge) => charge.masterId)),
    [selectedDispatchCharges],
  )
  const selectedSpecialVehicleChargeIds = useMemo(
    () => new Set(selectedSpecialVehicleCharges.map((charge) => charge.masterId)),
    [selectedSpecialVehicleCharges],
  )
  const expenseTotalYen = expenses.reduce(
    (total, expense) => total + expense.amountYen,
    0,
  )

  const persistInputHistory = (nextHistory: InputHistory[]) => {
    setInputHistory(nextHistory)
    localStorage.setItem(inputHistoryStorageKey, JSON.stringify(nextHistory))
  }

  const rememberHistory = (entry: Omit<InputHistory, 'id'>) => {
    const nextHistory = [
      { ...entry, id: createId('history') },
      ...inputHistory.filter(
        (item) => item.mode !== entry.mode || item.name !== entry.name,
      ),
    ].slice(0, 10)
    persistInputHistory(nextHistory)
  }

  const addCareOption = ({
    amountYen,
    masterId,
    name,
  }: {
    amountYen: number
    masterId: string
    name: string
  }) => {
    if (!canAddAssistCharge) {
      return
    }

    setSelectedCareOptions((currentOptions) => [
      ...currentOptions,
      {
        amountYen,
        id: createId(masterId),
        masterId,
        name,
      },
    ])
    rememberHistory({ amountYen, mode: 'care', name })
  }

  const removeCareOption = (optionId: string) => {
    if (!canAddAssistCharge) {
      return
    }
    setSelectedCareOptions((currentOptions) =>
      currentOptions.filter((option) => option.id !== optionId),
    )
  }

  const toggleCareOption = (masterItem: CareOptionMasterItem) => {
    if (!canAddAssistCharge) {
      return
    }

    const isSelected = selectedCareOptionIds.has(masterItem.id)

    setSelectedCareOptions((currentOptions) => {
      if (isSelected) {
        return currentOptions.filter((option) => option.masterId !== masterItem.id)
      }

      return [
        ...currentOptions,
        {
          amountYen: masterItem.amount,
          id: createId(masterItem.id),
          masterId: masterItem.id,
          name: masterItem.name,
        },
      ]
    })

    if (!isSelected) {
      rememberHistory({
        amountYen: masterItem.amount,
        mode: 'care',
        name: masterItem.name,
      })
    }
  }

  const toggleDispatchCharge = (dispatchItem: DispatchMenuItem) => {
    if (!canAddDispatchCharge) {
      return
    }

    const isSelected = selectedDispatchChargeIds.has(dispatchItem.id)

    setSelectedDispatchCharges(
      isSelected
        ? []
        : [
            {
              amountYen: dispatchItem.amount,
              id: createId(dispatchItem.id),
              masterId: dispatchItem.id,
              name: dispatchItem.name,
            },
          ],
    )
  }

  const toggleSpecialVehicleCharge = (specialItem: SpecialVehicleMenuItem) => {
    if (!canAddSpecialVehicleCharge) {
      return
    }

    const isSelected = selectedSpecialVehicleChargeIds.has(specialItem.id)

    setSelectedSpecialVehicleCharges(
      isSelected
        ? []
        : [
            {
              amountYen: specialItem.amount,
              id: createId(specialItem.id),
              masterId: specialItem.id,
              name: specialItem.name,
            },
          ],
    )
  }

  const addExpense = ({ amountYen, name }: Omit<ExpenseItem, 'id'>) => {
    if (!canAddExpenseCharge) {
      return
    }

    setExpenses((currentExpenses) => [
      ...currentExpenses,
      { amountYen, id: createId('expense'), name },
    ])
    rememberHistory({ amountYen, mode: 'expense', name })
  }

  const removeExpense = (expenseId: string) => {
    if (!canAddExpenseCharge) {
      return
    }
    setExpenses((currentExpenses) =>
      currentExpenses.filter((expense) => expense.id !== expenseId),
    )
  }

  const handleKeypadConfirm = (entry: { amountYen: number; name: string }) => {
    if (!keypadTarget) {
      return
    }

    if (keypadTarget.mode === 'care') {
      addCareOption({
        amountYen: entry.amountYen,
        masterId: keypadTarget.sourceId ?? 'manual-care',
        name: entry.name,
      })
    } else if (keypadTarget.mode === 'customFee') {
      addCustomFee(entry)
    } else {
      addExpense(entry)
    }

    setKeypadTarget(null)
  }

  const addCustomFee = ({ amountYen, name }: { amountYen: number; name: string }) => {
    if (!canAddAssistCharge) {
      return
    }

    setCustomFees((currentFees) => [
      ...currentFees,
      {
        amount: amountYen,
        id: createId('custom-fee'),
        name,
      },
    ])
    rememberHistory({ amountYen, mode: 'customFee', name })
  }

  const removeCustomFee = (feeId: string) => {
    if (!canAddAssistCharge) {
      return
    }

    setCustomFees((currentFees) => currentFees.filter((fee) => fee.id !== feeId))
  }

  const addTaxiTicket = (ticket: Omit<TaxiTicket, 'id'>) => {
    setTaxiTickets((currentTickets) => [
      ...currentTickets,
      { ...ticket, id: createId('taxi-ticket') },
    ])
  }

  const removeTaxiTicket = (ticketId: string) => {
    setTaxiTickets((currentTickets) => currentTickets.filter((ticket) => ticket.id !== ticketId))
  }

  const updatePaymentAmount = (method: PaymentMethod, amount: number) => {
    setPaymentAmounts((currentAmounts) => ({
      ...currentAmounts,
      [method]: Math.max(Math.round(amount) || 0, 0),
    }))
  }

  const settlePaymentRemainder = () => {
    setPaymentAmounts({
      ...createEmptyPaymentAmounts(),
      [paymentMethod]: settlementBreakdown.totalFareYen,
    })
  }


  const captureAddressWithLatestGps = (position: GpsPosition | null) => {
    if (!position) {
      console.warn(
        '[住所取得診断] 取得済みGPS座標がないため、現在位置を再取得して住所取得します。',
      )
      return captureCurrentAddressLocation()
    }

    console.log('[住所取得診断] 取得済みGPS座標から住所取得します。', {
      accuracy: position.accuracy,
      capturedAt: new Date(position.updatedAt).toISOString(),
      latitude: position.latitude,
      longitude: position.longitude,
    })

    return captureAddressLocationFromCoordinates({
      capturedAt: new Date(position.updatedAt).toISOString(),
      latitude: position.latitude,
      longitude: position.longitude,
    })
  }

  const markOperationStarted = () => {
    if (!operationStartedAtRef.current) {
      operationStartedAtRef.current = new Date().toISOString()
    }
  }

  const capturePickupLocation = () => {
    console.log('[住所取得診断] 伺い先住所取得を開始します。')
    const capturePromise = (
      reviewDemoMode
        ? captureReviewDemoPickupLocation()
        : captureAddressWithLatestGps(gps.position)
    ).then((location) => {
      console.log('[住所取得診断] 伺い先住所取得結果を案件画面へ反映します。', {
        hasAddress: Boolean(location.address),
        location,
      })
      pickupLocationRef.current = location
      setPickupLocation(location)
      return location
    })

    pickupCapturePromiseRef.current = capturePromise
    capturePromise.finally(() => {
      if (pickupCapturePromiseRef.current === capturePromise) {
        pickupCapturePromiseRef.current = null
      }
    })

    return capturePromise
  }

  const captureDropoffLocation = () => {
    console.log('[住所取得診断] 送り先住所取得を開始します。')
    const capturePromise = (
      reviewDemoMode
        ? captureReviewDemoDropoffLocation()
        : captureAddressWithLatestGps(gps.position)
    ).then((location) => {
      console.log('[住所取得診断] 送り先住所取得結果を案件画面へ反映します。', {
        hasAddress: Boolean(location.address),
        location,
      })
      dropoffLocationRef.current = location
      setDropoffLocation(location)
      return location
    })

    dropoffCapturePromiseRef.current = capturePromise
    capturePromise.finally(() => {
      if (dropoffCapturePromiseRef.current === capturePromise) {
        dropoffCapturePromiseRef.current = null
      }
    })

    return capturePromise
  }

  const canTransitionStatus = (currentStatus: OperationStatus, nextStatus: OperationStatus) => {
    if (currentStatus === nextStatus) {
      return true
    }

    const allowedTransitions: Record<OperationStatus, OperationStatus[]> = {
      空車: ['走行中'],
      走行中: ['待機中', '院内付き添い中', '精算前'],
      // 事前確定Mは待機・付き添い中から直接精算確認へ進める。
      待機中: meterMode === 'fixed' ? ['走行中', '精算前'] : ['走行中'],
      院内付き添い中: meterMode === 'fixed' ? ['走行中', '精算前'] : ['走行中'],
      精算前: ['精算修正', '走行中', '案件終了'],
      精算修正: ['精算前'],
      案件終了: [],
    }

    return allowedTransitions[currentStatus].includes(nextStatus)
  }

  const handleObdReconnect = async () => {
    console.log('[OBDM] handleObdReconnect 押下', {
      dialogVariant: obdConnectionDialogVariant,
      isGpsActive,
      isObdBleConnected: gps.isObdBleConnected,
      isObdConnectedForStart: gps.isObdConnectedForStart,
      isObdStableForTelemetry: gps.isObdStableForTelemetry,
      needsObdInteractiveReconnect: gps.needsObdInteractiveReconnect,
      obdConnectionPhase: gps.obdConnectionPhase,
      obdMeterStatus: gps.obdMeterStatus,
    })

    const connected = await connectObd(
      obdConnectionDialogVariant === 'mid-trip'
        ? { interactive: true, isReconnect: true }
        : { interactive: true, isInitialTripConnect: true },
    )

    console.log('[OBDM] handleObdReconnect 完了', { connected })
    if (connected) {
      setIsObdConnectionDialogOpen(false)
      setTripStartNotice('')
      return
    }

    setTripStartNotice(
      obdConnectionDialogVariant === 'mid-trip'
        ? 'OBDに接続できませんでした。GPSで計測を継続します。'
        : 'OBD接続が完了していません。再接続してください。',
    )
  }

  const handleObdSwitchToGps = () => {
    applyMeterMode('gps')
    setIsObdConnectionDialogOpen(false)
  }

  const handleObdSwitchToTime = () => {
    applyMeterMode('time')
    setIsObdConnectionDialogOpen(false)
  }

  const handleDrivingStart = async () => {
    if (meterMode === 'fixed') {
      if (!canStartFixedTrip || !workSession.currentSession || !reservationTripContext) {
        const message =
          !workSession.currentSession
            ? '出勤してから運行開始してください。'
            : !selectedVehicleId
              ? '案件車両を選択してください。'
              : !reservationTripContext
                ? '予約連携情報が見つかりません。予約詳細から再度開始してください。'
                : '現在の状態では固定運賃で運行開始できません。'
        setCaseSaveState('error')
        setCaseSaveMessage(message)
        setTripStartNotice(message)
        return
      }

      if (operationStartedAtRef.current) {
        const message = '現在の状態では固定運賃で運行開始できません。'
        setCaseSaveState('error')
        setCaseSaveMessage(message)
        setTripStartNotice(message)
        return
      }

      try {
        const assignment = reviewDemoMode
          ? createReviewDemoCaseNumberAssignment()
          : await generateCaseNumber({
              franchiseeId:
                workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
              storeId: workSession.currentSession.storeId,
              storeName: workSession.currentSession.storeName,
            })

        caseNumberAssignmentRef.current = assignment
        setCaseNumber(assignment.caseNumber)
        setFixedFareRun({
          reservationId: reservationTripContext.reservationId,
          confirmedFareYen: reservationTripContext.confirmedFareYen,
          snapshotHash: reservationTripContext.snapshotHash,
        })
        markOperationStarted()

        if (!handleStatusChange('走行中')) {
          return
        }

        setSettingsMessage(
          reviewDemoMode
            ? '事前確定運賃で運行を開始しました。'
            : '事前確定Mで運行を開始しました。',
        )
        setCaseSaveState('idle')
        setCaseSaveMessage('固定運賃で運行を開始しました。')
        setTripStartNotice('')
      } catch (error) {
        const message = error instanceof Error
          ? `案件番号の採番に失敗しました。${error.message}`
          : '案件番号の採番に失敗しました。通信状況とFirebase設定を確認してください。'
        setCaseSaveState('error')
        setCaseSaveMessage(message)
        setTripStartNotice(message)
      }

      return
    }

    if (!canStartTrip || !workSession.currentSession || operationStartedAtRef.current) {
      const message =
        !workSession.currentSession
          ? '出勤してから送迎開始してください。'
          : !selectedVehicleId
            ? '案件車両を選択してください。'
            : '現在の状態では送迎開始できません。'
      setCaseSaveState('error')
      setCaseSaveMessage(message)
      setTripStartNotice(message)
      return
    }

    try {
      if (meterMode === 'obd') {
        console.log('[OBDM] 送迎開始前', {
          isObdBleConnected: gps.isObdBleConnected,
          isObdConnectedForStart: gps.isObdConnectedForStart,
          isObdStableForTelemetry: gps.isObdStableForTelemetry,
          obdConnectionPhase: gps.obdConnectionPhase,
        })

        if (!gps.isObdConnectedForStart) {
          setTripStartNotice('OBD接続中です。完了後に送迎開始します。')
        }

        const connected = await connectObd({
          interactive: true,
          isInitialTripConnect: true,
        })

        if (!connected) {
          setTripStartNotice('OBD接続が完了していません。再接続してください。')
          setObdConnectionDialogVariant('pre-trip')
          setIsObdConnectionDialogOpen(true)
          return
        }
      }

      const assignment = await generateCaseNumber({
        franchiseeId: workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
        storeId: workSession.currentSession.storeId,
        storeName: workSession.currentSession.storeName,
      })
      const snapshot = createFareSnapshot({
        assistItems: currentCareOptionMaster,
        basicFare: currentBasicFareSettings,
        dispatchMenuItems: currentDispatchMenuItems,
        escortFare: currentEscortFareSettings,
        expensePresets: currentExpensePresets,
        meterSettings: currentMeterSettings,
        specialVehicleMenuItems: currentSpecialVehicleMenuItems,
        waitingFare: currentWaitingFareSettings,
      })

      caseNumberAssignmentRef.current = assignment
      fareSnapshotRef.current = snapshot
      setCaseNumber(assignment.caseNumber)
      setIsFareSnapshotLocked(true)
      markOperationStarted()

      if (!handleStatusChange('走行中')) {
        return
      }

      setSettingsMessage('送迎開始時の料金設定スナップショットで計算中です。')
      setCaseSaveState('idle')
      setCaseSaveMessage('送迎を開始しました。精算・終了で保存します。')
      setTripStartNotice('')
      void capturePickupLocation()
    } catch (error) {
      const message = error instanceof Error
        ? `案件番号の採番に失敗しました。${error.message}`
        : '案件番号の採番に失敗しました。通信状況とFirebase設定を確認してください。'
      setCaseSaveState('error')
      setCaseSaveMessage(message)
      setTripStartNotice(message)
    }
  }

  const handleSettlementStart = () => {
    if (meterMode === 'fixed') {
      setCaseSaveState('error')
      setCaseSaveMessage('事前確定Mは精算連携の準備中です。')
      return false
    }

    if (!canOpenSettlement) {
      setCaseSaveState('error')
      setCaseSaveMessage('走行中のみ精算へ進めます。')
      return false
    }

    if (!workSession.currentSession) {
      setCaseSaveState('error')
      setCaseSaveMessage('出勤してから案件を保存してください。')
      return false
    }

    if (!selectedVehicleId) {
      setCaseSaveState('error')
      setCaseSaveMessage('案件車両を選択してください。')
      return false
    }

    if (!operationEndedAtRef.current) {
      const endedAt = new Date().toISOString()
      operationEndedAtRef.current = endedAt
    }

    if (!handleStatusChange('精算前')) {
      return false
    }

    if (
      (!dropoffLocationRef.current.capturedAt || !dropoffLocationRef.current.address) &&
      !dropoffCapturePromiseRef.current
    ) {
      void captureDropoffLocation()
    }

    return true
  }

  const openFixedSettlementFlow = (options?: { force?: boolean }) => {
    if (meterMode !== 'fixed' || resolvedConfirmedFareYen <= 0) {
      return
    }

    if (!options?.force && status !== '精算前') {
      return
    }

    if (paymentTotalYen === 0) {
      setPaymentAmounts({
        ...createEmptyPaymentAmounts(),
        [paymentMethod]: settlementBreakdown.totalFareYen,
      })
    }

    setIsSettlementFlowOpen(true)
    setSettlementFlowStep('receipt')
  }

  const handleFixedTripEnd = (passengerChangeExceptionOverride?: PreFixedFareException | null) => {
    if (!canEndFixedTrip) {
      setCaseSaveState('error')
      setCaseSaveMessage('現在の状態では運行終了できません。')
      return
    }

    const passengerChangeException =
      passengerChangeExceptionOverride ?? pendingPassengerChangeException

    if (passengerChangeExceptionOverride) {
      pendingPassengerChangeExceptionRef.current = passengerChangeExceptionOverride
      setPendingPassengerChangeException(passengerChangeExceptionOverride)
    }

    if (!operationEndedAtRef.current) {
      operationEndedAtRef.current = passengerChangeException?.endedAt ?? new Date().toISOString()
    }

    if (!handleStatusChange('精算前')) {
      return
    }

    setCaseSaveState('idle')
    setIsCareModalOpen(false)
    setIsExpenseModalOpen(false)
    setIsDispatchModalOpen(false)
    setIsRouteChangeDialogOpen(false)
    setIsPassengerChangeDialogOpen(false)

    if (passengerChangeException) {
      // 途中終了後は運行中UIへ戻さず、精算前サマリーから「精算へ進む」のみ案内する。
      setCaseSaveMessage('旅客都合変更により事前確定運賃を途中終了しました。')
      setRouteChangeNotice('旅客都合変更により事前確定運賃を途中終了しました。')
      return
    }

    setCaseSaveMessage('運行を終了しました。精算確認画面で支払いを確定してください。')
    openFixedSettlementFlow({ force: true })
  }

  const handleFixedSegmentArrive = () => {
    if (!canArriveFixedSegment) {
      setRouteChangeNotice('最終区間です。到着済みの場合は運行終了へ進んでください。')
      return
    }

    setPreFixedSegmentIndex((current) =>
      Math.min(current + 1, Math.max(preFixedOverallStops.length - 2, 0)),
    )
    setRouteChangeNotice('現在区間の到着を記録しました。')
  }

  /** 事前確定M: 外部ナビ起動のみ。運行開始・料金計測・運行ログは行わない。 */
  const handleOpenFixedNavigation = () => {
    if (reviewDemoMode) {
      setRouteChangeNotice('審査用デモではナビ連携は利用できません。')
      return
    }

    const targetStops =
      currentSegmentStops.length >= 2 ? currentSegmentStops : preFixedOverallStops
    const opened = openGoogleMapsNavigation(targetStops)
    if (!opened) {
      setRouteChangeNotice('ナビを開始できませんでした。ルート情報を確認してください。')
      return
    }

    // 運行開始前はメーター状態を一切変更せず、外部ナビ起動のみ行う。
    setRouteChangeNotice(
      isTripStarted
        ? 'ナビを開始しました。アプリ側の確定ルートは予約時の内容を保持します。'
        : '外部ナビを起動しました。運行はまだ開始していません。「固定運賃で運行開始」でメーターを開始してください。',
    )
  }

  const handleFixedRouteChangeClick = () => {
    if (meterMode !== 'fixed' || isFixedRouteChangeBlocked) {
      return
    }

    // 運行開始前: 誤操作防止の確認のみ（ルート変更フローは開始しない）
    if (!isTripStarted) {
      setIsRouteChangePreStartDialogOpen(true)
      return
    }

    // 運行中: 現在地GPS取得 → 変更パターン選択へ
    if (canStartFixedRouteChangeFlow) {
      setIsRouteChangeDialogOpen(true)
    }
  }

  const appendRouteChangeLog = async (log: PreFixedFareRouteChangeLog) => {
    setRouteChangeLogs((current) => [...current, log])

    if (!workSession.currentSession) {
      return
    }

    await createAuditLog({
      action: 'pre_fixed_fare_route_change',
      actor: {
        userId: workSession.currentSession.staffId,
        userName: workSession.currentSession.staffName,
        role: workSession.currentSession.staffRole,
        franchiseeId:
          workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
        storeId: workSession.currentSession.storeId,
      },
      targetId: caseNumber,
      targetType: 'activeTrip',
      before: {
        fareMode: FARE_MODE_PRE_FIXED,
        route: log.routeBefore,
        confirmedFareYen: fixedFareRun?.confirmedFareYen ?? 0,
      },
      after: {
        pattern: log.pattern,
        route: log.routeAfter,
        additionalRouteFareYen: log.additionalRouteFareYen,
        additionalCareFareYen: log.additionalCareFareYen,
        totalFareYen: log.totalFareYen,
        consentAt: log.consentAt,
        consentMethod: log.consentMethod,
      },
      reason: log.reason,
    })
  }

  const handleRouteChangeEndHere = async (log: PreFixedFareRouteChangeLog) => {
    setIsRouteChangeDialogOpen(false)
    await appendRouteChangeLog(log)
    // この変更自体の追加運賃は0円。短くなっても当初運賃は減額しない。
    const exception = buildPreFixedFarePassengerChangeException(
      fixedFareRun?.confirmedFareYen ?? resolvedConfirmedFareYen,
      gps.position,
    )
    setRouteChangeNotice('旅客都合変更により事前確定運賃を途中終了しました。')
    handleFixedTripEnd(exception)
  }

  const handleRouteChangeTrafficDetour = async (log: PreFixedFareRouteChangeLog) => {
    setIsRouteChangeDialogOpen(false)
    await appendRouteChangeLog(log)
    setRouteChangeNotice('交通規制・迂回を記録しました。追加運賃なしで運行を継続します。')
  }

  const handlePassengerRouteChangeConfirmed = async ({
    log,
    nextStops,
    additionalRouteFareYen: routeFareYen,
    additionalCareFareYen: careFareYen,
    startNavigation,
  }: {
    log: PreFixedFareRouteChangeLog
    nextStops: PreFixedFareRouteStop[]
    additionalRouteFareYen: number
    additionalCareFareYen: number
    startNavigation: boolean
  }) => {
    setIsRouteChangeDialogOpen(false)
    await appendRouteChangeLog(log)
    setAdditionalRouteFareYen((current) => current + routeFareYen)
    setAdditionalCareFareYen((current) => current + careFareYen)
    setPreFixedOverallStops(nextStops)
    setPreFixedSegmentIndex(0)
    setRouteChangeNotice(
      `ルート変更を承諾しました。追加区間運賃 ${formatFareYen(routeFareYen)}円を加算します。`,
    )

    if (startNavigation && !reviewDemoMode) {
      openGoogleMapsNavigation(nextStops)
    }
  }

  const handleConfirmPassengerChangeTermination = async () => {
    if (!canEndWithPassengerChange || !fixedFareRun) {
      return
    }

    const exception = buildPreFixedFarePassengerChangeException(
      fixedFareRun.confirmedFareYen,
      gps.position,
    )
    setIsPassengerChangeDialogOpen(false)

    if (workSession.currentSession) {
      await createAuditLog({
        action: 'pre_fixed_fare_passenger_change',
        actor: {
          userId: workSession.currentSession.staffId,
          userName: workSession.currentSession.staffName,
          role: workSession.currentSession.staffRole,
          franchiseeId:
            workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
          storeId: workSession.currentSession.storeId,
        },
        targetId: caseNumber,
        targetType: 'activeTrip',
        before: { fareMode: FARE_MODE_PRE_FIXED, status },
        after: {
          completionReason: 'passenger_requested_route_change',
          endedAt: exception.endedAt,
          originalFixedFareYen: exception.originalFixedFareYen,
          recordStatus: 'completed_with_passenger_change',
        },
        reason: PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
      })
    }

    handleFixedTripEnd(exception)
  }

  const handleStartRegularMeterTrip = () => {
    clearPostSettlementLock()
    clearPersistedActiveTripSnapshot()
    clearReservationTripContext()
    navigate('/case/start')
  }

  const completeFixedFareAfterSave = async (
    reservationId: string,
    options?: {
      isPassengerChange?: boolean
      preFixedFareException?: PreFixedFareException | null
    },
  ): Promise<boolean> => {
    setIsFixedCompleteLoading(true)
    setTripStartNotice('')

    if (reviewDemoMode) {
      clearPersistedActiveTripSnapshot()
      clearReviewDemoReservationTripContext()
      markReviewDemoRunCompleted()
      setFixedCompleteState('done')
      setCaseSaveMessage(
        options?.isPassengerChange
          ? '審査用デモとして旅客都合変更を完了しました。本番データには保存されていません。'
          : '審査用デモとして事前確定運賃を完了しました。本番データには保存されていません。',
      )
      setIsFixedCompleteLoading(false)
      return true
    }

    try {
      const completionPayload = buildCompleteFixedFareRunPayload(
        options?.preFixedFareException ?? null,
      )
      await completeFixedFareRun(reservationId, completionPayload)
      clearPersistedActiveTripSnapshot()
      clearReservationTripContext()
      setFixedCompleteState('done')
      setCaseSaveMessage(
        options?.isPassengerChange
          ? '案件を保存し、旅客都合変更による事前確定M途中終了を完了しました。当初の事前確定運賃額は変更していません。レシート・領収書は任意で発行できます。'
          : '案件を保存し、事前確定Mを完了しました。レシート・領収書は任意で発行できます。',
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '事前確定Mの完了に失敗しました。'
      setFixedCompleteState('error')
      setCaseSaveState('error')
      setCaseSaveMessage(`${message}\n\n案件は保存済みです。「完了APIを再試行」から再度お試しください。`)
      setTripStartNotice(message)
      return false
    } finally {
      setIsFixedCompleteLoading(false)
    }
  }

  const handleConfirmFixedTripComplete = async () => {
    const reservationId =
      fixedFareRun?.reservationId ?? savedCaseRecord?.reservationId ?? ''

    if (!reservationId) {
      return
    }

    const succeeded = await completeFixedFareAfterSave(reservationId, {
      isPassengerChange: Boolean(savedCaseRecord?.preFixedFareException),
      preFixedFareException: savedCaseRecord?.preFixedFareException ?? pendingPassengerChangeException,
    })
    if (succeeded) {
      navigate(`/reservations/${encodeURIComponent(reservationId)}`)
    }
  }

  const handleSettlementFlowStart = () => {
    if (!handleSettlementStart()) {
      return
    }

    if (paymentTotalYen === 0) {
      setPaymentAmounts({
        ...createEmptyPaymentAmounts(),
        [paymentMethod]: settlementBreakdown.totalFareYen,
      })
    }

    setIsSettlementConfirmOpen(false)
    setIsSettlementFlowOpen(true)
    setSettlementFlowStep('receipt')
  }

  const clearSettlementHoldTimer = () => {
    if (settlementHoldTimerRef.current === null) {
      return
    }

    window.clearTimeout(settlementHoldTimerRef.current)
    settlementHoldTimerRef.current = null
  }

  const beginSettlementHold = () => {
    if (caseSaveState === 'saving' || !canOpenSettlement || settlementHoldTimerRef.current !== null) {
      return
    }

    settlementHoldTimerRef.current = window.setTimeout(() => {
      settlementHoldTimerRef.current = null
      setIsSettlementConfirmOpen(true)
    }, 900)
  }

  const cancelSettlementHold = () => {
    clearSettlementHoldTimer()
  }

  const confirmSettlementFlowStart = () => {
    clearSettlementHoldTimer()
    handleSettlementFlowStart()
  }

  const createSettlementEditSnapshot = () => JSON.stringify({
    activityHistories,
    expenses,
    isDisabilityDiscount,
    receiptName,
    selectedCareOptions,
    taxiTickets,
  })

  const openSettlementEdit = () => {
    setSettlementEditBaseline(createSettlementEditSnapshot())
    if (handleStatusChange('精算修正')) {
      setCaseSaveState('idle')
      setCaseSaveMessage(
        meterMode === 'fixed'
          ? '精算修正中です。介助・実費・タクシー券・割引・宛名のみ修正できます。'
          : '精算修正中です。距離・時間は固定し、介助・実費・タクシー券・割引・宛名のみ修正できます。',
      )
    }
  }

  const completeSettlementEdit = async () => {
    const beforeSnapshot = settlementEditBaseline
    const afterSnapshot = createSettlementEditSnapshot()

    if (!handleStatusChange('精算前')) {
      return
    }

    if (beforeSnapshot && beforeSnapshot !== afterSnapshot && workSession.currentSession) {
      await createAuditLog({
        action: 'settlement_edit',
        actor: {
          userId: workSession.currentSession.staffId,
          userName: workSession.currentSession.staffName,
          role: workSession.currentSession.staffRole,
          franchiseeId: workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
          storeId: workSession.currentSession.storeId,
        },
        targetId: caseNumber,
        targetType: 'activeTrip',
        before: JSON.parse(beforeSnapshot),
        after: JSON.parse(afterSnapshot),
        reason: '精算前修正',
      })
    }
    setSettlementEditBaseline(null)
    setCaseSaveMessage('精算修正を完了しました。支払総額を確認して保存してください。')
  }

  const recordActivityEditAudit = async ({
    after,
    before,
    editType,
  }: {
    after: ActivityHistoryEntry | null
    before: ActivityHistoryEntry
    editType: 'delete' | 'update'
  }) => {
    if (!workSession.currentSession) {
      return
    }
    await createAuditLog({
      action: 'activity_edit',
      actor: {
        userId: workSession.currentSession.staffId,
        userName: workSession.currentSession.staffName,
        role: workSession.currentSession.staffRole,
        franchiseeId: workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
        storeId: workSession.currentSession.storeId,
      },
      targetId: caseNumber,
      targetType: 'activeTrip',
      before: {
        activityType: before.type,
        beforeEndAt: before.endAt,
        beforeStartAt: before.startAt,
        editType,
      },
      after: {
        activityType: before.type,
        afterEndAt: after?.endAt ?? '',
        afterStartAt: after?.startAt ?? '',
        editType,
      },
      reason: editType === 'delete' ? `${getActivityLabel(before.type)}履歴削除` : `${getActivityLabel(before.type)}履歴修正`,
    })
  }

  const deleteActivityHistory = async (historyId: string) => {
    const targetHistory = activityHistories.find((history) => history.id === historyId)
    if (!targetHistory) {
      return
    }
    const activityLabel = getActivityLabel(targetHistory.type)
    const durationMinutes = calculateActivityHistoryMinutes(targetHistory)
    if (!window.confirm(`${activityLabel}（${durationMinutes}分）を削除しますか？`)) {
      return
    }
    setActivityHistories((currentHistories) =>
      currentHistories.filter((history) => history.id !== historyId),
    )
    await recordActivityEditAudit({ after: null, before: targetHistory, editType: 'delete' })
  }

  const updateActivityHistory = async (
    historyId: string,
    field: 'endAt' | 'startAt',
    value: string,
  ) => {
    const nextIsoValue = parseDateTimeLocalValue(value)
    if (!nextIsoValue) {
      return
    }
    const targetHistory = activityHistories.find((history) => history.id === historyId)
    if (!targetHistory) {
      return
    }
    const nextHistory = { ...targetHistory, [field]: nextIsoValue }
    const startAt = new Date(nextHistory.startAt).getTime()
    const endAt = new Date(nextHistory.endAt).getTime()
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      setCaseSaveMessage('時間履歴は終了時刻が開始時刻より後になるように入力してください。')
      return
    }
    setActivityHistories((currentHistories) =>
      currentHistories.map((history) => history.id === historyId ? nextHistory : history),
    )
    await recordActivityEditAudit({ after: nextHistory, before: targetHistory, editType: 'update' })
  }

  const undoRecentActivity = async () => {
    const currentActivity = activeActivity
    if (!currentActivity) {
      return
    }
    const elapsedSeconds = Math.floor((new Date().getTime() - new Date(currentActivity.startAt).getTime()) / 1000)
    if (elapsedSeconds > 30) {
      return
    }
    setActiveActivity(null)
    setCaseSaveMessage(`${getActivityLabel(currentActivity.type)}の直前操作を取り消しました。`)
    if (handleStatusChange('走行中')) {
      await recordActivityEditAudit({
        after: null,
        before: { ...currentActivity, endAt: new Date().toISOString() },
        editType: 'delete',
      })
    }
  }

  const beginResumeHold = () => {
    if (status !== '精算前' || resumeHoldTimerRef.current !== null) {
      return
    }
    resumeHoldTimerRef.current = window.setTimeout(() => {
      resumeHoldTimerRef.current = null
      void handleResumeTrip()
    }, 1000)
  }

  const cancelResumeHold = () => {
    if (resumeHoldTimerRef.current === null) {
      return
    }
    window.clearTimeout(resumeHoldTimerRef.current)
    resumeHoldTimerRef.current = null
  }

  const handleResumeTrip = async () => {
    if (status !== '精算前') {
      return
    }

    if (hasPassengerChangeTermination) {
      setCaseSaveMessage('旅客都合変更による途中終了後は、同一案件の運行再開はできません。')
      return
    }

    if (!window.confirm('追加送迎・行先変更として運行を再開しますか？タクシー券・実費・領収書情報・支払方法はリセットします。')) {
      return
    }
    const before = {
      expenses,
      paymentAmounts,
      paymentMethod,
      receiptName,
      status,
      taxiTickets,
    }
    setTaxiTickets([])
    setExpenses([])
    setReceiptName('')
    setPaymentMethod('現金')
    setPaymentAmounts(createEmptyPaymentAmounts())
    setIsSettlementFlowOpen(false)
    setCaseSaveState('idle')
    setCaseSaveMessage(
      meterMode === 'fixed'
        ? '運行を再開しました。'
        : '運行を再開しました。距離・時間は継続して計測します。',
    )
    handleStatusChange('走行中')
    if (workSession.currentSession) {
      await createAuditLog({
        action: 'settlement_resume',
        actor: {
          userId: workSession.currentSession.staffId,
          userName: workSession.currentSession.staffName,
          role: workSession.currentSession.staffRole,
          franchiseeId: workSession.currentSession.franchiseeId || workSession.currentSession.companyId,
          storeId: workSession.currentSession.storeId,
        },
        targetId: caseNumber,
        targetType: 'activeTrip',
        before,
        after: { status: '走行中', expenses: [], taxiTickets: [], receiptName: '', paymentMethod: '現金' },
        reason: '運行再開',
      })
    }
  }

  const handleStatusChange = (nextStatus: OperationStatus) => {
    if (!canTransitionStatus(status, nextStatus)) {
      setCaseSaveState('error')
      setCaseSaveMessage(`現在の状態（${status}）から${nextStatus}へは切り替えできません。`)
      return false
    }

    const nowIso = new Date().toISOString()
    const currentActivity = statusActivityMap[status]
    const nextActivity = statusActivityMap[nextStatus]
    const nextActiveTimer = activeTimerMap[nextStatus] ?? null
    let nextActiveActivity = activeActivity
    let nextActivityHistories = activityHistories
    let nextTimerStartedAt: TimerStartedAtMap = { ...timerStartedAt }
    let nextBillableTimeStarted = billableTimeStarted

    if (currentActivity && currentActivity !== nextActivity && activeActivity?.type === currentActivity) {
      const startedAt = timerStartedAt[currentActivity] ?? activeActivity.startAt
      const finishedHistory = {
        ...activeActivity,
        startAt: startedAt,
        endAt: nowIso,
      }
      nextActiveActivity = null
      nextActivityHistories = [...activityHistories, finishedHistory]
      nextTimerStartedAt = { ...nextTimerStartedAt }
      delete nextTimerStartedAt[currentActivity]
    }

    if (nextActivity && currentActivity !== nextActivity) {
      nextActiveActivity = {
        endAt: '',
        id: createId(`activity-${nextActivity}`),
        startAt: nowIso,
        type: nextActivity,
      }
      nextTimerStartedAt = {
        ...nextTimerStartedAt,
        [nextActivity]: nowIso,
      }
    }

    if (nextStatus === '待機中' && status === '走行中') {
      nextBillableTimeStarted = { ...nextBillableTimeStarted, waiting: true }
    }

    if (nextStatus === '院内付き添い中') {
      nextBillableTimeStarted = { ...nextBillableTimeStarted, accompanying: true }
    }

    setActiveActivity(nextActiveActivity)
    setActivityHistories(nextActivityHistories)
    setTimerStartedAt(nextTimerStartedAt)
    setBillableTimeStarted(nextBillableTimeStarted)
    setStatus(nextStatus)
    setActiveTimer(nextActiveTimer)

    if (nextStatus === '走行中' && meterMode !== 'fixed') {
      setIsGpsActive(true)
      if (
        meterMode === 'obd' &&
        (status === '待機中' || status === '院内付き添い中' || status === '精算前' || status === '精算修正')
      ) {
        void connectObd({ interactive: false, isReconnect: true })
      }
    }

    if (nextStatus === '空車' || nextStatus === '案件終了') {
      setIsGpsActive(false)
    }

    if (nextStatus === '案件終了' && meterMode === 'obd') {
      void disconnectObd()
    }

    // Persist immediately on waiting / accompanying transitions so power-off keeps the start time.
    if (isProtectedOperationStatus(nextStatus) && caseSaveState !== 'saved') {
      persistActiveTripSnapshot({
        activeTimer: nextActiveTimer,
        activityHistories: nextActivityHistories,
        billableTimeStarted: nextBillableTimeStarted,
        caseNumber,
        caseNumberAssignment: caseNumberAssignmentRef.current,
        capturedAt: nowIso,
        distances: {
          businessDistanceKm: gps.businessDistanceKm,
          chargeableDistanceKm: gps.chargeableDistanceKm,
        },
        dropoffLocation,
        fareSnapshot: fareSnapshotRef.current,
        fareTotalYen: settlementBreakdown.totalFareYen,
        gps: {
          currentSpeedKmh: gps.currentSpeedKmh,
          gpsLogCount: gps.gpsLogCount,
          lowSpeedSeconds: gps.lowSpeedSeconds,
          movementState: gps.movementState,
          position: gps.position,
          speedSource: gps.speedSource,
        },
        isDisabilityDiscount,
        operationEndedAt: operationEndedAtRef.current,
        operationStartedAt: operationStartedAtRef.current,
        paymentAmounts,
        paymentMethod,
        pickupLocation,
        selectedCareOptions,
        selectedDispatchCharges,
        selectedExpenses: expenses,
        customFees,
        selectedSpecialVehicleCharges,
        selectedVehicleId,
        status: nextStatus,
        meterMode,
        timerStartedAt: nextTimerStartedAt,
        ...(meterMode === 'fixed' && fixedFareRun
          ? {
              reservationId: fixedFareRun.reservationId,
              confirmedFareYen: fixedFareRun.confirmedFareYen,
              snapshotHash: fixedFareRun.snapshotHash,
              additionalRouteFareYen,
              additionalCareFareYen,
              routeChangeLogs,
              preFixedOverallStops,
              preFixedSegmentIndex,
              preFixedFareException: pendingPassengerChangeExceptionRef.current,
            }
          : {}),
        taxiTickets,
        timers: elapsedTimers.seconds,
      })
    }

    return true
  }


  const handleCaseClose = async () => {
    if (caseSaveState === 'saved' || caseSaveState === 'saving') {
      if (meterMode !== 'fixed' || fixedCompleteState === 'done') {
        clearPersistedActiveTripSnapshot()
      }
      handleStatusChange('案件終了')
      return savedCaseRecord
    }

    const selectedVehicle: Vehicle | null =
      vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null

    if (!workSession.currentSession) {
      setCaseSaveState('error')
      setCaseSaveMessage('TOP画面で出勤してから案件を保存してください。')
      return null
    }

    if (!selectedVehicle) {
      setCaseSaveState('error')
      setCaseSaveMessage('案件車両を選択してください。')
      return null
    }

    if (status !== '精算前') {
      setCaseSaveState('error')
      setCaseSaveMessage('精算前の状態で保存してください。')
      return null
    }

    if (!operationEndedAtRef.current) {
      const endedAt = new Date().toISOString()
      operationEndedAtRef.current = endedAt
    }
    if (paymentTotalYen !== settlementBreakdown.totalFareYen) {
      setCaseSaveState('error')
      setCaseSaveMessage('支払総額と請求額が一致しないため保存できません。')
      return null
    }

    const finalDrivingSeconds = elapsedTimers.seconds.driving

    handleStatusChange('案件終了')
    setCaseSaveState('saving')
    setCaseSaveMessage(
      reviewDemoMode ? '審査用デモデータを保存中です。' : 'Firestoreへ保存中です。',
    )

    try {
      const gpsLogsToSave = gps.gpsRaw.getGpsLogs()
      console.log('[GPS_ROUTE_DEBUG_1]', {
        gpsLogCount: gpsLogsToSave.length,
        chargeableDistanceKm: gps.chargeableDistanceKm,
        businessDistanceKm: gps.businessDistanceKm,
      })

      if (pickupCapturePromiseRef.current) {
        await pickupCapturePromiseRef.current
      }

      if (!pickupLocationRef.current.capturedAt || !pickupLocationRef.current.address) {
        await capturePickupLocation()
      }

      if (dropoffCapturePromiseRef.current) {
        await dropoffCapturePromiseRef.current
      }

      if (!dropoffLocationRef.current.capturedAt || !dropoffLocationRef.current.address) {
        await captureDropoffLocation()
      }

      const closedAt = new Date().toISOString()
      const currentCaseNumberAssignment = caseNumberAssignmentRef.current
      const currentFareSnapshot = fareSnapshotRef.current
      const preFixedFareSaveExtras =
        meterMode === 'fixed' && fixedFareRun
          ? pendingPassengerChangeException
            ? {
                fareMode: FARE_MODE_PRE_FIXED,
                completionReason: 'passenger_requested_route_change' as const,
                preFixedFareException: pendingPassengerChangeException,
                recordStatus: 'completed_with_passenger_change' as const,
              }
            : { fareMode: FARE_MODE_PRE_FIXED }
          : {}
      const comparisonFares =
        meterMode === 'fixed'
          ? {
              gpsComparisonFareYen: null,
              obdComparisonFareYen: null,
              timeComparisonFareYen: null,
            }
          : calculateMeterComparisonFares({
              careOptions: selectedCareOptions,
              customFees,
              dispatchCharges: selectedDispatchCharges,
              distanceKm: gps.chargeableDistanceKm,
              drivingSeconds: finalDrivingSeconds,
              escortSeconds: escortFareSeconds,
              expenses,
              isDisabilityDiscount,
              lowSpeedSeconds: gps.lowSpeedSeconds,
              meterSettings: latestMeterSettingsRef.current,
              specialVehicleCharges: selectedSpecialVehicleCharges,
              taxiTickets,
              waitingSeconds: adjustedWaitingSeconds,
            })

      if (reviewDemoMode) {
        const savedRecord = buildReviewDemoSavedCaseRecord({
          caseNumber,
          caseNumberAssignment: currentCaseNumberAssignment,
          fareSnapshot: currentFareSnapshot,
          closedAt,
          startedAt: operationStartedAtRef.current,
          endedAt: operationEndedAtRef.current,
          settlementBreakdown,
          paymentMethod,
          payments,
          receiptName,
          reservationTripContext,
          fixedFareRun,
          additionalRouteFareYen,
          additionalCareFareYen,
          routeChangeLogs,
          preFixedFareSaveExtras,
          pickupLocation: pickupLocationRef.current,
          dropoffLocation: dropoffLocationRef.current,
          drivingSeconds: finalDrivingSeconds,
          waitingSeconds: adjustedWaitingSeconds,
          accompanyingSeconds: adjustedAccompanyingSeconds,
        })

        clearReviewDemoActiveTripSnapshot()
        writeReviewDemoPostSettlementLock(caseNumber)
        setPostSettlementLock({
          caseNumber,
          lockedAt: new Date().toISOString(),
        })
        setSavedCaseRecord(savedRecord)
        setCaseSaveState('saved')
        setCaseSaveMessage(
          '審査用デモとして保存しました（本番データには保存されていません）。レシート・領収書は任意で発行できます。',
        )
        return savedRecord
      }

      const savedRecordRef = await saveCaseRecord({
        caseNumber,
        caseDate: currentCaseNumberAssignment?.caseDate,
        storeCode: currentCaseNumberAssignment?.storeCode,
        dailySequence: currentCaseNumberAssignment?.dailySequence,
        fareSnapshot: currentFareSnapshot,
        closedAt,
        startedAt: operationStartedAtRef.current,
        endedAt: operationEndedAtRef.current,
        distanceKm: gps.chargeableDistanceKm,
        chargeableDistanceKm: gps.chargeableDistanceKm,
        businessDistanceKm: gps.businessDistanceKm,
        drivingSeconds: finalDrivingSeconds,
        waitingSeconds: adjustedWaitingSeconds,
        accompanyingSeconds: adjustedAccompanyingSeconds,
        workSession: workSession.currentSession,
        vehicle: selectedVehicle,
        fareBreakdown: settlementBreakdown,
        paymentMethod,
        payments,
        receiptName,
        taxiTickets,
        pickupLocation: pickupLocationRef.current,
        selectedCareOptions,
        selectedCustomFees: customFees,
        selectedDispatchCharges,
        selectedSpecialVehicleCharges,
        selectedExpenses: expenses,
        dropoffLocation: dropoffLocationRef.current,
        gpsComparisonFareYen: comparisonFares.gpsComparisonFareYen,
        timeComparisonFareYen: comparisonFares.timeComparisonFareYen,
        obdComparisonFareYen: comparisonFares.obdComparisonFareYen,
        ...(meterMode === 'fixed' && fixedFareRun
          ? {
              reservationId: fixedFareRun.reservationId,
              confirmedFareYen: fixedFareRun.confirmedFareYen,
              snapshotHash: fixedFareRun.snapshotHash,
              additionalRouteFareYen,
              additionalCareFareYen: settlementBreakdown.additionalCareFareYen ?? additionalCareFareYen,
              routeChangeLogs,
            }
          : {}),
        ...preFixedFareSaveExtras,
      })
      const savedRecord: StoredCaseRecord = {
        id: savedRecordRef.id,
        caseNumber,
        caseDate: currentCaseNumberAssignment?.caseDate ?? '',
        storeCode: currentCaseNumberAssignment?.storeCode ?? '',
        dailySequence: currentCaseNumberAssignment?.dailySequence ?? 0,
        fareSnapshot: currentFareSnapshot,
        closedAt,
        startedAt: operationStartedAtRef.current,
        endedAt: operationEndedAtRef.current,
        distanceKm: Number(gps.chargeableDistanceKm.toFixed(3)),
        chargeableDistanceKm: Number(gps.chargeableDistanceKm.toFixed(3)),
        businessDistanceKm: Number(gps.businessDistanceKm.toFixed(3)),
        drivingSeconds: finalDrivingSeconds,
        waitingSeconds: adjustedWaitingSeconds,
        accompanyingSeconds: adjustedAccompanyingSeconds,
        companyId: workSession.currentSession?.franchiseeId || workSession.currentSession?.companyId || '',
        franchiseeId: workSession.currentSession?.franchiseeId || workSession.currentSession?.companyId || '',
        companyName: workSession.currentSession?.companyName ?? '',
        staffId: workSession.currentSession?.staffId ?? '',
        driverId: workSession.currentSession?.staffId ?? '',
        staffName: workSession.currentSession?.staffName ?? '',
        staffRole: workSession.currentSession?.staffRole ?? '',
        vehicleId: selectedVehicle.id,
        vehicleName: selectedVehicle.name,
        vehicleNumber: selectedVehicle.number,
        workSessionId: workSession.currentSession?.id ?? '',
        storeId: workSession.currentSession?.storeId ?? '',
        storeName: workSession.currentSession?.storeName ?? '',
        dispatchFareYen: settlementBreakdown.dispatchFareYen,
        specialVehicleFareYen: settlementBreakdown.specialVehicleFareYen,
        basicFareYen: settlementBreakdown.basicFareYen,
        meterTimeFareYen: settlementBreakdown.meterTimeFareYen,
        waitingFareYen: settlementBreakdown.waitingFareYen,
        escortFareYen: settlementBreakdown.escortFareYen,
        careOptionFareYen: settlementBreakdown.careOptionFareYen,
        customFeeFareYen: settlementBreakdown.customFeeFareYen,
        expenseFareYen: settlementBreakdown.expenseFareYen,
        normalFareYen: settlementBreakdown.normalFareYen,
        nightSurchargeYen: settlementBreakdown.nightSurchargeYen,
        totalFareYen: settlementBreakdown.totalFareYen,
        grossFareYen: settlementBreakdown.grossFareYen,
        discountableFareYen: settlementBreakdown.discountableFareYen,
        isDisabilityDiscount: settlementBreakdown.isDisabilityDiscount,
        disabilityDiscountRate: settlementBreakdown.disabilityDiscountRate,
        disabilityDiscountAmount: settlementBreakdown.disabilityDiscountAmount,
        discountName: settlementBreakdown.discountName,
        discountMethod: settlementBreakdown.discountMethod,
        discountValue: settlementBreakdown.discountValue,
        taxiTicketAmountYen: settlementBreakdown.taxiTicketAmountYen,
        taxiTickets,
        paymentMethod,
        payments,
        receiptName,
        customerName: receiptName,
        remarks: pendingPassengerChangeException?.note ?? '',
        status: preFixedFareSaveExtras.recordStatus ?? 'completed',
        deleted: false,
        deletedAt: '',
        deletedBy: '',
        deleteReason: '',
        restoredAt: '',
        restoredBy: '',
        cancelReason: '',
        canceledAt: '',
        cancelledBy: '',
        receiptReissues: [],
        settlementAdjustments: [],
        changeHistory: [],
        pickupLatitude: pickupLocationRef.current.latitude,
        pickupLongitude: pickupLocationRef.current.longitude,
        pickupAddress: pickupLocationRef.current.address,
        pickupArea: extractAreaFromAddress(pickupLocationRef.current.address),
        pickupCapturedAt: pickupLocationRef.current.capturedAt,
        dropoffLatitude: dropoffLocationRef.current.latitude,
        dropoffLongitude: dropoffLocationRef.current.longitude,
        dropoffAddress: dropoffLocationRef.current.address,
        dropoffArea: extractAreaFromAddress(dropoffLocationRef.current.address),
        dropoffCapturedAt: dropoffLocationRef.current.capturedAt,
        assistCharges: selectedCareOptions.map((careOption) => ({
          id: careOption.masterId,
          name: careOption.name,
          amount: careOption.amountYen,
        })),
        customFees: customFees.map((customFee) => ({
          name: customFee.name,
          amount: customFee.amount,
        })),
        dispatchCharges: selectedDispatchCharges.map((dispatchCharge) => ({
          id: dispatchCharge.masterId,
          name: dispatchCharge.name,
          amount: dispatchCharge.amountYen,
        })),
        specialVehicleCharges: selectedSpecialVehicleCharges.map((specialVehicleCharge) => ({
          id: specialVehicleCharge.masterId,
          name: specialVehicleCharge.name,
          amount: specialVehicleCharge.amountYen,
        })),
        expenseCharges: expenses.map((expense) => ({
          id: expense.id,
          name: expense.name,
          amount: expense.amountYen,
        })),
        timeDiscountEnabled: settlementBreakdown.timeMeter?.timeDiscountEnabled ?? false,
        legalTimeFare: settlementBreakdown.timeMeter?.legalTimeFare ?? 0,
        timeDiscountAmount: settlementBreakdown.timeMeter?.timeDiscountAmount ?? 0,
        actualTimeFare: settlementBreakdown.timeMeter?.actualTimeFare ?? 0,
        initialMinutes: settlementBreakdown.timeMeter?.initialMinutes ?? 0,
        additionalSeconds: settlementBreakdown.timeMeter?.additionalSeconds ?? 0,
        meterMode: settlementBreakdown.meterMode,
        actualMeterMode: settlementBreakdown.meterMode,
        actualFareYen: settlementBreakdown.totalFareYen,
        gpsComparisonFareYen: comparisonFares.gpsComparisonFareYen,
        timeComparisonFareYen: comparisonFares.timeComparisonFareYen,
        obdComparisonFareYen: comparisonFares.obdComparisonFareYen,
        ...(meterMode === 'fixed' && fixedFareRun
          ? {
              reservationId: fixedFareRun.reservationId,
              confirmedFareYen: fixedFareRun.confirmedFareYen,
              snapshotHash: fixedFareRun.snapshotHash,
              additionalRouteFareYen,
              additionalCareFareYen: settlementBreakdown.additionalCareFareYen ?? additionalCareFareYen,
              routeChangeLogs,
            }
          : {}),
        ...preFixedFareSaveExtras,
      }

      let gpsRouteSaveFailed = false

      console.log('[GPS_ROUTE_DEBUG_2]', {
        willCallSaveGpsRoute: gpsLogsToSave.length > 0,
        gpsLogCount: gpsLogsToSave.length,
        caseRecordId: savedRecordRef.id,
      })

      if (gpsLogsToSave.length > 0) {
        try {
          const gpsRouteSaved = await saveGpsRoute({
            caseRecordId: savedRecordRef.id,
            caseNumber,
            franchiseeId:
              workSession.currentSession?.franchiseeId ||
              workSession.currentSession?.companyId ||
              '',
            storeId: workSession.currentSession?.storeId ?? '',
            staffId: workSession.currentSession?.staffId ?? '',
            staffName: workSession.currentSession?.staffName ?? '',
            vehicleId: selectedVehicle.id,
            vehicleName: selectedVehicle.name,
            closedAt,
            logs: gpsLogsToSave,
          })

          if (!gpsRouteSaved) {
            gpsRouteSaveFailed = true
            console.warn('GPS route was not saved because no valid GPS points were available.', {
              caseRecordId: savedRecordRef.id,
              gpsLogCount: gpsLogsToSave.length,
            })
          }
        } catch (gpsRouteError) {
          gpsRouteSaveFailed = true
          console.error('[GPS_ROUTE_DEBUG_ERROR]', gpsRouteError)
          console.warn('Failed to save GPS route to Firestore.', gpsRouteError)
        }
      }

      if (meterMode !== 'fixed') {
        clearPersistedActiveTripSnapshot()
      }

      const workSessionId = workSession.currentSession?.id
      if (workSessionId && selectedVehicle.id) {
        try {
          await releaseVehicleFromCase({
            vehicleId: selectedVehicle.id,
            workSessionId,
          })
        } catch (releaseError) {
          console.warn('Failed to release vehicle after case save.', releaseError)
        }
      }

      setSavedCaseRecord(savedRecord)
      setCaseSaveState('saved')
      writePostSettlementLock(caseNumber)
      setPostSettlementLock({
        caseNumber,
        lockedAt: new Date().toISOString(),
      })
      setCaseSaveMessage(
        pendingPassengerChangeException
          ? '旅客都合変更による途中終了として保存しました。当初の事前確定運賃額は変更していません。レシート・領収書は任意で発行できます。'
          : gpsRouteSaveFailed
            ? '案件は保存されましたが、GPSルートの保存に失敗しました。レシート・領収書は任意で発行できます。「新しい案件を開始」から次の案件へ進めます。'
            : 'Firestoreへ保存しました。レシート・領収書は任意で発行できます。「新しい案件を開始」から次の案件へ進めます。',
      )
      return savedRecord
    } catch (error) {
      console.error('Failed to save case record to Firestore', error)
      setCaseSaveState('error')
      setCaseSaveMessage(
        error instanceof Error
          ? `保存に失敗しました。${error.message}`
          : '保存に失敗しました。通信状況とFirebase設定を確認してください。',
      )
      return null
    }
  }

  const handleSettlementSave = async () => {
    const savedRecord = await handleCaseClose()

    if (savedRecord) {
      setSavedCaseRecord(savedRecord)
      setSettlementFlowStep('receipt')

      if (meterMode === 'fixed') {
        const reservationId = fixedFareRun?.reservationId ?? savedRecord.reservationId ?? ''
        if (reservationId) {
          await completeFixedFareAfterSave(reservationId, {
            isPassengerChange: Boolean(savedRecord.preFixedFareException),
            preFixedFareException:
              savedRecord.preFixedFareException ?? pendingPassengerChangeException,
          })
        }
      }
    }
  }

  const updateBasicFareSetting = (
    key: keyof BasicFareSettings,
    value: string,
  ) => {
    setCurrentBasicFareSettings((settings) => ({
      ...settings,
      [key]: toPositiveNumber(
        value,
        key.includes('Distance') ? 0.001 : 0,
      ),
    }))
  }

  const updateTimeFareSetting = (
    setter: Dispatch<SetStateAction<TimeFareSettings>>,
    value: string,
  ) => {
    setter((settings) => ({
      ...settings,
      unitFareYen: toPositiveNumber(value),
      unitSeconds: fixedTimeFareUnitSeconds,
    }))
  }

  const updateCareOptionAmount = (id: string, value: string) => {
    setCurrentCareOptionMaster((options) =>
      options.map((option) =>
        option.id === id
          ? { ...option, amount: toPositiveNumber(value) }
          : option,
      ),
    )
  }

  const updateExpensePreset = (
    id: string,
    key: 'defaultAmountYen' | 'name',
    value: string,
  ) => {
    setCurrentExpensePresets((presets) =>
      presets.map((preset) =>
        preset.id === id
          ? {
              ...preset,
              [key]: key === 'name' ? value.trimStart() : toPositiveNumber(value),
            }
          : preset,
      ),
    )
  }

  const completeReceiptIssuance = () => {
    setSettlementFlowStep('saved')
  }

  const handleThermalReceiptPrint = async () => {
    console.log('[PRINT] button clicked')

    if (!savedCaseRecord) {
      return
    }

    let issueOptions = {
      customerName: savedCaseRecord.receiptName || receiptName,
      expenseItems: expenses,
      issuerName: '',
      receiptNote: '',
    }

    setPrinterConnectionDiagnostics([])

    try {
      await thermalPrinterService.connectIfNeeded()
      setPrinterConnectionDiagnostics(thermalPrinterService.getLastConnectionDiagnostics())
      console.error('[CasePage] 領収書印刷: プリンター接続成功', {
        connectionMethod: thermalPrinterService.getActiveMethod(),
      })

      const latestMeterSettings = await fetchMeterSettings({
        franchiseeId: currentFranchiseeId,
        storeId: currentStoreId,
      })
      issueOptions = {
        customerName: issueOptions.customerName,
        expenseItems: issueOptions.expenseItems,
        issuerName: latestMeterSettings.receipt.issuerName,
        receiptNote: latestMeterSettings.receipt.defaultReceiptNote,
      }

      const receiptData = buildThermalReceiptEscPos(
        savedCaseRecord,
        latestMeterSettings,
        issueOptions,
      )
      await thermalPrinterService.printReceipt(receiptData)
      completeReceiptIssuance()
      setCaseSaveMessage('領収書を印刷しました。')
    } catch (error) {
      setPrinterConnectionDiagnostics(thermalPrinterService.getLastConnectionDiagnostics())
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[CasePage] 領収書印刷失敗', {
        connectionMethod: thermalPrinterService.getActiveMethod(),
        reason,
        error,
      })
      setCaseSaveMessage(
        isPrinterConnectionFailureMessage(reason)
          ? `プリンター接続失敗:\n${reason}`
          : `領収書印刷失敗:\n${reason}`,
      )

      try {
        const latestMeterSettings = await fetchMeterSettings({
          franchiseeId: currentFranchiseeId,
          storeId: currentStoreId,
        })
        const fallbackOptions = {
          customerName: issueOptions.customerName,
          expenseItems: issueOptions.expenseItems,
          issuerName: issueOptions.issuerName || latestMeterSettings.receipt.issuerName,
          receiptNote: issueOptions.receiptNote || latestMeterSettings.receipt.defaultReceiptNote,
        }
        await openThermalReceiptPdf(savedCaseRecord, latestMeterSettings, fallbackOptions)
        console.error('[CasePage] 領収書印刷: PDFフォールバックへ切り替え', {
          connectionMethod: thermalPrinterService.getActiveMethod(),
        })
        setCaseSaveMessage((currentMessage) =>
          `${currentMessage}\nプリンター再接続に失敗したためPDF表示へ切り替えました。`,
        )
      } catch (fallbackError) {
        console.error('[CasePage] 領収書印刷: PDFフォールバックも失敗', {
          connectionMethod: thermalPrinterService.getActiveMethod(),
          reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          error: fallbackError,
        })
        setCaseSaveMessage(
          fallbackError instanceof Error
            ? `領収書印刷に失敗しました。${fallbackError.message}`
            : '領収書印刷に失敗しました。',
        )
      }
    }
  }

  const handleThermalReceiptPdfDownload = async () => {
    if (!savedCaseRecord) {
      return
    }

    try {
      const latestMeterSettings = reviewDemoMode
        ? getReviewDemoMeterSettings()
        : await fetchMeterSettings({
            franchiseeId: currentFranchiseeId,
            storeId: currentStoreId,
          })
      await downloadThermalReceiptPdf(savedCaseRecord, latestMeterSettings, {
        customerName: savedCaseRecord.receiptName || receiptName,
        expenseItems: expenses,
        issuerName: latestMeterSettings.receipt.issuerName,
        receiptNote: latestMeterSettings.receipt.defaultReceiptNote,
      })
      setCaseSaveMessage('レシートPDFを保存しました。')
    } catch (error) {
      setCaseSaveMessage(
        error instanceof Error
          ? `レシートPDF保存に失敗しました。${error.message}`
          : 'レシートPDF保存に失敗しました。',
      )
    }
  }

  const handleA4ReceiptDownload = async () => {
    if (!savedCaseRecord) {
      return
    }

    try {
      const latestMeterSettings = reviewDemoMode
        ? getReviewDemoMeterSettings()
        : await fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
      await downloadReceiptPdf(savedCaseRecord, latestMeterSettings, {
        customerName: savedCaseRecord.receiptName || receiptName,
        issuerName: latestMeterSettings.receipt.issuerName,
        receiptNote: latestMeterSettings.receipt.defaultReceiptNote,
      })
      completeReceiptIssuance()
    } catch (error) {
      setCaseSaveMessage(
        error instanceof Error
          ? `領収書発行に失敗しました。${error.message}`
          : '領収書発行に失敗しました。',
      )
    }
  }

  const resetMeterSession = async () => {
    if (settlementHoldTimerRef.current !== null) {
      window.clearTimeout(settlementHoldTimerRef.current)
      settlementHoldTimerRef.current = null
    }
    if (resumeHoldTimerRef.current !== null) {
      window.clearTimeout(resumeHoldTimerRef.current)
      resumeHoldTimerRef.current = null
    }

    const session = workSession.currentSession
    if (session && selectedVehicleId) {
      try {
        await claimVehicleForCaseStart({
          vehicleId: selectedVehicleId,
          staffId: session.staffId,
          staffName: session.staffName,
          workSessionId: session.id,
        })
      } catch (error) {
        setCaseSaveMessage(
          error instanceof Error ? error.message : VEHICLE_IN_USE_MESSAGE,
        )
        navigate('/case/start')
        return
      }
    }

    if (meterMode === 'obd') {
      await disconnectObd()
    }

    const initialStatus = getInitialStatusAfterReset(meterMode)

    fareSnapshotRef.current = null
    caseNumberAssignmentRef.current = null
    operationStartedAtRef.current = ''
    operationEndedAtRef.current = ''
    pickupLocationRef.current = emptyCapturedAddressLocation
    dropoffLocationRef.current = emptyCapturedAddressLocation
    pickupCapturePromiseRef.current = null
    dropoffCapturePromiseRef.current = null
    obdRestoreConnectAttemptedRef.current = false
    obdIdleConnectAttemptedRef.current = false
    clearPersistedActiveTripSnapshot()
    clearPostSettlementLock()
    setPostSettlementLock(null)

    setCaseNumber('未採番')
    setIsFareSnapshotLocked(false)
    setStatus(initialStatus)
    setActiveTimer(null)
    setActivityHistories(emptyActivityHistories)
    setActiveActivity(null)
    setBillableTimeStarted({ accompanying: false, waiting: false })
    setIsGpsActive(false)
    setIsCareModalOpen(false)
    setIsExpenseModalOpen(false)
    setIsDispatchModalOpen(false)
    setIsSettlementFlowOpen(false)
    setIsSettlementConfirmOpen(false)
    setSettlementEditBaseline(null)
    setSelectedCareOptions([])
    setCustomFees([])
    setSelectedDispatchCharges([])
    setSelectedSpecialVehicleCharges([])
    setExpenses([])
    setIsDisabilityDiscount(false)
    setSettlementDiscount(currentMeterSettings.discount)
    setTaxiTickets([])
    setPaymentMethod('現金')
    setPaymentAmounts(createEmptyPaymentAmounts())
    setReceiptName('')
    setCaseSaveState('idle')
    setCaseSaveMessage('新しい案件を開始しました。送迎を開始できます。')
    setTripStartNotice('')
    setSavedCaseRecord(null)
    setPendingPassengerChangeException(null)
    setSettlementFlowStep('receipt')
    setPickupLocation(emptyCapturedAddressLocation)
    setDropoffLocation(emptyCapturedAddressLocation)
    waitingMovementAlert.resetAlertState()
    setSessionResetKey((currentKey) => currentKey + 1)
    setMeterResetKey((currentKey) => currentKey + 1)

    if (meterMode === 'obd') {
      void connectObd({ interactive: false, isReconnect: true })
    }
  }

  const handleStartNewCase = () => {
    void resetMeterSession()
  }

  const handleReturnToTop = () => {
    // 走行中・待機中・精算前・未保存中はロックを維持する（TOP表示自体も抑制されるが二重防御）
    const mustKeepVehicleLock =
      isCaseInProgress || isProtectedOperationStatus(status) || isSettlementInProgress

    if (mustKeepVehicleLock) {
      if (!window.confirm('TOPへ戻りますか？')) {
        return
      }
      navigate('/')
      return
    }

    const workSessionId = workSession.currentSession?.id
    const vehicleIdToRelease = selectedVehicleId
    // 空車などメーター開始前のキャンセル時のみ解除。保存済み後は保存時に解除済み。
    if (workSessionId && vehicleIdToRelease && !isPostSettlementAwaitingNewCase) {
      void releaseVehicleFromCase({
        vehicleId: vehicleIdToRelease,
        workSessionId,
      }).catch((error) => {
        console.warn('Failed to release vehicle on return to TOP.', error)
      })
    }

    navigate('/')
  }

  const handleWaitingMovementResumeTrip = () => {
    waitingMovementAlert.dismissAlert()
    handleStatusChange('走行中')
  }

  const handleWaitingMovementContinue = () => {
    waitingMovementAlert.snoozeAlert()
  }

  useEffect(() => {
    if (!areMeterPermissionsLoaded) {
      return
    }

    if (meterMode === 'fixed') {
      return
    }

    writeStoredMeterMode(meterMode)
  }, [areMeterPermissionsLoaded, meterMode])

  useEffect(() => {
    if (!currentFranchiseeId) {
      setMeterPermissions(defaultMeterPermissions)
      setAreMeterPermissionsLoaded(true)
      return
    }

    let isMounted = true

    void fetchCompanyById(currentFranchiseeId).then((company) => {
      if (!isMounted) {
        return
      }

      setMeterPermissions(getCompanyMeterPermissions(company))
      setAreMeterPermissionsLoaded(true)
    })

    return () => {
      isMounted = false
    }
  }, [currentFranchiseeId])

  useEffect(() => {
    if (!areMeterPermissionsLoaded) {
      return
    }

    if (meterMode === 'fixed') {
      return
    }

    if (isMeterModeAllowed(meterMode, meterPermissions)) return
    const fallbackMode = allowedMeterModes[0] ?? 'gps'
    if (fallbackMode === meterMode) return
    setMeterMode(fallbackMode)
    setCurrentMeterSettings(selectMeterModeSettings(latestMeterSettingsRef.current, fallbackMode))
  }, [allowedMeterModes, areMeterPermissionsLoaded, meterMode, meterPermissions])

  useEffect(() => {
    if (!meterModeToast) return
    const timerId = window.setTimeout(() => setMeterModeToast(''), 2500)
    return () => window.clearTimeout(timerId)
  }, [meterModeToast])

  useEffect(() => {
    if (!tripStartNotice) return
    const timerId = window.setTimeout(() => setTripStartNotice(''), 5000)
    return () => window.clearTimeout(timerId)
  }, [tripStartNotice])

  const timeFareElapsedLabel =
    meterMode === 'time' && timeMeterFareIncreaseProgress
      ? formatTimeMeterFareIncreaseProgressLabel(timeMeterFareIncreaseProgress)
      : `${Math.floor(gpsTimeFareElapsedSeconds / 60)}分 ${gpsTimeFareElapsedSeconds % 60}秒`
  const drivingClockLabel = formatTimerClock(elapsedTimers.seconds.driving)
  const waitingClockLabel = formatTimerClock(adjustedWaitingSeconds, true)
  const accompanyingClockLabel = formatTimerClock(adjustedAccompanyingSeconds, true)
  const waitingToggleLabel = status === '待機中' ? '待機終了' : '待機開始'
  const accompanyingToggleLabel = status === '院内付き添い中' ? '付き添い終了' : '付き添い開始'
  const canUndoRecentActivity = Boolean(
    activeActivity &&
    status === activityStatusMap[activeActivity.type],
  )

  const isObdConnectInProgress =
    meterMode === 'obd' &&
    (gps.obdConnectionPhase === 'connecting' ||
      gps.obdConnectionPhase === 'reconnecting' ||
      gps.obdConnectionPhase === 'stabilizing')

  const showObdConnectFab =
    meterMode === 'obd' &&
    !gps.isObdConnectedForStart &&
    !isObdConnectInProgress &&
    (
      (status === '空車' && !isGpsActive) ||
      (isGpsActive &&
        gps.needsObdInteractiveReconnect &&
        gps.obdConnectionPhase === 'disconnected')
    )

  const handleObdConnectFabClick = () => {
    if (isGpsActive && gps.needsObdInteractiveReconnect) {
      setObdConnectionDialogVariant('mid-trip')
      void handleObdReconnect()
      return
    }

    void connectObd({ interactive: true, isInitialTripConnect: true }).then((connected) => {
      if (!connected) {
        setObdConnectionDialogVariant('pre-trip')
        setIsObdConnectionDialogOpen(true)
      }
    })
  }

  const isPassengerChangeSavedCase = Boolean(
    savedCaseRecord?.preFixedFareException ?? pendingPassengerChangeException,
  )

  return (
    <main
      className={`r9-meter-page r9-meter-page--${statusToneMap[status]}`}
      aria-label="業務用メーター"
    >
      <div className="landscape-notice" role="status">
        <strong>メーター画面は横向きでご利用ください</strong>
        <span>端末を横向きにしてください。</span>
      </div>

      {isPostSettlementAwaitingNewCase ? (
        isPassengerChangeSavedCase ? (
          <PassengerChangePostSettlementBanner onStartRegularMeterTrip={handleStartRegularMeterTrip} />
        ) : (
          <PostSettlementBanner
            caseNumber={postSettlementCaseNumber}
            onStartNewCase={handleStartNewCase}
          />
        )
      ) : null}

      <div className="r9-meter-shell">
        <span className="meter-screw meter-screw--top-left" />
        <span className="meter-screw meter-screw--top-right" />
        <span className="meter-screw meter-screw--bottom-left" />
        <span className="meter-screw meter-screw--bottom-right" />

        <div className="r9-meter-console">
          <section className="r9-left-panel" aria-label="料金メーター">
            <section
              aria-label="現在料金"
              className="r9-fare-card"
            >
              <div className="r9-fare-screen">
                <h1>
                  合計金額
                  <span className="meter-mode-badge-row">
                    <span className={`meter-mode-badge meter-mode-badge--${meterMode}`}>
                      {meterMode === 'fixed' && reviewDemoMode
                        ? '事前確定運賃'
                        : meterModeLabels[meterMode]}
                    </span>
                    {meterMode === 'obd' ? (
                      <ObdConnectionIndicator indicator={gps.obdIndicator} />
                    ) : null}
                  </span>
                </h1>
                <div className="r9-fare-amount">
                  <strong>
                    {formatFareYen(
                      meterMode === 'fixed'
                        ? settlementBreakdown.totalFareYen
                        : fareBreakdown.totalFareYen,
                    )}
                  </strong>
                  <span className="r9-fare-unit">円</span>
                </div>
                {meterMode === 'fixed' ? (
                  <div className="fixed-fare-status-row">
                    <span className="fixed-fare-status-chip fixed-fare-status-chip--confirmed">
                      確定運賃
                    </span>
                    {reservationTripContext?.consentAt ? (
                      <span className="fixed-fare-status-chip fixed-fare-status-chip--agreed">
                        お客様同意済み
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {meterMode === 'fixed' && resolvedConfirmedFareYen > 0 ? (
                  reviewDemoMode ? (
                    <p className="fixed-fare-running-label">{REVIEW_DEMO_FARE_COMPOSITION_NOTE}</p>
                  ) : (
                    <p className="fixed-fare-running-label">
                      事前確定運賃 {formatFareYen(resolvedConfirmedFareYen)}円
                      {additionalRouteFareYen > 0
                        ? ` ＋ 追加区間 ${formatFareYen(additionalRouteFareYen)}円`
                        : ''}
                    </p>
                  )
                ) : null}
              </div>

              {meterModeToast ? <div className="meter-mode-toast" role="status">{meterModeToast}</div> : null}

              {meterMode !== 'fixed' ? (
              <div className="fare-increase-stack" aria-label="加算インジケーター">
                {meterMode !== 'time' ? (
                  <div className={`fare-increase-panel ${status === '走行中' && gps.movementState === 'normal' ? 'fare-increase-panel--active' : ''}`}>
                    <span className="fare-increase-icon" aria-hidden="true">●</span>
                    <div className="fare-increase-content">
                      <div className="fare-increase-panel__label">
                        <span>距離加算まで</span>
                        <strong>{distanceFareElapsedMeters}m / {distanceFareUnitMeters}m</strong>
                      </div>
                      <div className="fare-increase-track">
                        <span style={{ width: `${fareIncreasePercent}%` }} />
                        <i />
                      </div>
                    </div>
                  </div>
                ) : null}

                <div
                  className={`fare-increase-panel fare-increase-panel--time ${
                    meterMode === 'time'
                      ? status === '走行中'
                        ? 'fare-increase-panel--active'
                        : ''
                      : status === '走行中' && gps.movementState === 'low-speed'
                        ? 'fare-increase-panel--active'
                        : ''
                  }`}
                >
                  <span className="fare-increase-icon" aria-hidden="true">◷</span>
                  <div className="fare-increase-content">
                    <div className="fare-increase-panel__label">
                      <span>{timeFareIndicatorLabel}</span>
                      <strong>{timeFareElapsedLabel}</strong>
                    </div>
                    <div className="fare-increase-track">
                      <span style={{ width: `${timeFareIncreasePercent}%` }} />
                      <i />
                    </div>
                  </div>
                </div>
              </div>
              ) : null}
            </section>

            <section className="r9-driving-card" aria-label="走行情報">
              {meterMode !== 'time' && meterMode !== 'fixed' ? (
                <div className="r9-drive-summary">
                  <div className="r9-speed-gauge">
                    <span>現在速度</span>
                    <strong>{currentSpeedValueLabel}</strong>
                    <em>km/h</em>
                  </div>
                  <button
                    className={`r9-business-distance-toggle ${isBusinessDistanceVisible ? 'r9-business-distance-toggle--open' : ''}`}
                    type="button"
                    aria-pressed={isBusinessDistanceVisible}
                    onClick={() => setIsBusinessDistanceVisible((current) => !current)}
                  >
                    {isBusinessDistanceVisible ? (
                      <>
                        <span>実走行距離（営業距離）</span>
                        <strong>{gps.businessDistanceKm.toFixed(1)}<em>km</em></strong>
                        <small>（タップで距離加算距離表示）</small>
                      </>
                    ) : (
                      <>
                        <span>距離加算距離（運賃距離）</span>
                        <strong>{gps.chargeableDistanceKm.toFixed(1)}<em>km</em></strong>
                        <small>（タップで実走行距離表示）</small>
                      </>
                    )}
                  </button>
                </div>
              ) : null}

              {meterMode === 'fixed' && isFixedInOperation ? (
                <div className="pre-fixed-time-fare-rates" aria-label="待機料・付き添い料">
                  <div>
                    <strong>待機料</strong>
                    <p>初期30分 一律 {formatFareYen(currentWaitingFareSettings.unitFareYen)}円</p>
                    <p>30分1秒以降 30分ごと {formatFareYen(currentWaitingFareSettings.unitFareYen)}円</p>
                    <small>計測中 {waitingClockLabel}</small>
                  </div>
                  <div>
                    <strong>付き添い料</strong>
                    <p>初期30分 一律 {formatFareYen(currentEscortFareSettings.unitFareYen)}円</p>
                    <p>30分1秒以降 30分ごと {formatFareYen(currentEscortFareSettings.unitFareYen)}円</p>
                    <small>計測中 {accompanyingClockLabel}</small>
                  </div>
                </div>
              ) : null}

              {meterMode === 'fixed' && isFixedInOperation ? (
                <div className="pre-fixed-route-summary" aria-label="ルート情報">
                  <div>
                    <span>全体ルート</span>
                    <strong>{overallRouteLabel || '—'}</strong>
                  </div>
                  <div>
                    <span>現在区間</span>
                    <strong>{currentSegmentLabel || '—'}</strong>
                  </div>
                </div>
              ) : null}

              {meterMode === 'fixed' && isFixedPassengerChangePreSettlement ? (
                <div className="pre-fixed-terminated-panel" aria-label="旅客都合変更による途中終了">
                  <p className="pre-fixed-terminated-panel__message">
                    旅客都合変更により事前確定運賃を途中終了しました。
                  </p>
                  <dl className="pre-fixed-terminated-panel__summary">
                    <div>
                      <dt>元の事前確定運賃</dt>
                      <dd>{formatFareYen(resolvedConfirmedFareYen)}円</dd>
                    </div>
                    <div>
                      <dt>追加区間運賃</dt>
                      <dd>{formatFareYen(additionalRouteFareYen)}円</dd>
                    </div>
                    <div>
                      <dt>追加介助料</dt>
                      <dd>{formatFareYen(settlementBreakdown.additionalCareFareYen ?? 0)}円</dd>
                    </div>
                    <div>
                      <dt>待機/付き添い料金</dt>
                      <dd>
                        {formatFareYen(
                          settlementBreakdown.waitingFareYen + settlementBreakdown.escortFareYen,
                        )}円
                      </dd>
                    </div>
                    <div>
                      <dt>実費</dt>
                      <dd>{formatFareYen(settlementBreakdown.expenseFareYen)}円</dd>
                    </div>
                    <div className="pre-fixed-terminated-panel__total">
                      <dt>合計請求額</dt>
                      <dd>{formatFareYen(settlementBreakdown.totalFareYen)}円</dd>
                    </div>
                  </dl>
                  <div className="pre-fixed-terminated-panel__actions">
                    {canAddExpenseCharge ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => setIsExpenseModalOpen(true)}
                      >
                        実費追加
                      </button>
                    ) : null}
                    <button
                      className="r9-flow-primary pre-fixed-terminated-panel__settle"
                      type="button"
                      onClick={() => openFixedSettlementFlow({ force: true })}
                    >
                      精算へ進む
                    </button>
                  </div>
                </div>
              ) : meterMode === 'fixed' && isFixedInOperation ? (
                <div
                  className="pre-fixed-main-actions"
                  aria-label={reviewDemoMode ? '事前確定運賃 メイン操作' : '事前確定M メイン操作'}
                >
                  <div className="r9-timer-display">
                    <span>運行時間</span>
                    <strong>{drivingClockLabel}</strong>
                  </div>
                  <div className="pre-fixed-main-action-grid">
                    <button
                      className={`pre-fixed-main-action ${status === '待機中' ? 'pre-fixed-main-action--active' : ''}`}
                      type="button"
                      disabled={status === '待機中' ? !canEndWaiting : !canStartWaiting}
                      onClick={() => handleStatusChange(status === '待機中' ? '走行中' : '待機中')}
                    >
                      <strong>{waitingToggleLabel}</strong>
                      <small>{waitingClockLabel}</small>
                    </button>
                    <button
                      className={`pre-fixed-main-action pre-fixed-main-action--escort ${status === '院内付き添い中' ? 'pre-fixed-main-action--active' : ''}`}
                      type="button"
                      disabled={status === '院内付き添い中' ? !canEndAccompanying : !canStartAccompanying}
                      onClick={() => handleStatusChange(status === '院内付き添い中' ? '走行中' : '院内付き添い中')}
                    >
                      <strong>{accompanyingToggleLabel}</strong>
                      <small>{accompanyingClockLabel}</small>
                    </button>
                    <button
                      className="pre-fixed-main-action pre-fixed-main-action--arrive"
                      type="button"
                      disabled={!canArriveFixedSegment}
                      onClick={handleFixedSegmentArrive}
                    >
                      <strong>到着</strong>
                      <small>現在区間</small>
                    </button>
                    <button
                      className="pre-fixed-main-action pre-fixed-main-action--end"
                      type="button"
                      disabled={caseSaveState === 'saving' || !canEndFixedTrip}
                      onClick={() => { handleFixedTripEnd() }}
                    >
                      <strong>運行終了</strong>
                      <small>精算・領収書発行へ</small>
                    </button>
                  </div>
                  {canUndoRecentActivity && activeActivity ? (
                    <button className="r9-time-action r9-time-action--undo" type="button" onClick={() => { void undoRecentActivity() }}>
                      <span>直前操作取消</span>
                      <small>{getActivityLabel(activeActivity.type)}開始から30秒以内</small>
                    </button>
                  ) : null}
                </div>
              ) : meterMode === 'fixed' ? null : (
              <div className="r9-timer-action-grid" aria-label="時間操作">
                <div className="r9-timer-display">
                  <span>運行時間</span>
                  <strong>{drivingClockLabel}</strong>
                </div>
                <button
                  className={`r9-time-action ${status === '待機中' && billableTimeStarted.waiting ? 'r9-time-action--active' : ''}`}
                  type="button"
                  aria-pressed={status === '待機中' && billableTimeStarted.waiting}
                  disabled={status === '待機中' ? !canEndWaiting : !canStartWaiting}
                  onClick={() => handleStatusChange(status === '待機中' ? '走行中' : '待機中')}
                >
                  <span>{waitingToggleLabel}</span>
                  <small>（待機時間 {waitingClockLabel}）</small>
                </button>
                <button
                  className={`r9-time-action r9-time-action--escort ${status === '院内付き添い中' ? 'r9-time-action--active' : ''}`}
                  type="button"
                  aria-pressed={status === '院内付き添い中'}
                  disabled={status === '院内付き添い中' ? !canEndAccompanying : !canStartAccompanying}
                  onClick={() => handleStatusChange(status === '院内付き添い中' ? '走行中' : '院内付き添い中')}
                >
                  <span>{accompanyingToggleLabel}</span>
                  <small>（付き添い時間 {accompanyingClockLabel}）</small>
                </button>
                {canUndoRecentActivity && activeActivity ? (
                  <button className="r9-time-action r9-time-action--undo" type="button" onClick={() => { void undoRecentActivity() }}>
                    <span>直前操作取消</span>
                    <small>{getActivityLabel(activeActivity.type)}開始から30秒以内</small>
                  </button>
                ) : null}
              </div>
              )}
            </section>

          </section>

          <section className="r9-center-panel" aria-label="料金内訳">
            <MeterFareBreakdownPanel
              breakdown={settlementBreakdown}
              title={
                meterMode === 'fixed'
                  ? reviewDemoMode
                    ? '料金内訳（事前確定運賃）'
                    : '料金内訳（事前確定M）'
                  : '料金内訳'
              }
              totalLabel={meterMode === 'fixed' ? '合計請求額' : '合計金額'}
              footerNote={
                meterMode === 'fixed'
                  ? reviewDemoMode
                    ? REVIEW_DEMO_FARE_COMPOSITION_NOTE
                    : '※本運賃は事前確定済のため、メーターは加算されません。'
                  : undefined
              }
              headerEnd={(
                <ObdConnectFab
                  isConnecting={isObdConnectInProgress}
                  visible={showObdConnectFab}
                  onConnect={handleObdConnectFabClick}
                />
              )}
              hideTotal={meterMode !== 'fixed'}
            />
          </section>

          <section className="r9-right-panel" aria-label="状態操作">
            {tripStartNotice ? (
              <p className="r9-trip-start-notice" role="alert">
                {tripStartNotice}
              </p>
            ) : null}
            {meterMode === 'fixed' ? (
              <div className="r9-status-stack pre-fixed-status-stack">
                {!isTripStarted && !isFixedClosed ? (
                  <button
                    className="r9-status-button r9-status-button--driving"
                    type="button"
                    disabled={!canStartTrip}
                    onClick={() => { void handleDrivingStart() }}
                  >
                    <span aria-hidden="true">🚘</span>
                    <strong>固定運賃で運行開始</strong>
                  </button>
                ) : null}
                <button
                  className="r9-status-button r9-status-button--route-view"
                  type="button"
                  onClick={() => setIsConfirmedRouteDialogOpen(true)}
                >
                  <span aria-hidden="true">🗺</span>
                  <strong>確定ルートを見る</strong>
                </button>
                {!reviewDemoMode && !isFixedPassengerChangePreSettlement && !isFixedClosed ? (
                  <button
                    className="r9-status-button r9-status-button--nav"
                    type="button"
                    disabled={preFixedOverallStops.length < 2}
                    onClick={handleOpenFixedNavigation}
                  >
                    <span aria-hidden="true">➤</span>
                    <strong>ナビ開始</strong>
                  </button>
                ) : null}
                {!isFixedPassengerChangePreSettlement && !isFixedClosed ? (
                  <button
                    className="r9-status-button r9-status-button--route-change"
                    type="button"
                    disabled={isFixedRouteChangeBlocked}
                    onClick={handleFixedRouteChangeClick}
                  >
                    <span aria-hidden="true">↻</span>
                    <strong>ルート変更</strong>
                  </button>
                ) : null}
                {canOpenFixedSettlement || isFixedPassengerChangePreSettlement ? (
                  <button
                    className="r9-status-button r9-status-button--settlement"
                    type="button"
                    onClick={() => openFixedSettlementFlow({ force: true })}
                  >
                    <span aria-hidden="true">▣</span>
                    <strong>精算へ進む</strong>
                  </button>
                ) : !isFixedClosed ? (
                  <button
                    className="r9-status-button r9-status-button--settlement"
                    type="button"
                    disabled={caseSaveState === 'saving' || !canEndFixedTrip}
                    onClick={() => { handleFixedTripEnd() }}
                  >
                    <span aria-hidden="true">▣</span>
                    <strong>運行終了</strong>
                    <small>精算・領収書発行へ</small>
                  </button>
                ) : null}
                {!isFixedClosed ? (
                  <div className="pre-fixed-secondary-actions" aria-label="付帯操作">
                    {!isFixedPassengerChangePreSettlement ? (
                      <button
                        type="button"
                        disabled={!canAddAssistCharge}
                        onClick={() => setIsCareModalOpen(true)}
                      >
                        <span aria-hidden="true">♿</span>
                        介助
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={!canAddExpenseCharge}
                      onClick={() => setIsExpenseModalOpen(true)}
                    >
                      <span aria-hidden="true">￥</span>
                      実費
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
            <div className="r9-status-stack">
              {!isTripStarted ? (
                <button
                  className="r9-status-button r9-status-button--driving"
                  type="button"
                  disabled={!canStartTrip}
                  onClick={() => { void handleDrivingStart() }}
                >
                  <span aria-hidden="true">🚘</span>
                  <strong>送迎開始</strong>
                </button>
              ) : null}
              <button
                className="r9-status-button r9-status-button--assist"
                type="button"
                disabled={!canAddAssistCharge}
                onClick={() => setIsCareModalOpen(true)}
              >
                <span aria-hidden="true">♿</span>
                <strong>介助</strong>
              </button>
              <button
                className="r9-status-button r9-status-button--pickup"
                type="button"
                disabled={!canOpenDispatchModal}
                onClick={() => setIsDispatchModalOpen(true)}
              >
                <span aria-hidden="true">▦</span>
                <strong>予約迎車</strong>
              </button>
              <button
                className="r9-status-button r9-status-button--expense"
                type="button"
                disabled={!canAddExpenseCharge}
                onClick={() => setIsExpenseModalOpen(true)}
              >
                <span aria-hidden="true">￥</span>
                <strong>実費</strong>
              </button>
              <button
                className="r9-status-button r9-status-button--settlement r9-status-button--hold"
                type="button"
                aria-describedby="settlement-hold-help"
                disabled={caseSaveState === 'saving' || !canOpenSettlement}
                onPointerDown={beginSettlementHold}
                onPointerUp={cancelSettlementHold}
                onPointerLeave={cancelSettlementHold}
                onPointerCancel={cancelSettlementHold}
                onContextMenu={(event) => event.preventDefault()}
              >
                <span aria-hidden="true">▣</span>
                <strong>精算・終了</strong>
                <small id="settlement-hold-help">長押し</small>
              </button>
            </div>
            )}

            {routeChangeNotice && meterMode === 'fixed' ? (
              <p className="r9-trip-start-notice" role="status">
                {routeChangeNotice}
              </p>
            ) : null}

            {isDevelopmentMode && !reviewDemoMode ? (
              <div className="r9-side-tools">
                <button type="button" onClick={() => setIsSettingsOpen(true)}>
                  開発用設定
                </button>
                <details
                  className="r9-gps-debug"
                  open={isGpsPanelOpen}
                  onToggle={(event) => setIsGpsPanelOpen(event.currentTarget.open)}
                >
                  <summary>GPS診断</summary>
                  <GpsPanel
                    errorMessage={gps.gpsRaw.errorMessage}
                    gpsLogCount={gps.gpsRaw.gpsLogCount}
                    isActive={gps.gpsRaw.isActive}
                    position={gps.gpsRaw.position}
                    status={gps.gpsRaw.status}
                    speedSource={gps.gpsRaw.speedSource}
                    totalDistanceKm={gps.gpsRaw.chargeableDistanceKm}
                  />
                </details>

                <details className="r9-address-debug-panel">
                  <summary>住所取得診断</summary>
                  <dl>
                    <div>
                      <dt>原因判定</dt>
                      <dd>{reverseGeocodeCauseLabel}</dd>
                    </div>
                    <div>
                      <dt>伺い先</dt>
                      <dd>{pickupLocation.address || '住所未取得'}</dd>
                    </div>
                    <div>
                      <dt>送り先</dt>
                      <dd>{dropoffLocation.address || '住所未取得'}</dd>
                    </div>
                    <div>
                      <dt>Google Maps APIロード状態</dt>
                      <dd>{reverseGeocodeDiagnostic.googleMapsApiLoadState}</dd>
                    </div>
                    <div>
                      <dt>Geocoder生成状態</dt>
                      <dd>{reverseGeocodeDiagnostic.geocoderState}</dd>
                    </div>
                    <div>
                      <dt>Geocoding実行状態</dt>
                      <dd>{reverseGeocodeDiagnostic.geocodingExecutionState}</dd>
                    </div>
                    <div>
                      <dt>reverseGeocodeWithGoogle</dt>
                      <dd>{reverseGeocodeDiagnostic.reverseGeocodeCalled ? '呼び出し済み' : '未実行'}</dd>
                    </div>
                    <div>
                      <dt>geocode()</dt>
                      <dd>{reverseGeocodeDiagnostic.geocodeCalled ? '呼び出し済み' : '未実行'}</dd>
                    </div>
                    <div>
                      <dt>geocode() 応答</dt>
                      <dd>{reverseGeocodeDiagnostic.geocodeCallbackState}</dd>
                    </div>
                    <div>
                      <dt>取得緯度</dt>
                      <dd>{reverseGeocodeDiagnostic.latitude ?? '未取得'}</dd>
                    </div>
                    <div>
                      <dt>取得経度</dt>
                      <dd>{reverseGeocodeDiagnostic.longitude ?? '未取得'}</dd>
                    </div>
                    <div>
                      <dt>Googleレスポンス件数</dt>
                      <dd>{reverseGeocodeDiagnostic.responseCount ?? '未取得'}</dd>
                    </div>
                    <div>
                      <dt>Googleレスポンス内容</dt>
                      <dd>{reverseGeocodeDiagnostic.googleResponseJson || '未取得'}</dd>
                    </div>
                    <div>
                      <dt>formatted_address</dt>
                      <dd>{reverseGeocodeDiagnostic.formattedAddress || '未取得'}</dd>
                    </div>
                    <div>
                      <dt>取得住所</dt>
                      <dd>{reverseGeocodeDiagnostic.address || '未取得'}</dd>
                    </div>
                    <div>
                      <dt>エラーメッセージ</dt>
                      <dd>{reverseGeocodeDiagnostic.errorMessage || 'なし'}</dd>
                    </div>
                    <div>
                      <dt>空文字発生箇所</dt>
                      <dd>{reverseGeocodeDiagnostic.emptyAddressReason || 'なし'}</dd>
                    </div>
                    <div>
                      <dt>最終更新</dt>
                      <dd>{reverseGeocodeDiagnostic.lastUpdatedAt || '未更新'}</dd>
                    </div>
                  </dl>
                </details>
              </div>
            ) : null}
          </section>

          {meterMode === 'fixed' ? (
            <section
              className="reservation-detail-section reservation-trip-context-panel pre-fixed-reservation-bar"
              aria-label="予約連携情報"
            >
              <dl className="reservation-detail-dl pre-fixed-reservation-bar__meta">
                <div>
                  <dt>予約ID</dt>
                  <dd>
                    {fixedFareRun?.reservationId ??
                      reservationTripContext?.reservationId ??
                      '—'}
                  </dd>
                </div>
                <div>
                  <dt>同意日時</dt>
                  <dd>
                    {reservationTripContext?.consentAt
                      ? formatCaseDateTime(reservationTripContext.consentAt)
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="pre-fixed-reservation-bar__route">
                <div>
                  <span>迎車</span>
                  <strong>
                    {reservationTripContext?.pickupAddress ||
                      pickupLocation.address ||
                      '—'}
                  </strong>
                </div>
                <div>
                  <span>降車</span>
                  <strong>
                    {reservationTripContext?.dropoffAddress ||
                      dropoffLocation.address ||
                      '—'}
                  </strong>
                </div>
              </div>
            </section>
          ) : null}

          {meterMode !== 'fixed' ? (
          <section className="route-address-panel" aria-labelledby="route-address-title">
            <h2 className="sr-only" id="route-address-title">運行住所</h2>
            <div className="route-address-grid">
              <div>
                <span className="route-address-icon" aria-hidden="true">●</span>
                <div className="route-address-content">
                  <div className="route-address-heading">
                    <span>運行開始住所 送迎開始時にGPSから取得します</span>
                  </div>
                  <strong>{pickupLocation.address || '・・・・・・・・・・・・・・・・'}</strong>
                </div>
              </div>
              <div>
                <span className="route-address-icon route-address-icon--flag" aria-hidden="true">⚑</span>
                <div className="route-address-content">
                  <div className="route-address-heading">
                    <span>到着住所 精算終了時にGPSから取得します</span>
                  </div>
                  <strong>{dropoffLocation.address || '・・・・・・・・・・・・・・・・'}</strong>
                </div>
              </div>
            </div>
          </section>
          ) : null}
        </div>
      </div>

      {isSettingsOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="settings-title"
            aria-modal="true"
            className="settings-modal"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>一時設定</span>
                <h2 id="settings-title">現在の料金設定</h2>
              </div>
              <button type="button" onClick={() => setIsSettingsOpen(false)}>
                閉じる
              </button>
            </header>

            <p className="settings-message">{settingsMessage}</p>

            <div className="settings-grid">
              <fieldset>
                <legend>運賃</legend>
                <label>
                  初乗距離(km)
                  <input
                    min="0"
                    step="0.001"
                    type="number"
                    value={currentBasicFareSettings.initialDistanceKm}
                    onChange={(event) =>
                      updateBasicFareSetting('initialDistanceKm', event.target.value)
                    }
                  />
                </label>
                <label>
                  初乗料金(円)
                  <input
                    min="0"
                    type="number"
                    value={currentBasicFareSettings.initialFareYen}
                    onChange={(event) =>
                      updateBasicFareSetting('initialFareYen', event.target.value)
                    }
                  />
                </label>
                <label>
                  加算距離(km)
                  <input
                    min="0"
                    step="0.001"
                    type="number"
                    value={currentBasicFareSettings.additionalDistanceKm}
                    onChange={(event) =>
                      updateBasicFareSetting(
                        'additionalDistanceKm',
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  加算料金(円)
                  <input
                    min="0"
                    type="number"
                    value={currentBasicFareSettings.additionalFareYen}
                    onChange={(event) =>
                      updateBasicFareSetting('additionalFareYen', event.target.value)
                    }
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>待機・付き添い</legend>
                <label>
                  待機単位
                  <input readOnly value="30分" />
                </label>
                <label>
                  30分単位料金(円)
                  <input
                    min="0"
                    type="number"
                    value={currentWaitingFareSettings.unitFareYen}
                    onChange={(event) =>
                      updateTimeFareSetting(
                        setCurrentWaitingFareSettings,
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  付き添い単位
                  <input readOnly value="30分" />
                </label>
                <label>
                  30分単位料金(円)
                  <input
                    min="0"
                    type="number"
                    value={currentEscortFareSettings.unitFareYen}
                    onChange={(event) =>
                      updateTimeFareSetting(
                        setCurrentEscortFareSettings,
                        event.target.value,
                      )
                    }
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>介助料金</legend>
                {currentCareOptionMaster
                  .filter((item) => item.enabled)
                  .sort(
                    (firstItem, secondItem) =>
                      firstItem.sortOrder - secondItem.sortOrder,
                  )
                  .map((item) => (
                  <label key={item.id}>
                    {item.name}
                    <input
                      min="0"
                      type="number"
                      value={item.amount}
                      onChange={(event) =>
                        updateCareOptionAmount(item.id, event.target.value)
                      }
                    />
                  </label>
                ))}
              </fieldset>

              <fieldset>
                <legend>実費ボタン</legend>
                {currentExpensePresets.map((preset, index) => (
                  <div className="settings-pair" key={preset.id}>
                    <label>
                      実費{index + 1} 名称
                      <input
                        value={preset.name}
                        onChange={(event) =>
                          updateExpensePreset(preset.id, 'name', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      金額(円)
                      <input
                        min="0"
                        type="number"
                        value={preset.defaultAmountYen}
                        onChange={(event) =>
                          updateExpensePreset(
                            preset.id,
                            'defaultAmountYen',
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </fieldset>
            </div>
          </section>
        </div>
      ) : null}

      {isCareModalOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="care-modal-title"
            aria-modal="true"
            className="settings-modal r9-operation-modal"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>ASSIST</span>
                <h2 id="care-modal-title">
                  {meterMode === 'fixed' ? '介助オプション編集' : '介助'}
                </h2>
              </div>
              <button type="button" onClick={() => setIsCareModalOpen(false)}>
                閉じる
              </button>
            </header>

            <div className="r9-current-status">
              <span>現在状態</span>
              <strong>{status}</strong>
            </div>

            <div className="r9-operation-sections">
              <section className="r9-operation-section" aria-labelledby="care-items-title">
                <div className="r9-operation-section__header">
                  <h3 id="care-items-title">
                    {meterMode === 'fixed' ? '追加介助料' : '介助項目'}
                  </h3>
                  <strong>
                    {formatFareYen(
                      meterMode === 'fixed'
                        ? (settlementBreakdown.additionalCareFareYen ?? 0)
                        : fareBreakdown.careOptionFareYen,
                    )}円
                  </strong>
                </div>
                {meterMode === 'fixed' ? (
                  <p className="empty-note">
                    元の事前確定運賃に含まれる介助料は変更しません。追加介助が発生した場合のみ加算してください。初期値は0円です。
                  </p>
                ) : null}
                <div className="r9-modal-button-grid r9-modal-button-grid--care">
                  {meterMode === 'fixed'
                    ? PRE_FIXED_ADDITIONAL_CARE_PRESETS.map((preset) => {
                        const masterMatch = enabledCareOptions.find(
                          (item) => item.name === preset.name || item.id === preset.id,
                        )
                        const defaultAmountYen = masterMatch?.amount ?? 0

                        return (
                          <button
                            className="r9-modal-choice"
                            key={preset.id}
                            type="button"
                            disabled={!canAddAssistCharge}
                            onClick={() =>
                              setKeypadTarget({
                                amountYen: defaultAmountYen,
                                mode: 'care',
                                name: preset.name,
                                sourceId: masterMatch?.id ?? preset.id,
                              })
                            }
                          >
                            <span>{preset.name}</span>
                            <strong>
                              {defaultAmountYen > 0
                                ? `${formatFareYen(defaultAmountYen)}円`
                                : '金額入力'}
                            </strong>
                          </button>
                        )
                      })
                    : enabledCareOptions.map((item) => {
                        const isSelected = selectedCareOptionIds.has(item.id)

                        return (
                          <button
                            className={`r9-modal-choice ${isSelected ? 'r9-modal-choice--selected' : ''}`}
                            key={item.id}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={!canAddAssistCharge}
                            onClick={() => toggleCareOption(item)}
                          >
                            <span>{isSelected ? '✓ ' : ''}{item.name}</span>
                            <strong>{formatFareYen(item.amount)}円</strong>
                          </button>
                        )
                      })}
                  <button
                    className="r9-modal-choice"
                    type="button"
                    disabled={!canAddAssistCharge}
                    onClick={() =>
                      setKeypadTarget({
                        amountYen: 0,
                        mode: meterMode === 'fixed' ? 'care' : 'customFee',
                        name: meterMode === 'fixed' ? 'その他' : '',
                        sourceId: meterMode === 'fixed' ? 'additional-care-other' : undefined,
                      })
                    }
                  >
                    <span>その他</span>
                    <strong>自由入力</strong>
                  </button>
                </div>
                <div className="r9-summary-card r9-summary-card--modal">
                  {selectedCareOptions.length === 0 && customFees.length === 0 ? (
                    <p className="empty-note">
                      {meterMode === 'fixed' ? '追加介助料は0円です。' : '介助料金は未追加です。'}
                    </p>
                  ) : (
                    <div className="r9-summary-list">
                      {selectedCareOptions.map((option) => (
                        <p key={option.id}>
                          <span>{option.name}</span>
                          <strong>{formatFareYen(option.amountYen)}円</strong>
                          <button type="button" disabled={!canAddAssistCharge} onClick={() => removeCareOption(option.id)}>
                            削除
                          </button>
                        </p>
                      ))}
                      {customFees.map((fee) => (
                        <p key={fee.id}>
                          <span>{fee.name}</span>
                          <strong>{formatFareYen(fee.amount)}円</strong>
                          <button type="button" disabled={!canAddAssistCharge} onClick={() => removeCustomFee(fee.id)}>
                            削除
                          </button>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </section>

            </div>
          </section>
        </div>
      ) : null}

      {isDispatchModalOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="dispatch-modal-title"
            aria-modal="true"
            className="settings-modal r9-operation-modal"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>PICKUP</span>
                <h2 id="dispatch-modal-title">予約迎車</h2>
              </div>
              <button type="button" onClick={() => setIsDispatchModalOpen(false)}>
                閉じる
              </button>
            </header>

            <div className="r9-operation-sections">
              <section className="r9-operation-section" aria-labelledby="dispatch-items-title">
                <div className="r9-operation-section__header">
                  <h3 id="dispatch-items-title">予約・迎車メニュー</h3>
                  <span>ボタン押下で予約・迎車料金へ加算します</span>
                </div>
                <div className="r9-modal-button-grid r9-modal-button-grid--dispatch">
                  {enabledDispatchMenuItems.length === 0 ? (
                    <p className="empty-note">有効な予約迎車メニューはありません。</p>
                  ) : null}
                  {enabledDispatchMenuItems.map((dispatchItem) => {
                    const isSelected = selectedDispatchChargeIds.has(dispatchItem.id)

                    return (
                      <button
                        className={`r9-modal-choice ${isSelected ? 'r9-modal-choice--selected' : ''}`}
                        key={dispatchItem.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={!canAddDispatchCharge}
                        onClick={() => toggleDispatchCharge(dispatchItem)}
                      >
                        <span>{isSelected ? '✓ ' : ''}{dispatchItem.name}</span>
                        <strong>{formatFareYen(dispatchItem.amount)}円</strong>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="r9-operation-section" aria-labelledby="special-vehicle-items-title">
                <div className="r9-operation-section__header">
                  <h3 id="special-vehicle-items-title">特殊車両料金</h3>
                  <span>1BOXリフト車両などを特殊車両料金へ加算します</span>
                </div>
                <div className="r9-modal-button-grid r9-modal-button-grid--special-vehicle">
                  {enabledSpecialVehicleMenuItems.length === 0 ? (
                    <p className="empty-note">有効な特殊車両メニューはありません。</p>
                  ) : null}
                  {enabledSpecialVehicleMenuItems.map((specialItem) => {
                    const isSelected = selectedSpecialVehicleChargeIds.has(specialItem.id)

                    return (
                      <button
                        className={`r9-modal-choice ${isSelected ? 'r9-modal-choice--selected' : ''}`}
                        key={specialItem.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={!canAddSpecialVehicleCharge}
                        onClick={() => toggleSpecialVehicleCharge(specialItem)}
                      >
                        <span>{isSelected ? '✓ ' : ''}{specialItem.name}</span>
                        <strong>{formatFareYen(specialItem.amount)}円</strong>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isExpenseModalOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="expense-modal-title"
            aria-modal="true"
            className="settings-modal r9-operation-modal"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>COST</span>
                <h2 id="expense-modal-title">{meterMode === 'fixed' ? '実費追加' : '実費'}</h2>
              </div>
              <button type="button" onClick={() => setIsExpenseModalOpen(false)}>
                閉じる
              </button>
            </header>

            <div className="r9-operation-section">
              <div className="r9-operation-section__header">
                <h3>{meterMode === 'fixed' ? '実費' : '実費ワンタッチ'}</h3>
                <strong>{formatFareYen(expenseTotalYen)}円</strong>
              </div>
              {meterMode === 'fixed' ? (
                <p className="empty-note">
                  駐車場代・有料道路代・立替金などを複数件追加できます。初期値は0円です。
                </p>
              ) : null}
              <div className="r9-modal-button-grid r9-modal-button-grid--expense">
                {(meterMode === 'fixed'
                  ? PRE_FIXED_EXPENSE_QUICK_PRESETS.map((preset) => {
                      const settingsPreset = currentExpensePresets.find(
                        (item) =>
                          item.name === preset.name ||
                          item.name.includes(preset.name.replace(/代$/, '')) ||
                          item.id === preset.id,
                      )
                      return {
                        id: preset.id,
                        name: preset.name,
                        defaultAmountYen: settingsPreset?.defaultAmountYen ?? 0,
                      }
                    })
                  : currentExpensePresets
                      .filter((preset) => preset.name.trim())
                      .map((preset) => ({
                        id: preset.id,
                        name: preset.name,
                        defaultAmountYen: preset.defaultAmountYen,
                      }))
                ).map((preset) => (
                  <button
                    className="r9-modal-choice r9-modal-choice--expense"
                    key={preset.id}
                    type="button"
                    disabled={!canAddExpenseCharge}
                    onClick={() =>
                      setKeypadTarget({
                        amountYen: preset.defaultAmountYen,
                        mode: 'expense',
                        name: preset.name,
                      })
                    }
                  >
                    <span>{preset.name}</span>
                    <strong>
                      {preset.defaultAmountYen > 0
                        ? `${formatFareYen(preset.defaultAmountYen)}円`
                        : '金額入力'}
                    </strong>
                  </button>
                ))}
                {meterMode === 'fixed' ? (
                  <button
                    className="r9-modal-choice r9-modal-choice--expense"
                    type="button"
                    disabled={!canAddExpenseCharge}
                    onClick={() =>
                      setKeypadTarget({
                        amountYen: 0,
                        mode: 'expense',
                        name: '',
                      })
                    }
                  >
                    <span>項目を追加</span>
                    <strong>名称・金額入力</strong>
                  </button>
                ) : null}
              </div>
              <div className="r9-summary-card r9-summary-card--modal">
                {expenses.length === 0 ? (
                  <p className="empty-note">実費は0円です。</p>
                ) : (
                  <div className="r9-summary-list">
                    {expenses.map((expense) => (
                      <p key={expense.id}>
                        <span>{expense.name}</span>
                        <strong>{formatFareYen(expense.amountYen)}円</strong>
                        <button type="button" disabled={!canAddExpenseCharge} onClick={() => removeExpense(expense.id)}>
                          削除
                        </button>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isSettlementConfirmOpen && meterMode !== 'fixed' ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="settlement-confirm-title"
            aria-modal="true"
            className="settings-modal r9-settlement-confirm"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>CONFIRM</span>
                <h2 id="settlement-confirm-title">精算・終了の確認</h2>
              </div>
              <button type="button" onClick={() => setIsSettlementConfirmOpen(false)}>
                戻る
              </button>
            </header>
            <p className="lead">
              送迎を終了して精算画面へ進みます。GPS計測とメーターは精算処理へ切り替わり、以後は保存・発行完了まで他の運行操作はできません。
            </p>
            <div className="r9-confirm-actions">
              <button className="r9-flow-primary" type="button" onClick={confirmSettlementFlowStart}>
                精算へ進む
              </button>
              <button className="secondary-action" type="button" onClick={() => setIsSettlementConfirmOpen(false)}>
                キャンセル
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isSettlementFlowOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="settlement-flow-title"
            aria-modal="true"
            className="settings-modal r9-operation-modal r9-settlement-flow"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>SETTLEMENT</span>
                <h2 id="settlement-flow-title">精算・終了</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSettlementFlowOpen(false)}
              >
                閉じる
              </button>
            </header>

            <div className="r9-current-status">
              <span>現在状態</span>
              <strong>{status}</strong>
            </div>

            {!savedCaseRecord ? (
              <div className="r9-confirm-actions">
                {status === '精算前' ? (
                  <>
                    {meterMode === 'fixed' ? (
                      <>
                        {canAddAssistCharge ? (
                          <button className="secondary-action" type="button" onClick={() => setIsCareModalOpen(true)}>
                            介助追加
                          </button>
                        ) : null}
                        {canAddExpenseCharge ? (
                          <button className="secondary-action" type="button" onClick={() => setIsExpenseModalOpen(true)}>
                            実費追加
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <button className="secondary-action" type="button" onClick={openSettlementEdit}>
                      精算修正
                    </button>
                    {!hasPassengerChangeTermination ? (
                    <button
                      className="case-detail-danger-button"
                      type="button"
                      onPointerDown={beginResumeHold}
                      onPointerUp={cancelResumeHold}
                      onPointerLeave={cancelResumeHold}
                      onPointerCancel={cancelResumeHold}
                    >
                      運行再開（1秒長押し）
                    </button>
                    ) : null}
                  </>
                ) : null}
                {status === '精算修正' ? (
                  <>
                    <button className="secondary-action" type="button" onClick={() => setIsCareModalOpen(true)}>
                      介助修正
                    </button>
                    <button className="secondary-action" type="button" onClick={() => setIsExpenseModalOpen(true)}>
                      実費修正
                    </button>
                    <button className="r9-flow-primary" type="button" onClick={() => { void completeSettlementEdit() }}>
                      修正完了
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="r9-settlement-steps" aria-label="精算・終了手順">
              <span className="r9-settlement-steps__done">支払方法選択</span>
              <span className={caseSaveState === 'saved' || savedCaseRecord ? 'r9-settlement-steps__done' : ''}>保存</span>
              <span className={settlementFlowStep === 'saved' ? 'r9-settlement-steps__done' : ''}>レシート・領収書発行（任意）</span>
              <span className={settlementFlowStep === 'saved' ? 'r9-settlement-steps__done' : ''}>発行完了</span>
            </div>

            {isPostSettlementAwaitingNewCase ? (
              isPassengerChangeSavedCase ? (
                <PassengerChangePostSettlementBanner
                  compact
                  onStartRegularMeterTrip={handleStartRegularMeterTrip}
                />
              ) : (
                <PostSettlementBanner
                  caseNumber={postSettlementCaseNumber}
                  compact
                  onStartNewCase={handleStartNewCase}
                />
              )
            ) : null}

            {!savedCaseRecord ? (
              <>
                <div className="r9-address-capture r9-address-capture--modal" aria-label="住所取得状態">
                  <p>
                    <span>伺い先</span>
                    <strong>{pickupLocation.address || '住所未取得'}</strong>
                  </p>
                  <p>
                    <span>送り先</span>
                    <strong>{dropoffLocation.address || '住所取得中または未取得'}</strong>
                  </p>
                </div>
                <SettlementPanel
                  breakdown={settlementBreakdown}
                  businessDistanceKm={gps.businessDistanceKm}
                  chargeableDistanceKm={gps.chargeableDistanceKm}
                  hideDistanceBreakdown={meterMode === 'fixed'}
                  isDisabilityDiscount={isDisabilityDiscount}
                  settlementDiscount={settlementDiscount}
                  paymentAmounts={paymentAmounts}
                  paymentMethod={paymentMethod}
                  receiptName={receiptName}
                  saveMessage={caseSaveMessage}
                  saveState={caseSaveState}
                  taxiTickets={taxiTickets}
                  onAddTaxiTicket={addTaxiTicket}
                  onDisabilityDiscountChange={setIsDisabilityDiscount}
                  onSettlementDiscountChange={setSettlementDiscount}
                  onPaymentAmountChange={updatePaymentAmount}
                  onPaymentMethodChange={setPaymentMethod}
                  onReceiptNameChange={setReceiptName}
                  onRemoveTaxiTicket={removeTaxiTicket}
                  onSettlePaymentRemainder={settlePaymentRemainder}
                />
                {status === '精算修正' ? (
                  <section className="case-edit-panel" aria-labelledby="activity-history-edit-title">
                    <h3 id="activity-history-edit-title">時間履歴修正</h3>
                    <p className="empty-note">待機・付き添いの誤操作履歴を削除または時刻修正できます。距離・実走行距離・時間距離併用運賃は変更しません。</p>
                    {(['waiting', 'accompanying'] as ActivityHistoryType[]).map((activityType) => {
                      const histories = activityHistories.filter((history) => history.type === activityType)

                      return (
                        <div className="case-change-history-list" key={activityType}>
                          <h4>{getActivityLabel(activityType)}</h4>
                          {histories.length === 0 ? (
                            <p className="empty-note">{getActivityLabel(activityType)}履歴はありません。</p>
                          ) : null}
                          {histories.map((history) => {
                            const activityLabel = getActivityLabel(history.type)
                            const durationMinutes = calculateActivityHistoryMinutes(history)

                            return (
                              <article key={history.id}>
                                <strong>{activityLabel}（{durationMinutes}分）</strong>
                                <p>{formatActivityClock(history.startAt)} ～ {formatActivityClock(history.endAt)}</p>
                                <label>
                                  開始時刻を修正
                                  <input
                                    aria-label={`${activityLabel}（${durationMinutes}分）の開始時刻`}
                                    type="datetime-local"
                                    value={formatDateTimeLocalValue(history.startAt)}
                                    onChange={(event) => { void updateActivityHistory(history.id, 'startAt', event.target.value) }}
                                  />
                                </label>
                                <label>
                                  終了時刻を修正
                                  <input
                                    aria-label={`${activityLabel}（${durationMinutes}分）の終了時刻`}
                                    type="datetime-local"
                                    value={formatDateTimeLocalValue(history.endAt)}
                                    onChange={(event) => { void updateActivityHistory(history.id, 'endAt', event.target.value) }}
                                  />
                                </label>
                                <button type="button" onClick={() => { void deleteActivityHistory(history.id) }}>
                                  {activityLabel}（{durationMinutes}分）を削除
                                </button>
                              </article>
                            )
                          })}
                        </div>
                      )
                    })}
                  </section>
                ) : null}
                <button
                  className="r9-flow-primary"
                  type="button"
                  disabled={caseSaveState === 'saving' || status !== '精算前'}
                  onClick={() => {
                    void handleSettlementSave()
                  }}
                >
                  保存
                </button>
              </>
            ) : null}

            {savedCaseRecord ? (
              <div className="r9-issuance-panel">
                <p>レシートまたは領収書を発行できます（任意）。</p>
                {caseSaveMessage ? (
                  <p className="save-note save-note--error" role="status" style={{ whiteSpace: 'pre-wrap' }}>
                    {caseSaveMessage}
                  </p>
                ) : null}
                {printerConnectionDiagnostics.length > 0 ? (
                  <div className="printer-connection-diagnostics" aria-label="プリンター接続診断">
                    <p className="printer-connection-diagnostics__title">接続診断</p>
                    <ul className="printer-connection-diagnostics__list">
                      {printerConnectionDiagnostics.map((stage, index) => (
                        <li key={`${stage.stage}-${index}`}>
                          {formatPrinterConnectionStageLabel(stage)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="payment-complete-total">
                  <span>合計金額</span>
                  <strong>{formatFareYen(savedCaseRecord.totalFareYen)}円</strong>
                </div>
                <div className="receipt-dialog-actions">
                  {!reviewDemoMode ? (
                    <button
                      className="receipt-dialog-primary"
                      type="button"
                      onClick={() => {
                        void handleThermalReceiptPrint()
                      }}
                    >
                      領収書印刷
                    </button>
                  ) : null}
                  {canSaveReceiptPdf ? (
                    <button
                      className="receipt-dialog-secondary"
                      type="button"
                      onClick={() => {
                        void handleThermalReceiptPdfDownload()
                      }}
                    >
                      レシートPDF保存
                    </button>
                  ) : null}
                  <button
                    className="receipt-dialog-secondary"
                    type="button"
                    onClick={() => {
                      void handleA4ReceiptDownload()
                    }}
                  >
                    A4領収書(PDF)
                  </button>
                </div>
                {meterMode === 'fixed' && fixedCompleteState === 'error' && !reviewDemoMode ? (
                  <button
                    className="r9-flow-primary"
                    type="button"
                    disabled={isFixedCompleteLoading}
                    onClick={() => { void handleConfirmFixedTripComplete() }}
                  >
                    {isFixedCompleteLoading ? '完了API処理中…' : '完了APIを再試行'}
                  </button>
                ) : null}
                {meterMode === 'fixed' && fixedCompleteState === 'done' && savedCaseRecord.reservationId && !isPassengerChangeSavedCase ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      if (reviewDemoMode) {
                        navigate(
                          withReviewDemoSearch(
                            `/review-demo/reservations/${encodeURIComponent(savedCaseRecord.reservationId ?? REVIEW_DEMO_RESERVATION_ID)}`,
                          ),
                        )
                        return
                      }

                      navigate(`/reservations/${encodeURIComponent(savedCaseRecord.reservationId ?? '')}`)
                    }}
                  >
                    予約詳細へ戻る
                  </button>
                ) : null}
                {isPassengerChangeSavedCase && fixedCompleteState === 'done' ? (
                  <PassengerChangePostSettlementBanner
                    compact
                    onStartRegularMeterTrip={handleStartRegularMeterTrip}
                  />
                ) : null}
                {settlementFlowStep === 'saved' ? (
                  <p className="r9-issue-complete">
                    <strong>発行完了</strong>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}


      {keypadTarget ? (
        <KeypadModal
          amountYen={keypadTarget.amountYen}
          defaultName={keypadTarget.name}
          mode={keypadTarget.mode}
          title={keypadTarget.mode === 'customFee' ? 'その他' : keypadTarget.name}
          onClose={() => setKeypadTarget(null)}
          onConfirm={handleKeypadConfirm}
        />
      ) : null}

      <ObdConnectionRequiredDialog
        isOpen={isObdConnectionDialogOpen}
        variant={obdConnectionDialogVariant}
        onCancel={() => {
          setIsObdConnectionDialogOpen(false)
        }}
        onReconnect={() => {
          void handleObdReconnect()
        }}
        onSwitchToGps={
          obdConnectionDialogVariant === 'pre-trip' ? handleObdSwitchToGps : undefined
        }
        onSwitchToTime={
          obdConnectionDialogVariant === 'pre-trip' ? handleObdSwitchToTime : undefined
        }
      />

      <MeterBlackoutOverlay
        elapsedSeconds={meterBlackout.elapsedSeconds}
        isActive={meterBlackout.isBlackoutActive}
        statusLabel={meterBlackout.statusLabel}
        onDismiss={meterBlackout.dismissBlackout}
      />

      <WaitingMovementAlert
        isOpen={waitingMovementAlert.alertState.isOpen}
        onContinueWaiting={handleWaitingMovementContinue}
        onResumeTrip={handleWaitingMovementResumeTrip}
      />

      <PreFixedFarePassengerChangeDialog
        isOpen={isPassengerChangeDialogOpen}
        onCancel={() => setIsPassengerChangeDialogOpen(false)}
        onConfirm={() => { void handleConfirmPassengerChangeTermination() }}
      />

      <PreFixedFareConfirmedRouteDialog
        isOpen={isConfirmedRouteDialogOpen}
        routeView={confirmedRouteView}
        onClose={() => setIsConfirmedRouteDialogOpen(false)}
      />

      {isRouteChangePreStartDialogOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="pre-fixed-route-change-prestart-title"
            aria-modal="true"
            className="settings-modal r9-settlement-confirm"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>確認</span>
                <h2 id="pre-fixed-route-change-prestart-title">ルート変更は運行開始後に行います</h2>
              </div>
              <button type="button" onClick={() => setIsRouteChangePreStartDialogOpen(false)}>
                閉じる
              </button>
            </header>
            <p className="lead" style={{ whiteSpace: 'pre-wrap' }}>
              {reviewDemoMode
                ? `ルート変更は、運行開始後にお客様都合の立ち寄り追加・目的地変更・交通規制迂回などが発生したときに使用します。

先に「固定運賃で運行開始」を押してから、ルート変更を行ってください。

運行開始前は「確定ルートを見る」で走行予定ルートを確認できます。`
                : `ルート変更は、運行開始後にお客様都合の立ち寄り追加・目的地変更などが発生したときに使用します。

先に「固定運賃で運行開始」を押してから、ルート変更を行ってください。

運行開始前は「確定ルートを見る」「ナビ開始」をご利用ください。`}
            </p>
            <div className="r9-confirm-actions">
              <button
                className="r9-flow-primary"
                type="button"
                onClick={() => setIsRouteChangePreStartDialogOpen(false)}
              >
                了解
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {meterMode === 'fixed' ? (
        <PreFixedFareRouteChangeDialog
          isOpen={isRouteChangeDialogOpen}
          caseId={caseNumber}
          reservationId={
            fixedFareRun?.reservationId ??
            reservationTripContext?.reservationId ??
            ''
          }
          driverName={workSession.currentSession?.staffName ?? ''}
          confirmedFareYen={resolvedConfirmedFareYen}
          waitingFareYen={settlementBreakdown.waitingFareYen}
          escortFareYen={settlementBreakdown.escortFareYen}
          overallStops={preFixedOverallStops}
          fareSettings={currentBasicFareSettings}
          captureLocation={
            reviewDemoMode ? captureReviewDemoCurrentLocation : undefined
          }
          allowNavigation={!reviewDemoMode}
          onClose={() => setIsRouteChangeDialogOpen(false)}
          onEndHere={(log) => { void handleRouteChangeEndHere(log) }}
          onTrafficDetour={(log) => { void handleRouteChangeTrafficDetour(log) }}
          onPassengerRouteChangeConfirmed={(payload) => {
            void handlePassengerRouteChangeConfirmed(payload)
          }}
        />
      ) : null}

      <TopReturnFab onClick={handleReturnToTop} visible={canShowTopFab} />
    </main>
  )
}
