import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Dispatch, SetStateAction } from 'react'
import { FareBreakdownPanel } from '../components/case/FareBreakdownPanel'
import { ClockInPanel } from '../components/work/ClockInPanel'
import { CurrentWorkSessionPanel } from '../components/work/CurrentWorkSessionPanel'
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
  careOptionMaster,
  escortFareSettings,
  formatFareYen,
  waitingFareSettings,
} from '../services/fare'
import { saveCaseRecord } from '../services/caseRecords'
import { fetchVehicles } from '../services/vehicles'
import type { StoredCaseRecord } from '../services/caseRecords'
import {
  defaultMeterSettings,
  fetchMeterSettings,
  fixedTimeFareUnitSeconds,
} from '../services/meterSettings'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  TimeFareSettings,
} from '../services/fare'
import type { ExpensePreset, MeterSettings } from '../services/meterSettings'
import type { Vehicle } from '../types/work'
import { downloadReceiptPdf } from '../utils/receiptPdf'
import { openThermalReceiptPdf } from '../utils/thermalReceiptPdf'
import {
  captureCurrentAddressLocation,
  emptyCapturedAddressLocation,
} from '../utils/reverseGeocode'
import type { CapturedAddressLocation } from '../utils/reverseGeocode'
import type {
  ExpenseItem,
  OperationStatus,
  PaymentMethod,
  SelectedCareOption,
  StatusTone,
  TimerKey,
} from '../types/case'

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

const loadInputHistory = () => {
  try {
    const historyJson = localStorage.getItem(inputHistoryStorageKey)
    return historyJson ? (JSON.parse(historyJson) as InputHistory[]) : []
  } catch {
    return []
  }
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`

const createCaseNumber = () => {
  const now = new Date()
  const datePart = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  })
    .format(now)
    .replaceAll('/', '')
  const timePart = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
    .format(now)
    .replaceAll(':', '')

  return `CASE-${datePart}-${timePart}`
}

const toPositiveNumber = (value: string, minimum = 0) =>
  Math.max(Number(value) || minimum, minimum)

export function CasePage() {
  const [searchParams] = useSearchParams()
  const vehicleIdFromQuery = searchParams.get('vehicleId') ?? ''
  const caseNumber = useMemo(() => createCaseNumber(), [])
  const [status, setStatus] = useState<OperationStatus>('空車')
  const [activeTimer, setActiveTimer] = useState<TimerKey | null>(null)
  const [billableTimeStarted, setBillableTimeStarted] = useState({
    accompanying: false,
    waiting: false,
  })
  const [isGpsActive, setIsGpsActive] = useState(false)
  const [isCareModalOpen, setIsCareModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false)
  const [isSettlementFlowOpen, setIsSettlementFlowOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('Firestore設定を確認中です。')
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null)
  const [inputHistory, setInputHistory] = useState<InputHistory[]>(loadInputHistory)
  const [selectedCareOptions, setSelectedCareOptions] = useState<
    SelectedCareOption[]
  >([])
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('現金')
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
  const elapsedTimers = useOperationTimers(activeTimer)
  const gps = useCurrentPosition(isGpsActive)
  const workSession = useWorkSession()
  const waitingFareSeconds = billableTimeStarted.waiting
    ? Math.max(elapsedTimers.seconds.waiting, 1)
    : 0
  const escortFareSeconds = billableTimeStarted.accompanying
    ? Math.max(elapsedTimers.seconds.accompanying, 1)
    : 0

  useEffect(() => {
    let isMounted = true

    fetchMeterSettings()
      .then((settings) => {
        if (!isMounted) {
          return
        }

        setCurrentMeterSettings(settings)
        setCurrentBasicFareSettings(settings.basicFare)
        setCurrentWaitingFareSettings(settings.waitingFare)
        setCurrentEscortFareSettings(settings.escortFare)
        setCurrentCareOptionMaster(settings.assistItems)
        setCurrentExpensePresets(settings.expensePresets)
        setSettingsMessage('Firestore設定を反映しています。')
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setSettingsMessage(
          error instanceof Error
            ? `Firestore設定を読み込めませんでした。${error.message}`
            : 'Firestore設定を読み込めませんでした。',
        )
      })

    return () => {
      isMounted = false
    }
  }, [])


  useEffect(() => {
    let isMounted = true

    fetchVehicles()
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
  }, [vehicleIdFromQuery, workSession.currentSession])



  const fareBreakdown = calculateFareBreakdown({
    distanceKm: gps.totalDistanceKm,
    waitingSeconds: waitingFareSeconds,
    escortSeconds: escortFareSeconds,
    careOptions: selectedCareOptions,
    expenses,
    settings: {
      basicFare: currentBasicFareSettings,
      escortFare: currentEscortFareSettings,
      waitingFare: currentWaitingFareSettings,
    },
  })

  const fareIncrease = calculateFareIncreaseProgress(
    gps.totalDistanceKm,
    currentBasicFareSettings,
  )
  const fareIncreasePercent = Math.round(fareIncrease.progressRate * 100)
  const enabledCareOptions = useMemo(
    () =>
      currentCareOptionMaster
        .filter((item) => item.enabled)
        .sort(
          (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
        ),
    [currentCareOptionMaster],
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

  const addExpense = ({ amountYen, name }: Omit<ExpenseItem, 'id'>) => {
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

  const handleHistorySelect = (history: InputHistory) => {
    if (history.mode === 'care') {
      addCareOption({
        amountYen: history.amountYen,
        masterId: 'history-care',
        name: history.name,
      })
    } else {
      addExpense({ amountYen: history.amountYen, name: history.name })
    }
  }

  const markOperationStarted = () => {
    if (!operationStartedAtRef.current) {
      operationStartedAtRef.current = new Date().toISOString()
    }
  }

  const capturePickupLocation = () => {
    const capturePromise = captureCurrentAddressLocation().then((location) => {
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
    const capturePromise = captureCurrentAddressLocation().then((location) => {
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

  const handleDrivingStart = () => {
    markOperationStarted()
    handleStatusChange('走行中')
    void capturePickupLocation()
  }

  const handleSettlementStart = () => {
    if (!workSession.currentSession) {
      setCaseSaveState('error')
      setCaseSaveMessage('出勤してから案件を保存してください。')
      return null
    }

    if (!selectedVehicleId) {
      setCaseSaveState('error')
      setCaseSaveMessage('案件車両を選択してください。')
      return null
    }

    if (!operationEndedAtRef.current) {
      const endedAt = new Date().toISOString()
      operationEndedAtRef.current = endedAt
    }
    handleStatusChange('精算前')

    if (!dropoffLocationRef.current.capturedAt && !dropoffCapturePromiseRef.current) {
      void captureDropoffLocation()
    }
  }

  const handleSettlementFlowStart = () => {
    setIsSettlementFlowOpen(true)
    setSettlementFlowStep('receipt')
    handleSettlementStart()
  }

  const handleStatusChange = (nextStatus: OperationStatus) => {
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
  }


  const handleClockIn = async () => {
    const selectedStore = stores.find((store) => store.id === selectedStoreId)
    const selectedStaffMember = staffMembers.find(
      (staffMember) => staffMember.id === selectedStaffId,
    )
    const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)

    if (!selectedStore || !selectedStaffMember || !selectedVehicle) {
      return
    }

    try {
      await workSession.clockIn({
        staffMember: selectedStaffMember,
        store: selectedStore,
        vehicle: selectedVehicle,
      })
    } catch (error) {
      console.error('Failed to clock in', error)
    }
  }

  const handleClockOut = async () => {
    try {
      await workSession.clockOut()
    } catch (error) {
      console.error('Failed to clock out', error)
    }
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

    if (!operationEndedAtRef.current) {
      const endedAt = new Date().toISOString()
      operationEndedAtRef.current = endedAt
    }
    const finalDrivingSeconds = elapsedTimers.seconds.driving

    handleStatusChange('案件終了')
    setCaseSaveState('saving')
    setCaseSaveMessage('Firestoreへ保存中です。')

    try {
      if (pickupCapturePromiseRef.current) {
        await pickupCapturePromiseRef.current
      }

      if (dropoffCapturePromiseRef.current) {
        await dropoffCapturePromiseRef.current
      }

      if (!dropoffLocationRef.current.capturedAt) {
        await captureDropoffLocation()
      }

      const closedAt = new Date().toISOString()
      const savedRecordRef = await saveCaseRecord({
        caseNumber,
        closedAt,
        startedAt: operationStartedAtRef.current,
        endedAt: operationEndedAtRef.current,
        distanceKm: gps.totalDistanceKm,
        drivingSeconds: finalDrivingSeconds,
        waitingSeconds: elapsedTimers.seconds.waiting,
        accompanyingSeconds: elapsedTimers.seconds.accompanying,
        workSession: workSession.currentSession,
        vehicle: selectedVehicle,
        fareBreakdown,
        paymentMethod,
        pickupLocation: pickupLocationRef.current,
        selectedCareOptions,
        selectedExpenses: expenses,
        dropoffLocation: dropoffLocationRef.current,
      })
      const savedRecord: StoredCaseRecord = {
        id: savedRecordRef.id,
        caseNumber,
        closedAt,
        startedAt: operationStartedAtRef.current,
        endedAt: operationEndedAtRef.current,
        distanceKm: Number(gps.totalDistanceKm.toFixed(3)),
        drivingSeconds: finalDrivingSeconds,
        waitingSeconds: elapsedTimers.seconds.waiting,
        accompanyingSeconds: elapsedTimers.seconds.accompanying,
        companyId: workSession.currentSession?.companyId ?? '',
        companyName: workSession.currentSession?.companyName ?? '',
        staffId: workSession.currentSession?.staffId ?? '',
        staffName: workSession.currentSession?.staffName ?? '',
        staffRole: workSession.currentSession?.staffRole ?? '',
        vehicleId: selectedVehicle.id,
        vehicleName: selectedVehicle.name,
        vehicleNumber: selectedVehicle.number,
        workSessionId: workSession.currentSession?.id ?? '',
        storeId: workSession.currentSession?.storeId ?? '',
        storeName: workSession.currentSession?.storeName ?? '',
        basicFareYen: fareBreakdown.basicFareYen,
        waitingFareYen: fareBreakdown.waitingFareYen,
        escortFareYen: fareBreakdown.escortFareYen,
        careOptionFareYen: fareBreakdown.careOptionFareYen,
        expenseFareYen: fareBreakdown.expenseFareYen,
        totalFareYen: fareBreakdown.totalFareYen,
        paymentMethod,
        pickupLatitude: pickupLocationRef.current.latitude,
        pickupLongitude: pickupLocationRef.current.longitude,
        pickupAddress: pickupLocationRef.current.address,
        pickupCapturedAt: pickupLocationRef.current.capturedAt,
        dropoffLatitude: dropoffLocationRef.current.latitude,
        dropoffLongitude: dropoffLocationRef.current.longitude,
        dropoffAddress: dropoffLocationRef.current.address,
        dropoffCapturedAt: dropoffLocationRef.current.capturedAt,
        assistCharges: selectedCareOptions.map((careOption) => ({
          id: careOption.masterId,
          name: careOption.name,
          amount: careOption.amountYen,
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
      customerName: '',
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
      customerName: '',
      issuerName: currentMeterSettings.receipt.issuerName,
      receiptNote: currentMeterSettings.receipt.defaultReceiptNote,
    })
    setSettlementFlowStep('saved')
  }

  const handleStartNewCase = () => {
    window.location.reload()
  }

  const displayMetrics = [
    { label: '距離', value: `${gps.totalDistanceKm.toFixed(3)} km` },
    { label: '運行時間', value: elapsedTimers.driving },
    { label: '待機時間', value: elapsedTimers.waiting },
    { label: '付き添い', value: elapsedTimers.accompanying },
  ]

  return (
    <main
      className={`r9-meter-page r9-meter-page--${statusToneMap[status]}`}
      aria-labelledby="case-title"
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

        <header className="r9-header-strip">
          <div>
            <p>介護タクシー専用クラウドメーター</p>
            <h1 id="case-title">業務用メーター</h1>
          </div>
          <div className="r9-header-status">
            <span>案件 {caseNumber}</span>
            <strong className={`status-badge status-badge--${statusToneMap[status]}`}>
              {status}
            </strong>
          </div>
        </header>


        <section className="work-session-panel" aria-labelledby="case-vehicle-title">
          <div className="work-session-panel__header">
            <div>
              <span>CASE VEHICLE</span>
              <h2 id="case-vehicle-title">案件車両選択</h2>
            </div>
            <strong>{workSession.currentSession ? workSession.currentSession.staffName : '未出勤'}</strong>
          </div>
          {workSession.currentSession ? (
            <div className="work-session-form">
              <label>
                店舗
                <input readOnly value={workSession.currentSession.storeName} />
              </label>
              <label>
                スタッフ
                <input readOnly value={workSession.currentSession.staffName} />
              </label>
              <label>
                車両
                <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
                  <option value="">車両を選択</option>
                  {vehicles
                    .filter(
                      (vehicle) =>
                        vehicle.enabled &&
                        vehicle.status === '稼働中' &&
                        vehicle.companyId === workSession.currentSession?.companyId &&
                        vehicle.storeId === workSession.currentSession?.storeId,
                    )
                    .map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.name} / {vehicle.number || 'ナンバー未設定'}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="empty-note">TOP画面で出勤してから案件を開始してください。</p>
          )}
        </section>


        <div className="r9-meter-console">
          <section className="r9-left-panel" aria-label="料金メーター">
            <div className="r9-fare-screen">
              <div className="r9-fare-screen__top">
                <span>現在料金</span>
                <em>支払前</em>
              </div>
              <strong>{formatFareYen(fareBreakdown.totalFareYen)}</strong>
              <span className="r9-fare-unit">円</span>
            </div>

            <div className="fare-increase-panel">
              <div className="fare-increase-panel__label">
                <span>運賃上昇予告</span>
                <strong>次回 +{formatFareYen(fareIncrease.nextIncreaseYen)}円</strong>
              </div>
              <div className="fare-increase-track">
                <span style={{ width: `${fareIncreasePercent}%` }} />
                <i />
              </div>
              <small>
                次回加算まで 約{fareIncrease.remainingDistanceKm.toFixed(3)}km
              </small>
            </div>

            <FareBreakdownPanel breakdown={fareBreakdown} />

            <div className="r9-metrics-grid" aria-label="運行情報">
              {displayMetrics.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="r9-center-panel" aria-label="追加料金サマリー">
            <div className="r9-panel-title">
              <span>ASSIST</span>
              <h2>介助サマリー</h2>
            </div>
            <div className="r9-summary-card">
              {selectedCareOptions.length === 0 ? (
                <p className="empty-note">介助項目は未選択です。</p>
              ) : (
                <div className="r9-summary-list">
                  {selectedCareOptions.map((option) => (
                    <p key={option.id}>
                      <span>{option.name}</span>
                      <strong>{formatFareYen(option.amountYen)}円</strong>
                    </p>
                  ))}
                </div>
              )}
              <div className="r9-summary-total">
                <span>介助合計</span>
                <strong>{formatFareYen(fareBreakdown.careOptionFareYen)}円</strong>
              </div>
            </div>

            <div className="r9-panel-title r9-panel-title--expense">
              <span>COST</span>
              <h2>実費サマリー</h2>
            </div>
            <div className="r9-summary-card">
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
              <div className="r9-summary-total">
                <span>実費合計</span>
                <strong>{formatFareYen(expenseTotalYen)}円</strong>
              </div>
            </div>

            <div className="r9-history-panel">
              <h2>過去入力履歴</h2>
              {inputHistory.length === 0 ? (
                <p>履歴はまだありません。</p>
              ) : null}
              <div>
                {inputHistory.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleHistorySelect(item)}
                  >
                    <span>{item.mode === 'care' ? '介助' : '実費'}</span>
                    <strong>{item.name}</strong>
                    <em>{formatFareYen(item.amountYen)}円</em>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="r9-right-panel" aria-label="状態操作">
            <div className="r9-status-stack">
              <button
                className="r9-status-button r9-status-button--driving"
                type="button"
                onClick={handleDrivingStart}
              >
                送迎開始
              </button>
              <button
                className="r9-status-button r9-status-button--assist"
                type="button"
                onClick={() => setIsCareModalOpen(true)}
              >
                介助
              </button>
              <button
                className="r9-status-button r9-status-button--expense"
                type="button"
                onClick={() => setIsExpenseModalOpen(true)}
              >
                実費
              </button>
              <button
                className="r9-status-button r9-status-button--settlement"
                type="button"
                disabled={caseSaveState === 'saving'}
                onClick={handleSettlementFlowStart}
              >
                精算・終了
              </button>
            </div>

            <div className="r9-side-tools">
              <button type="button" onClick={() => setIsSettingsOpen(true)}>
                設定
              </button>
              <details
                className="r9-gps-debug"
                open={isGpsPanelOpen}
                onToggle={(event) => setIsGpsPanelOpen(event.currentTarget.open)}
              >
                <summary>GPS非表示</summary>
                <GpsPanel
                  errorMessage={gps.errorMessage}
                  gpsLogCount={gps.gpsLogCount}
                  isActive={gps.isActive}
                  position={gps.position}
                  status={gps.status}
                  totalDistanceKm={gps.totalDistanceKm}
                />
              </details>
            </div>

            <div className="r9-address-capture" aria-label="住所取得状態">
              <p>
                <span>伺い先</span>
                <strong>{pickupLocation.address || '住所未取得'}</strong>
              </p>
              <p>
                <span>送り先</span>
                <strong>{dropoffLocation.address || '住所未取得'}</strong>
              </p>
            </div>

            <SettlementPanel
              breakdown={fareBreakdown}
              paymentMethod={paymentMethod}
              saveMessage={caseSaveMessage}
              saveState={caseSaveState}
              onPaymentMethodChange={setPaymentMethod}
            />
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
                        onClick={() => toggleCareOption(item)}
                      >
                        <span>{isSelected ? '✓ ' : ''}{item.name}</span>
                        <strong>{formatFareYen(item.amount)}円</strong>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="r9-operation-section" aria-labelledby="time-addition-title">
                <div className="r9-operation-section__header">
                  <h3 id="time-addition-title">時間加算</h3>
                  <span>待機・付き添いはタイマー加算です</span>
                </div>
                <div className="r9-time-toggle-grid">
                  <button
                    className={`r9-time-toggle ${status === '待機中' ? 'r9-time-toggle--active' : ''}`}
                    type="button"
                    aria-pressed={status === '待機中'}
                    onClick={() => handleStatusChange(status === '待機中' ? '走行中' : '待機中')}
                  >
                    <span>待機 {status === '待機中' ? 'ON' : 'OFF'}</span>
                    <strong>{elapsedTimers.waiting}</strong>
                    <em>{formatFareYen(fareBreakdown.waitingFareYen)}円</em>
                  </button>
                  <button
                    className={`r9-time-toggle ${status === '院内付き添い中' ? 'r9-time-toggle--active' : ''}`}
                    type="button"
                    aria-pressed={status === '院内付き添い中'}
                    onClick={() => handleStatusChange(status === '院内付き添い中' ? '走行中' : '院内付き添い中')}
                  >
                    <span>付き添い {status === '院内付き添い中' ? 'ON' : 'OFF'}</span>
                    <strong>{elapsedTimers.accompanying}</strong>
                    <em>{formatFareYen(fareBreakdown.escortFareYen)}円</em>
                  </button>
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
                  paymentMethod={paymentMethod}
                  saveMessage={caseSaveMessage}
                  saveState={caseSaveState}
                  onPaymentMethodChange={setPaymentMethod}
                />
                <button
                  className="r9-flow-primary"
                  type="button"
                  disabled={caseSaveState === 'saving'}
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
