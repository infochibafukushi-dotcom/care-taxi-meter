import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Dispatch, SetStateAction } from 'react'
import { FareBreakdownPanel as MeterFareBreakdownPanel } from '../components/case/FareBreakdownPanel'
import { GpsPanel } from '../components/case/GpsPanel'
import { KeypadModal } from '../components/case/KeypadModal'
import { SettlementPanel } from '../components/case/SettlementPanel'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { isFirebaseConfigured } from '../lib/firebase'
import { useOperationTimers } from '../hooks/useOperationTimers'
import { useWorkSession } from '../hooks/useWorkSession'
import {
  basicFareSettings,
  calculateFareBreakdown,
  calculateFareIncreaseProgress,
  calculateTimeFareIncreaseProgress,
  careOptionMaster,
  escortFareSettings,
  formatFareYen,
  waitingFareSettings,
} from '../services/fare'
import { generateCaseNumber, saveCaseRecord } from '../services/caseRecords'
import { fetchVehicles } from '../services/vehicles'
import type { CaseNumberAssignment, FareSnapshot, StoredCaseRecord } from '../services/caseRecords'
import {
  defaultMeterSettings,
  fixedTimeFareUnitSeconds,
  subscribeMeterSettings,
} from '../services/meterSettings'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  DispatchMenuItem,
  SpecialVehicleMenuItem,
  TimeFareSettings,
} from '../services/fare'
import type { ExpensePreset, MeterSettings } from '../services/meterSettings'
import type { Vehicle } from '../types/work'
import { tenantScopeFromSession } from '../services/tenancy'
import { downloadReceiptPdf } from '../utils/receiptPdf'
import { openThermalReceiptPdf } from '../utils/thermalReceiptPdf'
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
  ExpenseItem,
  OperationStatus,
  PaymentAllocation,
  PaymentMethod,
  GpsPosition,
  SelectedCareOption,
  TaxiTicket,
  StatusTone,
  TimerKey,
} from '../types/case'

const extractAreaFromAddress = (address: string) => {
  const match = address.match(/(?:千葉市|船橋市|市川市|佐倉市|四街道市|習志野市|八千代市|浦安市|成田市|柏市|松戸市|市原市)(?:[^\s、,]*区)?|[^\s、,]+区/)
  return match?.[0] ?? ''
}

type KeypadTarget = {
  amountYen: number
  mode: 'care' | 'expense'
  name: string
  sourceId?: string
}

type InputHistory = {
  amountYen: number
  id: string
  mode: 'care' | 'expense'
  name: string
}


type CaseSaveState = 'error' | 'idle' | 'saved' | 'saving'
type SettlementFlowStep = 'receipt' | 'saved'

const inputHistoryStorageKey = 'careTaxiMeterInputHistory'

const statusToneMap: Record<OperationStatus, StatusTone> = {
  空車: 'vacant',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
  走行中: 'driving',
  精算前: 'settlement',
  案件終了: 'closed',
}

const activeTimerMap: Partial<Record<OperationStatus, TimerKey>> = {
  走行中: 'driving',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
}

const isDevelopmentMode = import.meta.env.DEV
const paymentMethods: PaymentMethod[] = ['現金', 'クレジット', 'QR決済', '請求書', 'その他']
const createEmptyPaymentAmounts = (): Record<PaymentMethod, number> => ({
  QR決済: 0,
  その他: 0,
  クレジット: 0,
  現金: 0,
  請求書: 0,
})

const loadInputHistory = () => {
  try {
    const historyJson = localStorage.getItem(inputHistoryStorageKey)
    return historyJson ? (JSON.parse(historyJson) as InputHistory[]) : []
  } catch {
    return []
  }
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`

const toPositiveNumber = (value: string, minimum = 0) =>
  Math.max(Number(value) || minimum, minimum)

const formatClockSegment = (value: number) => value.toString().padStart(2, '0')

const formatTimerClock = (totalSeconds: number, includesHours = false) => {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  return includesHours
    ? `${formatClockSegment(hours)}:${formatClockSegment(minutes)}:${formatClockSegment(seconds)}`
    : `${formatClockSegment(minutes + hours * 60)}:${formatClockSegment(seconds)}`
}

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
    discountRate: 0.1,
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
    appliesTo: ['basicFare', 'meterTimeFare'],
    enabled: false,
    endTime: '',
    startTime: '',
    surchargeRate: 0,
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

export function CasePage() {
  const [searchParams] = useSearchParams()
  const vehicleIdFromQuery = searchParams.get('vehicleId') ?? ''
  const [caseNumber, setCaseNumber] = useState('未採番')
  const [, setIsFareSnapshotLocked] = useState(false)
  const fareSnapshotRef = useRef<FareSnapshot | null>(null)
  const caseNumberAssignmentRef = useRef<CaseNumberAssignment | null>(null)
  const [status, setStatus] = useState<OperationStatus>('空車')
  const [activeTimer, setActiveTimer] = useState<TimerKey | null>(null)
  const [billableTimeStarted, setBillableTimeStarted] = useState({
    accompanying: false,
    waiting: false,
  })
  const [isGpsActive, setIsGpsActive] = useState(false)
  const [isCareModalOpen, setIsCareModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false)
  const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false)
  const [isSettlementFlowOpen, setIsSettlementFlowOpen] = useState(false)
  const [isSettlementConfirmOpen, setIsSettlementConfirmOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('Firestore設定を確認中です。')
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null)
  const [inputHistory, setInputHistory] = useState<InputHistory[]>(loadInputHistory)
  const [selectedCareOptions, setSelectedCareOptions] = useState<
    SelectedCareOption[]
  >([])
  const [selectedDispatchCharges, setSelectedDispatchCharges] = useState<
    SelectedCareOption[]
  >([])
  const [selectedSpecialVehicleCharges, setSelectedSpecialVehicleCharges] = useState<
    SelectedCareOption[]
  >([])
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [isDisabilityDiscount, setIsDisabilityDiscount] = useState(false)
  const [taxiTickets, setTaxiTickets] = useState<TaxiTicket[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('現金')
  const [paymentAmounts, setPaymentAmounts] = useState<Record<PaymentMethod, number>>(
    createEmptyPaymentAmounts,
  )
  const [receiptName, setReceiptName] = useState('')
  const [caseSaveState, setCaseSaveState] = useState<CaseSaveState>('idle')
  const [caseSaveMessage, setCaseSaveMessage] = useState(
    isFirebaseConfigured
      ? '精算・終了で支払方法を選択して保存します。'
      : 'Firebase接続設定が未完了です。GitHub Pagesの環境変数を確認してください。',
  )
  const [currentBasicFareSettings, setCurrentBasicFareSettings] =
    useState<BasicFareSettings>(basicFareSettings)
  const [currentWaitingFareSettings, setCurrentWaitingFareSettings] =
    useState<TimeFareSettings>(waitingFareSettings)
  const [currentEscortFareSettings, setCurrentEscortFareSettings] =
    useState<TimeFareSettings>(escortFareSettings)
  const [currentCareOptionMaster, setCurrentCareOptionMaster] =
    useState<CareOptionMasterItem[]>(careOptionMaster)
  const [currentDispatchMenuItems, setCurrentDispatchMenuItems] = useState<DispatchMenuItem[]>(
    defaultMeterSettings.dispatchMenuItems,
  )
  const [currentSpecialVehicleMenuItems, setCurrentSpecialVehicleMenuItems] = useState<SpecialVehicleMenuItem[]>(
    defaultMeterSettings.specialVehicleMenuItems,
  )
  const [currentExpensePresets, setCurrentExpensePresets] = useState<ExpensePreset[]>(
    defaultMeterSettings.expensePresets,
  )
  const [currentMeterSettings, setCurrentMeterSettings] =
    useState<MeterSettings>(defaultMeterSettings)
  const [savedCaseRecord, setSavedCaseRecord] = useState<StoredCaseRecord | null>(
    null,
  )
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [settlementFlowStep, setSettlementFlowStep] =
    useState<SettlementFlowStep>('receipt')
  const operationStartedAtRef = useRef('')
  const operationEndedAtRef = useRef('')
  const settlementHoldTimerRef = useRef<number | null>(null)
  const [pickupLocation, setPickupLocation] = useState<CapturedAddressLocation>(
    emptyCapturedAddressLocation,
  )
  const [dropoffLocation, setDropoffLocation] = useState<CapturedAddressLocation>(
    emptyCapturedAddressLocation,
  )
  const pickupLocationRef = useRef<CapturedAddressLocation>(
    emptyCapturedAddressLocation,
  )
  const dropoffLocationRef = useRef<CapturedAddressLocation>(
    emptyCapturedAddressLocation,
  )
  const pickupCapturePromiseRef = useRef<Promise<CapturedAddressLocation> | null>(
    null,
  )
  const dropoffCapturePromiseRef = useRef<Promise<CapturedAddressLocation> | null>(
    null,
  )
  const [reverseGeocodeDiagnostic, setReverseGeocodeDiagnostic] =
    useState<ReverseGeocodeDiagnosticState>(getReverseGeocodeDiagnosticState)
  const elapsedTimers = useOperationTimers(activeTimer)
  const gps = useCurrentPosition(
    isGpsActive,
    currentMeterSettings.meterTimeFare.lowSpeedThresholdKmh,
    status === '走行中',
    status !== '精算前' && status !== '案件終了',
  )
  const workSession = useWorkSession()
  const currentScope = tenantScopeFromSession(workSession.currentSession)
  const currentFranchiseeId = currentScope.franchiseeId
  const currentStoreId = currentScope.storeId
  const waitingFareSeconds = billableTimeStarted.waiting
    ? Math.max(elapsedTimers.seconds.waiting, 1)
    : 0
  const escortFareSeconds = billableTimeStarted.accompanying
    ? Math.max(elapsedTimers.seconds.accompanying, 1)
    : 0

  const isTripStarted = status !== '空車'
  const isCaseClosed = status === '案件終了'
  const isOperationLocked = isTripStarted && !isCaseClosed
  const canStartTrip = !isTripStarted && Boolean(workSession.currentSession) && Boolean(selectedVehicleId)
  const canStartWaiting = false
  const canEndWaiting = false
  const canStartAccompanying = false
  const canEndAccompanying = false
  const canOpenSettlement = status === '走行中'
  const canEditCharges = !isOperationLocked && !isCaseClosed && caseSaveState !== 'saving'
  const canAddAssistCharge = canEditCharges
  const canAddExpenseCharge = canEditCharges
  const canAddDispatchCharge = canEditCharges && selectedDispatchCharges.length === 0
  const canAddSpecialVehicleCharge = canEditCharges && selectedSpecialVehicleCharges.length === 0
  const canOpenDispatchModal = canEditCharges

  useEffect(() => () => {
    if (settlementHoldTimerRef.current !== null) {
      window.clearTimeout(settlementHoldTimerRef.current)
    }
  }, [])

  useEffect(() => {
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

        setCurrentMeterSettings(settings)
        setCurrentBasicFareSettings(settings.basicFare)
        setCurrentWaitingFareSettings(settings.waitingFare)
        setCurrentEscortFareSettings(settings.escortFare)
        setCurrentCareOptionMaster(settings.assistItems)
        setCurrentDispatchMenuItems(settings.dispatchMenuItems)
        setCurrentSpecialVehicleMenuItems(settings.specialVehicleMenuItems)
        setCurrentExpensePresets(settings.expensePresets)
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
  }, [currentFranchiseeId, currentStoreId])


  useEffect(() => {
    let isMounted = true

    fetchVehicles({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: workSession.currentSession?.staffRole })
      .then((loadedVehicles) => {
        if (!isMounted) {
          return
        }

        setVehicles(loadedVehicles)
        const matchedVehicle = loadedVehicles.find(
          (vehicle) =>
            vehicle.enabled &&
            vehicle.status === '稼働中' &&
            vehicle.id === vehicleIdFromQuery &&
            (!workSession.currentSession ||
              (vehicle.companyId === workSession.currentSession.companyId &&
                vehicle.storeId === workSession.currentSession.storeId)),
        )
        const fallbackVehicle = loadedVehicles.find(
          (vehicle) =>
            vehicle.enabled &&
            vehicle.status === '稼働中' &&
            (!workSession.currentSession ||
              (vehicle.companyId === workSession.currentSession.companyId &&
                vehicle.storeId === workSession.currentSession.storeId)),
        )
        setSelectedVehicleId(matchedVehicle?.id ?? fallbackVehicle?.id ?? '')
      })
      .catch((error) => {
        console.error('Failed to load vehicles', error)
      })

    return () => {
      isMounted = false
    }
  }, [currentFranchiseeId, currentStoreId, vehicleIdFromQuery, workSession.currentSession])


  useEffect(() => subscribeReverseGeocodeDiagnostic(setReverseGeocodeDiagnostic), [])

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
    expenses,
    isDisabilityDiscount,
    taxiTickets,
    settings: {
      basicFare: currentBasicFareSettings,
      escortFare: currentEscortFareSettings,
      meterTimeFare: currentMeterSettings.meterTimeFare,
      waitingFare: currentWaitingFareSettings,
    },
  })

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

  const fareIncrease = calculateFareIncreaseProgress(
    gps.chargeableDistanceKm,
    currentBasicFareSettings,
  )
  const fareIncreasePercent = Math.round(fareIncrease.progressRate * 100)
  const distanceFareUnitKm =
    gps.chargeableDistanceKm < currentBasicFareSettings.initialDistanceKm
      ? currentBasicFareSettings.initialDistanceKm
      : currentBasicFareSettings.additionalDistanceKm
  const distanceFareElapsedMeters = Math.max(
    0,
    Math.round((distanceFareUnitKm - fareIncrease.remainingDistanceKm) * 1000),
  )
  const distanceFareUnitMeters = Math.round(distanceFareUnitKm * 1000)
  const timeFareIncrease = calculateTimeFareIncreaseProgress(
    gps.lowSpeedSeconds,
    currentMeterSettings.meterTimeFare,
  )
  const timeFareIncreasePercent = Math.round(timeFareIncrease.progressRate * 100)
  const timeFareElapsedSeconds = Math.max(
    0,
    Math.round(currentMeterSettings.meterTimeFare.unitSeconds - timeFareIncrease.remainingSeconds),
  )
  const currentSpeedValueLabel =
    gps.currentSpeedKmh == null ? '取得中...' : gps.currentSpeedKmh.toFixed(1)
  const movementStateLabel =
    gps.movementState === 'low-speed'
      ? '低速走行中'
      : gps.movementState === 'normal'
        ? '通常走行中'
        : '速度判定待ち'
  const enabledCareOptions = useMemo(
    () =>
      currentCareOptionMaster
        .filter((item) => item.enabled)
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

  const addDispatchCharge = (dispatchItem: DispatchMenuItem) => {
    if (!canAddDispatchCharge) {
      return
    }

    setSelectedDispatchCharges([
      {
        amountYen: dispatchItem.amount,
        id: createId(dispatchItem.id),
        masterId: dispatchItem.id,
        name: dispatchItem.name,
      },
    ])
  }

  const addSpecialVehicleCharge = (specialItem: SpecialVehicleMenuItem) => {
    if (!canAddSpecialVehicleCharge) {
      return
    }

    setSelectedSpecialVehicleCharges([
      {
        amountYen: specialItem.amount,
        id: createId(specialItem.id),
        masterId: specialItem.id,
        name: specialItem.name,
      },
    ])
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
    } else {
      addExpense(entry)
    }

    setKeypadTarget(null)
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
      [paymentMethod]: fareBreakdown.totalFareYen,
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
    const capturePromise = captureAddressWithLatestGps(gps.position).then((location) => {
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
    const capturePromise = captureAddressWithLatestGps(gps.position).then((location) => {
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
      待機中: ['走行中'],
      院内付き添い中: ['走行中'],
      精算前: ['案件終了'],
      案件終了: [],
    }

    return allowedTransitions[currentStatus].includes(nextStatus)
  }

  const handleDrivingStart = async () => {
    if (!canStartTrip || !workSession.currentSession || operationStartedAtRef.current) {
      setCaseSaveState('error')
      setCaseSaveMessage(
        !workSession.currentSession
          ? '出勤してから送迎開始してください。'
          : !selectedVehicleId
            ? '案件車両を選択してください。'
            : '現在の状態では送迎開始できません。',
      )
      return
    }

    try {
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
      void capturePickupLocation()
    } catch (error) {
      setCaseSaveState('error')
      setCaseSaveMessage(
        error instanceof Error
          ? `案件番号の採番に失敗しました。${error.message}`
          : '案件番号の採番に失敗しました。通信状況とFirebase設定を確認してください。',
      )
    }
  }

  const handleSettlementStart = () => {
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

  const handleSettlementFlowStart = () => {
    if (!handleSettlementStart()) {
      return
    }

    if (paymentTotalYen === 0) {
      setPaymentAmounts({
        ...createEmptyPaymentAmounts(),
        [paymentMethod]: fareBreakdown.totalFareYen,
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

  const handleStatusChange = (nextStatus: OperationStatus) => {
    if (!canTransitionStatus(status, nextStatus)) {
      setCaseSaveState('error')
      setCaseSaveMessage(`現在の状態（${status}）から${nextStatus}へは切り替えできません。`)
      return false
    }

    setStatus(nextStatus)
    setActiveTimer(activeTimerMap[nextStatus] ?? null)

    if (nextStatus === '走行中') {
      setIsGpsActive(true)
    }

    if (nextStatus === '待機中') {
      setBillableTimeStarted((current) => ({ ...current, waiting: true }))
    }

    if (nextStatus === '院内付き添い中') {
      setBillableTimeStarted((current) => ({ ...current, accompanying: true }))
    }

    if (nextStatus === '空車' || nextStatus === '案件終了') {
      setIsGpsActive(false)
    }

    return true
  }


  const handleCaseClose = async () => {
    if (caseSaveState === 'saved' || caseSaveState === 'saving') {
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
    if (paymentTotalYen !== fareBreakdown.totalFareYen) {
      setCaseSaveState('error')
      setCaseSaveMessage('支払総額と請求額が一致しないため保存できません。')
      return null
    }

    const finalDrivingSeconds = elapsedTimers.seconds.driving

    handleStatusChange('案件終了')
    setCaseSaveState('saving')
    setCaseSaveMessage('Firestoreへ保存中です。')

    try {
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
        waitingSeconds: elapsedTimers.seconds.waiting,
        accompanyingSeconds: elapsedTimers.seconds.accompanying,
        workSession: workSession.currentSession,
        vehicle: selectedVehicle,
        fareBreakdown,
        paymentMethod,
        payments,
        receiptName,
        taxiTickets,
        pickupLocation: pickupLocationRef.current,
        selectedCareOptions,
        selectedDispatchCharges,
        selectedSpecialVehicleCharges,
        selectedExpenses: expenses,
        dropoffLocation: dropoffLocationRef.current,
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
        waitingSeconds: elapsedTimers.seconds.waiting,
        accompanyingSeconds: elapsedTimers.seconds.accompanying,
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
        dispatchFareYen: fareBreakdown.dispatchFareYen,
        specialVehicleFareYen: fareBreakdown.specialVehicleFareYen,
        basicFareYen: fareBreakdown.basicFareYen,
        meterTimeFareYen: fareBreakdown.meterTimeFareYen,
        waitingFareYen: fareBreakdown.waitingFareYen,
        escortFareYen: fareBreakdown.escortFareYen,
        careOptionFareYen: fareBreakdown.careOptionFareYen,
        expenseFareYen: fareBreakdown.expenseFareYen,
        totalFareYen: fareBreakdown.totalFareYen,
        grossFareYen: fareBreakdown.grossFareYen,
        discountableFareYen: fareBreakdown.discountableFareYen,
        isDisabilityDiscount: fareBreakdown.isDisabilityDiscount,
        disabilityDiscountRate: fareBreakdown.disabilityDiscountRate,
        disabilityDiscountAmount: fareBreakdown.disabilityDiscountAmount,
        taxiTicketAmountYen: fareBreakdown.taxiTicketAmountYen,
        taxiTickets,
        paymentMethod,
        payments,
        receiptName: '',
        customerName: '',
        remarks: '',
        status: 'completed',
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
      }

      setSavedCaseRecord(savedRecord)
      setCaseSaveState('saved')
      setCaseSaveMessage('Firestoreへ保存しました。レシートまたは領収書を発行できます。')
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

  const handleThermalReceiptPrint = async () => {
    if (!savedCaseRecord) {
      return
    }

    await openThermalReceiptPdf(savedCaseRecord, currentMeterSettings, {
      customerName: savedCaseRecord.receiptName || receiptName,
      expenseItems: expenses,
      issuerName: currentMeterSettings.receipt.issuerName,
      receiptNote: currentMeterSettings.receipt.defaultReceiptNote,
    })
    setSettlementFlowStep('saved')
  }

  const handleA4ReceiptDownload = async () => {
    if (!savedCaseRecord) {
      return
    }

    await downloadReceiptPdf(savedCaseRecord, currentMeterSettings, {
      customerName: savedCaseRecord.receiptName || receiptName,
      issuerName: currentMeterSettings.receipt.issuerName,
      receiptNote: currentMeterSettings.receipt.defaultReceiptNote,
    })
    setSettlementFlowStep('saved')
  }

  const handleStartNewCase = () => {
    window.location.reload()
  }

  const timeFareElapsedLabel = `${Math.floor(timeFareElapsedSeconds / 60)}分 ${timeFareElapsedSeconds % 60}秒`
  const drivingClockLabel = formatTimerClock(elapsedTimers.seconds.driving)
  const waitingClockLabel = formatTimerClock(elapsedTimers.seconds.waiting, true)
  const accompanyingClockLabel = formatTimerClock(elapsedTimers.seconds.accompanying, true)
  const waitingToggleLabel = status === '待機中' ? '待機終了' : '待機開始'
  const accompanyingToggleLabel = status === '院内付き添い中' ? '付き添い終了' : '付き添い開始'

  return (
    <main
      className={`r9-meter-page r9-meter-page--${statusToneMap[status]}`}
      aria-label="業務用メーター"
    >
      <div className="landscape-notice" role="status">
        <strong>スマホ表示に対応しました</strong>
        <span>縦画面でも横スクロールせず操作できます。</span>
      </div>

      <div className="r9-meter-shell">
        <span className="meter-screw meter-screw--top-left" />
        <span className="meter-screw meter-screw--top-right" />
        <span className="meter-screw meter-screw--bottom-left" />
        <span className="meter-screw meter-screw--bottom-right" />

        <div className="r9-meter-console">
          <section className="r9-left-panel" aria-label="料金メーター">
            <section className="r9-fare-card" aria-label="現在料金">
              <div className="r9-fare-screen">
                <h1>合計金額</h1>
                <div className="r9-fare-amount">
                  <strong>{formatFareYen(fareBreakdown.totalFareYen)}</strong>
                  <span className="r9-fare-unit">円</span>
                </div>
              </div>

              <div className="fare-increase-stack" aria-label="加算インジケーター">
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

                <div className={`fare-increase-panel fare-increase-panel--time ${status === '走行中' && gps.movementState === 'low-speed' ? 'fare-increase-panel--active' : ''}`}>
                  <span className="fare-increase-icon" aria-hidden="true">◷</span>
                  <div className="fare-increase-content">
                    <div className="fare-increase-panel__label">
                      <span>時間加算まで</span>
                      <strong>{timeFareElapsedLabel}</strong>
                    </div>
                    <div className="fare-increase-track">
                      <span style={{ width: `${timeFareIncreasePercent}%` }} />
                      <i />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="r9-driving-card" aria-label="走行情報">
              <div className="r9-drive-summary">
                <div className="r9-speed-gauge">
                  <span>現在速度</span>
                  <strong>{currentSpeedValueLabel}</strong>
                  <em>km/h</em>
                </div>
                <div className="r9-distance-panel">
                  <div className="r9-distance-panel__header">
                    <span>運賃距離</span>
                    <small>{movementStateLabel}</small>
                  </div>
                  <strong>{gps.chargeableDistanceKm.toFixed(3)} <em>km</em></strong>
                </div>
              </div>

              <div className="r9-timer-action-grid" aria-label="時間操作">
                <div className="r9-timer-display">
                  <span>運行時間</span>
                  <strong>{drivingClockLabel}</strong>
                </div>
                <button
                  className={`r9-time-action ${status === '待機中' ? 'r9-time-action--active' : ''}`}
                  type="button"
                  aria-pressed={status === '待機中'}
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
              </div>
            </section>

          </section>

          <section className="r9-center-panel" aria-label="料金内訳">
            <MeterFareBreakdownPanel
              breakdown={fareBreakdown}
              hideTotal
            />
          </section>

          <section className="r9-right-panel" aria-label="状態操作">
            <div className="r9-status-stack">
              <button
                className="r9-status-button r9-status-button--driving"
                type="button"
                disabled={!canStartTrip}
                onClick={() => { void handleDrivingStart() }}
              >
                <span aria-hidden="true">🚘</span>
                <strong>送迎開始</strong>
              </button>
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
                <small id="settlement-hold-help">長押し後に確認</small>
              </button>
            </div>

            {isDevelopmentMode ? (
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
                    errorMessage={gps.errorMessage}
                    gpsLogCount={gps.gpsLogCount}
                    isActive={gps.isActive}
                    position={gps.position}
                    status={gps.status}
                    speedSource={gps.speedSource}
                    totalDistanceKm={gps.chargeableDistanceKm}
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
                <h2 id="care-modal-title">介助</h2>
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
                  <h3 id="care-items-title">介助項目</h3>
                  <strong>{formatFareYen(fareBreakdown.careOptionFareYen)}円</strong>
                </div>
                <div className="r9-modal-button-grid r9-modal-button-grid--care">
                  {enabledCareOptions.map((item) => {
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
                  {enabledDispatchMenuItems.map((dispatchItem) => (
                    <button
                      className="r9-modal-choice r9-modal-choice--dispatch"
                      key={dispatchItem.id}
                      type="button"
                      disabled={!canAddDispatchCharge}
                      onClick={() => addDispatchCharge(dispatchItem)}
                    >
                      <span>{dispatchItem.name}</span>
                      <strong>{formatFareYen(dispatchItem.amount)}円</strong>
                    </button>
                  ))}
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
                  {enabledSpecialVehicleMenuItems.map((specialItem) => (
                    <button
                      className="r9-modal-choice r9-modal-choice--special-vehicle"
                      key={specialItem.id}
                      type="button"
                      disabled={!canAddSpecialVehicleCharge}
                      onClick={() => addSpecialVehicleCharge(specialItem)}
                    >
                      <span>{specialItem.name}</span>
                      <strong>{formatFareYen(specialItem.amount)}円</strong>
                    </button>
                  ))}
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
                <h2 id="expense-modal-title">実費</h2>
              </div>
              <button type="button" onClick={() => setIsExpenseModalOpen(false)}>
                閉じる
              </button>
            </header>

            <div className="r9-operation-section">
              <div className="r9-operation-section__header">
                <h3>実費ワンタッチ</h3>
                <strong>{formatFareYen(expenseTotalYen)}円</strong>
              </div>
              <div className="r9-modal-button-grid r9-modal-button-grid--expense">
                {currentExpensePresets
                  .filter((preset) => preset.name.trim())
                  .map((preset) => (
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
                      <strong>{formatFareYen(preset.defaultAmountYen)}円</strong>
                    </button>
                  ))}
              </div>
              <div className="r9-summary-card r9-summary-card--modal">
                {expenses.length === 0 ? (
                  <p className="empty-note">実費は未追加です。</p>
                ) : (
                  <div className="r9-summary-list">
                    {expenses.map((expense) => (
                      <p key={expense.id}>
                        <span>{expense.name}</span>
                        <strong>{formatFareYen(expense.amountYen)}円</strong>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isSettlementConfirmOpen ? (
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

            <div className="r9-settlement-steps" aria-label="精算・終了手順">
              <span className="r9-settlement-steps__done">支払方法選択</span>
              <span className={savedCaseRecord ? 'r9-settlement-steps__done' : ''}>保存</span>
              <span className={savedCaseRecord ? 'r9-settlement-steps__done' : ''}>レシート・領収書発行</span>
              <span className={settlementFlowStep === 'saved' ? 'r9-settlement-steps__done' : ''}>発行完了</span>
              <span>新しい案件を開始</span>
            </div>

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
                  breakdown={fareBreakdown}
                  businessDistanceKm={gps.businessDistanceKm}
                  chargeableDistanceKm={gps.chargeableDistanceKm}
                  isDisabilityDiscount={isDisabilityDiscount}
                  paymentAmounts={paymentAmounts}
                  paymentMethod={paymentMethod}
                  receiptName={receiptName}
                  saveMessage={caseSaveMessage}
                  saveState={caseSaveState}
                  taxiTickets={taxiTickets}
                  onAddTaxiTicket={addTaxiTicket}
                  onDisabilityDiscountChange={setIsDisabilityDiscount}
                  onPaymentAmountChange={updatePaymentAmount}
                  onPaymentMethodChange={setPaymentMethod}
                  onReceiptNameChange={setReceiptName}
                  onRemoveTaxiTicket={removeTaxiTicket}
                  onSettlePaymentRemainder={settlePaymentRemainder}
                />
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
                <p>案件を保存しました。レシートまたは領収書を発行してください。</p>
                <div className="payment-complete-total">
                  <span>合計金額</span>
                  <strong>{formatFareYen(savedCaseRecord.totalFareYen)}円</strong>
                </div>
                <div className="receipt-dialog-actions">
                  <button
                    className="receipt-dialog-primary"
                    type="button"
                    onClick={() => {
                      void handleThermalReceiptPrint()
                    }}
                  >
                    レシート発行
                  </button>
                  <button
                    className="receipt-dialog-secondary"
                    type="button"
                    onClick={() => {
                      void handleA4ReceiptDownload()
                    }}
                  >
                    領収書発行
                  </button>
                </div>
                {settlementFlowStep === 'saved' ? (
                  <div className="r9-issue-complete">
                    <strong>発行完了</strong>
                    <button
                      className="r9-flow-primary"
                      type="button"
                      onClick={handleStartNewCase}
                    >
                      新しい案件を開始
                    </button>
                  </div>
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
          title={keypadTarget.name}
          onClose={() => setKeypadTarget(null)}
          onConfirm={handleKeypadConfirm}
        />
      ) : null}
    </main>
  )
}
