import {
  CHARTER_UNIT_FARE_YEN,
  CHARTER_UNIT_MINUTES,
} from '../constants/fareConstants'
import { FirebaseError } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FieldValue } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { defaultFranchiseeId, defaultStoreId, tenantFields } from './tenancy'
import type { TenantScope } from './tenancy'
import { OFFICIAL_COMPANY_PROFILE } from '../constants/officialCompanyProfile'
import { resolveReceiptCompanySettings } from '../utils/receiptCompanyContact'
import { createAuditLog } from './auditLogs'
import {
  basicFareSettings,
  careOptionMaster,
  dispatchMenuMaster,
  escortFareSettings,
  expenseSettings,
  meterTimeFareSettings,
  specialVehicleMenuMaster,
  waitingFareSettings,
  DEFAULT_DISCOUNT_SETTINGS,
} from './fare'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  DispatchMenuItem,
  MeterTimeFareSettings,
  SpecialVehicleMenuItem,
  TimeFareSettings,
  DiscountSettings,
} from './fare'

export type ExpensePreset = {
  id: string
  name: string
  defaultAmountYen: number
}

export type CompanySettings = {
  companyName: string
  corporateName: string
  tradeName: string
  phoneNumber: string
  email: string
  postalCode: string
  address: string
}

export type ReceiptSettings = {
  issuerName: string
  receiptDefault: string
  statementDefault: string
  invoiceNumber: string
  defaultReceiptNote: string
  /** レシート運行情報印字（未登録時は true） */
  printReceiptOperationInfo: boolean
}

export type TimeMeterLegalSettings = {
  baseFareYen: number
  baseMinutes: number
  additionalMinutes: number
  additionalFareYen: number
}

export type TimeMeterDiscountSettings = {
  enabled: boolean
  initialMinutes: number
  additionalSeconds: number
}

export type TimeMeterSettings = {
  legal: TimeMeterLegalSettings
  discount: TimeMeterDiscountSettings
}

export type MeterMode = 'gps' | 'time' | 'obd'

export type TimeMeterModeSettings = {
  additionalFare: TimeFareSettings
  baseFareYen: number
  baseMinutes: number
}

export type MeterModeFareSettings = {
  basicFare: BasicFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  meterTimeFare: MeterTimeFareSettings
  assistItems: CareOptionMasterItem[]
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  discount: DiscountSettings
}

export type MeterSettingsByMode = {
  gps: MeterModeFareSettings
  time: TimeMeterModeSettings & Pick<MeterModeFareSettings, 'waitingFare' | 'escortFare' | 'assistItems' | 'dispatchMenuItems' | 'specialVehicleMenuItems' | 'discount'>
  obd: MeterModeFareSettings
}

export type MeterSettings = {
  meterSettings: MeterSettingsByMode
  basicFare: BasicFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  meterTimeFare: MeterTimeFareSettings
  time: TimeMeterSettings
  assistItems: CareOptionMasterItem[]
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  expensePresets: ExpensePreset[]
  company: CompanySettings
  receipt: ReceiptSettings
  discount: DiscountSettings
}

export type MeterSettingsDocument = MeterSettings & {
  franchiseeId: string
  storeId: string
  companyId: string
  updatedAt: FieldValue
}

const legacySettingsCollectionName = 'appSettings'
const settingsCollectionName = 'meterSettings'
const meterSettingsDocumentId = 'meterSettings'
export const fixedTimeFareUnitSeconds = 30 * 60

export const defaultTimeMeterLegalSettings: TimeMeterLegalSettings = {
  baseFareYen: CHARTER_UNIT_FARE_YEN,
  baseMinutes: CHARTER_UNIT_MINUTES,
  additionalMinutes: CHARTER_UNIT_MINUTES,
  additionalFareYen: CHARTER_UNIT_FARE_YEN,
}

export const defaultTimeMeterDiscountSettings: TimeMeterDiscountSettings = {
  enabled: false,
  initialMinutes: 4,
  additionalSeconds: 60,
}

export const defaultTimeMeterSettings: TimeMeterSettings = {
  legal: defaultTimeMeterLegalSettings,
  discount: defaultTimeMeterDiscountSettings,
}

const defaultTimeMeterModeSettings: MeterSettingsByMode['time'] = {
  additionalFare: { unitFareYen: CHARTER_UNIT_FARE_YEN, unitSeconds: fixedTimeFareUnitSeconds },
  assistItems: careOptionMaster,
  baseFareYen: CHARTER_UNIT_FARE_YEN,
  baseMinutes: CHARTER_UNIT_MINUTES,
  discount: DEFAULT_DISCOUNT_SETTINGS,
  dispatchMenuItems: dispatchMenuMaster,
  escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  specialVehicleMenuItems: specialVehicleMenuMaster,
  waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
}

export const defaultMeterSettings: MeterSettings = {
  meterSettings: {
    gps: {
      assistItems: careOptionMaster,
      basicFare: basicFareSettings,
      discount: DEFAULT_DISCOUNT_SETTINGS,
      dispatchMenuItems: dispatchMenuMaster,
      escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
      meterTimeFare: meterTimeFareSettings,
      specialVehicleMenuItems: specialVehicleMenuMaster,
      waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
    },
    time: defaultTimeMeterModeSettings,
    obd: {
      assistItems: careOptionMaster,
      basicFare: basicFareSettings,
      discount: DEFAULT_DISCOUNT_SETTINGS,
      dispatchMenuItems: dispatchMenuMaster,
      escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
      meterTimeFare: meterTimeFareSettings,
      specialVehicleMenuItems: specialVehicleMenuMaster,
      waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
    },
  },
  basicFare: basicFareSettings,
  waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  meterTimeFare: meterTimeFareSettings,
  time: defaultTimeMeterSettings,
  assistItems: careOptionMaster,
  dispatchMenuItems: dispatchMenuMaster,
  specialVehicleMenuItems: specialVehicleMenuMaster,
  expensePresets: expenseSettings.defaultItems,
  company: {
    address: OFFICIAL_COMPANY_PROFILE.address,
    companyName: OFFICIAL_COMPANY_PROFILE.corporateName,
    corporateName: OFFICIAL_COMPANY_PROFILE.corporateName,
    tradeName: OFFICIAL_COMPANY_PROFILE.tradeName,
    email: '',
    postalCode: OFFICIAL_COMPANY_PROFILE.postalCode,
    phoneNumber: OFFICIAL_COMPANY_PROFILE.phoneNumber,
  },
  receipt: {
    issuerName: '',
    receiptDefault: '領収書',
    statementDefault: '利用明細書',
    invoiceNumber: '',
    defaultReceiptNote: '介護タクシー利用料として',
    printReceiptOperationInfo: true,
  },
  discount: DEFAULT_DISCOUNT_SETTINGS,
}


const toPositiveNumber = (value: unknown, fallback: number, minimum = 0) => {
  const numberValue = Number(value)

  if (!Number.isFinite(numberValue)) {
    return fallback
  }

  return Math.max(numberValue, minimum)
}

const toStringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const legacyAssistItemIds: Record<string, string> = {
  'basic-care': 'basicAssist',
  indoor: 'indoorAssist',
  stairs: 'stairsAssist',
  wheelchair: 'wheelchairAssist',
  stretcher: 'stretcherAssist',
  reclining: 'recliningAssist',
  'other-care': 'otherAssist',
}

const getMeterSettingsDocumentId = (scope: TenantScope = { franchiseeId: defaultFranchiseeId, storeId: defaultStoreId }) =>
  `${scope.franchiseeId}_${scope.storeId}`

function getLegacyMeterSettingsRef() {
  const db = getFirestore(getFirebaseApp())
  return doc(db, legacySettingsCollectionName, meterSettingsDocumentId)
}

function getMeterSettingsRef(scope?: TenantScope) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, settingsCollectionName, getMeterSettingsDocumentId(scope))
}

function sanitizeBasicFare(value: unknown): BasicFareSettings {
  const source = toObject(value)

  return {
    additionalDistanceKm: toPositiveNumber(
      source.additionalDistanceKm,
      defaultMeterSettings.basicFare.additionalDistanceKm,
      0.001,
    ),
    additionalFareYen: toPositiveNumber(
      source.additionalFareYen,
      defaultMeterSettings.basicFare.additionalFareYen,
    ),
    initialDistanceKm: toPositiveNumber(
      source.initialDistanceKm,
      defaultMeterSettings.basicFare.initialDistanceKm,
      0.001,
    ),
    initialFareYen: toPositiveNumber(
      source.initialFareYen,
      defaultMeterSettings.basicFare.initialFareYen,
    ),
  }
}

function sanitizeFixedTimeFare(value: unknown, fallback: TimeFareSettings): TimeFareSettings {
  const source = toObject(value)

  return {
    unitFareYen: toPositiveNumber(source.unitFareYen, fallback.unitFareYen),
    unitSeconds: fixedTimeFareUnitSeconds,
  }
}

function sanitizeMeterTimeFare(value: unknown): MeterTimeFareSettings {
  const source = toObject(value)

  return {
    lowSpeedThresholdKmh: toPositiveNumber(
      source.lowSpeedThresholdKmh,
      defaultMeterSettings.meterTimeFare.lowSpeedThresholdKmh,
      0,
    ),
    unitFareYen: toPositiveNumber(
      source.unitFareYen,
      defaultMeterSettings.meterTimeFare.unitFareYen,
    ),
    unitSeconds: Math.max(
      Math.floor(toPositiveNumber(
        source.unitSeconds,
        defaultMeterSettings.meterTimeFare.unitSeconds,
        1,
      )),
      1,
    ),
  }
}

function sanitizeAssistItems(value: unknown): CareOptionMasterItem[] {
  const source = Array.isArray(value) ? value : []
  const defaultsById = new Map(
    defaultMeterSettings.assistItems.map((defaultItem) => [
      defaultItem.id,
      defaultItem,
    ]),
  )
  const sanitizedItems = source
    .map((item, index) => {
      const sourceItem = toObject(item)
      const sourceId = toStringValue(sourceItem.id).trim()
      const id = legacyAssistItemIds[sourceId] ?? sourceId
      const defaultItem = defaultsById.get(id)
      const name = toStringValue(sourceItem.name, defaultItem?.name ?? '').trim()

      if (!id || !name) {
        return null
      }

      return {
        id,
        name,
        amount: Math.floor(
          toPositiveNumber(
            sourceItem.amount ?? sourceItem.defaultAmountYen,
            defaultItem?.amount ?? 0,
          ),
        ),
        enabled:
          typeof sourceItem.enabled === 'boolean'
            ? sourceItem.enabled
            : defaultItem?.enabled ?? true,
        sortOrder: Math.floor(
          toPositiveNumber(sourceItem.sortOrder, defaultItem?.sortOrder ?? index + 1),
        ),
      }
    })
    .filter((item): item is CareOptionMasterItem => Boolean(item))

  if (sanitizedItems.length === 0) {
    return defaultMeterSettings.assistItems
  }

  const sanitizedIds = new Set(sanitizedItems.map((item) => item.id))
  const missingDefaults = defaultMeterSettings.assistItems.filter(
    (defaultItem) => !sanitizedIds.has(defaultItem.id),
  )

  return [...sanitizedItems, ...missingDefaults]
    .filter((item) => item.id !== 'otherAssist')
    .sort(
    (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
  )
}

function sanitizeMenuItems<TMenuItem extends {
  amount: number
  enabled: boolean
  id: string
  name: string
  sortOrder: number
}>(value: unknown, fallbackItems: TMenuItem[], idPrefix: string): TMenuItem[] {
  if (!Array.isArray(value)) {
    return fallbackItems
  }

  const defaultsById = new Map(
    fallbackItems.map((defaultItem) => [defaultItem.id, defaultItem]),
  )
  const sanitizedItems = value
    .map((item, index) => {
      const sourceItem = toObject(item)
      const id = toStringValue(sourceItem.id, `${idPrefix}-${index + 1}`).trim()
      const defaultItem = defaultsById.get(id)
      const name = toStringValue(sourceItem.name, defaultItem?.name ?? '').trim()

      if (!id || !name) {
        return null
      }

      return {
        id,
        name,
        amount: Math.floor(
          toPositiveNumber(sourceItem.amount, defaultItem?.amount ?? 0),
        ),
        enabled:
          typeof sourceItem.enabled === 'boolean'
            ? sourceItem.enabled
            : defaultItem?.enabled ?? true,
        sortOrder: Math.floor(
          toPositiveNumber(sourceItem.sortOrder, defaultItem?.sortOrder ?? index + 1),
        ),
      } as TMenuItem
    })
    .filter((item): item is TMenuItem => Boolean(item))

  return sanitizedItems.sort(
    (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
  )
}

function sanitizeDispatchMenuItems(value: unknown): DispatchMenuItem[] {
  return sanitizeMenuItems(
    value,
    defaultMeterSettings.dispatchMenuItems,
    'dispatch',
  )
}

function sanitizeSpecialVehicleMenuItems(value: unknown): SpecialVehicleMenuItem[] {
  return sanitizeMenuItems(
    value,
    defaultMeterSettings.specialVehicleMenuItems,
    'special-vehicle',
  )
}

function sanitizeExpensePresets(value: unknown): ExpensePreset[] {
  const source = Array.isArray(value) ? value : defaultMeterSettings.expensePresets

  return source
    .map((item, index) => {
      const sourceItem = toObject(item)
      const name = toStringValue(sourceItem.name).trim()

      return {
        defaultAmountYen: toPositiveNumber(sourceItem.defaultAmountYen, 0),
        id: toStringValue(sourceItem.id, `expense-${index + 1}`),
        name,
      }
    })
    .filter((item) => item.name)
}

function sanitizeDiscount(value: unknown): DiscountSettings {
  const source = toObject(value)
  const method = source.method === 'fixed' ? 'fixed' : 'percentage'

  return {
    name: toStringValue(source.name, DEFAULT_DISCOUNT_SETTINGS.name).trim() || DEFAULT_DISCOUNT_SETTINGS.name,
    method,
    value: toPositiveNumber(source.value, DEFAULT_DISCOUNT_SETTINGS.value),
  }
}

function sanitizeCompany(value: unknown): CompanySettings {
  const source = toObject(value)

  const legacyCompanyName = toStringValue(source.companyName)

  return resolveReceiptCompanySettings({
    address: toStringValue(source.address),
    companyName: legacyCompanyName,
    corporateName: toStringValue(source.corporateName, legacyCompanyName),
    tradeName: toStringValue(source.tradeName, legacyCompanyName),
    email: toStringValue(source.email),
    postalCode: toStringValue(source.postalCode) || toStringValue(source.zipCode),
    phoneNumber: toStringValue(source.phoneNumber),
  })
}

function sanitizeTimeMeterLegal(value: unknown): TimeMeterLegalSettings {
  const source = toObject(value)

  return {
    additionalFareYen: toPositiveNumber(
      source.additionalFareYen,
      defaultTimeMeterLegalSettings.additionalFareYen,
    ),
    additionalMinutes: toPositiveNumber(
      source.additionalMinutes,
      defaultTimeMeterLegalSettings.additionalMinutes,
      1,
    ),
    baseFareYen: toPositiveNumber(
      source.baseFareYen,
      defaultTimeMeterLegalSettings.baseFareYen,
    ),
    baseMinutes: toPositiveNumber(
      source.baseMinutes,
      defaultTimeMeterLegalSettings.baseMinutes,
      1,
    ),
  }
}

function sanitizeTimeMeterDiscount(value: unknown): TimeMeterDiscountSettings {
  const source = toObject(value)

  return {
    additionalSeconds: Math.floor(
      toPositiveNumber(
        source.additionalSeconds,
        defaultTimeMeterDiscountSettings.additionalSeconds,
        1,
      ),
    ),
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : defaultTimeMeterDiscountSettings.enabled,
    initialMinutes: Math.floor(
      toPositiveNumber(
        source.initialMinutes,
        defaultTimeMeterDiscountSettings.initialMinutes,
        1,
      ),
    ),
  }
}

function sanitizeTimeMeter(value: unknown): TimeMeterSettings {
  const source = toObject(value)

  return {
    discount: sanitizeTimeMeterDiscount(source.discount),
    legal: sanitizeTimeMeterLegal(source.legal),
  }
}

function sanitizeReceipt(value: unknown): ReceiptSettings {
  const source = toObject(value)

  return {
    issuerName: toStringValue(source.issuerName),
    receiptDefault: toStringValue(
      source.receiptDefault,
      defaultMeterSettings.receipt.receiptDefault,
    ),
    statementDefault: toStringValue(
      source.statementDefault,
      defaultMeterSettings.receipt.statementDefault,
    ),
    invoiceNumber: toStringValue(source.invoiceNumber),
    defaultReceiptNote: toStringValue(
      source.defaultReceiptNote,
      defaultMeterSettings.receipt.defaultReceiptNote,
    ),
    printReceiptOperationInfo:
      typeof source.printReceiptOperationInfo === 'boolean'
        ? source.printReceiptOperationInfo
        : defaultMeterSettings.receipt.printReceiptOperationInfo,
  }
}

function sanitizeMeterModeFareSettings(value: unknown, fallback: MeterModeFareSettings): MeterModeFareSettings {
  const source = toObject(value)

  return {
    assistItems: sanitizeAssistItems(source.assistItems ?? fallback.assistItems),
    basicFare: sanitizeBasicFare(source.basicFare ?? fallback.basicFare),
    discount: sanitizeDiscount(source.discount ?? fallback.discount),
    dispatchMenuItems: sanitizeDispatchMenuItems(source.dispatchMenuItems ?? fallback.dispatchMenuItems),
    escortFare: sanitizeFixedTimeFare(source.escortFare, fallback.escortFare),
    meterTimeFare: sanitizeMeterTimeFare(source.meterTimeFare ?? fallback.meterTimeFare),
    specialVehicleMenuItems: sanitizeSpecialVehicleMenuItems(source.specialVehicleMenuItems ?? fallback.specialVehicleMenuItems),
    waitingFare: sanitizeFixedTimeFare(source.waitingFare, fallback.waitingFare),
  }
}

function sanitizeTimeMeterSettings(value: unknown, fallback: MeterSettingsByMode['time']): MeterSettingsByMode['time'] {
  const source = toObject(value)

  return {
    additionalFare: sanitizeFixedTimeFare(source.additionalFare, fallback.additionalFare),
    assistItems: sanitizeAssistItems(source.assistItems ?? fallback.assistItems),
    baseFareYen: toPositiveNumber(source.baseFareYen ?? source.baseFare, fallback.baseFareYen),
    baseMinutes: Math.max(Math.floor(toPositiveNumber(source.baseMinutes, fallback.baseMinutes, 1)), 1),
    discount: sanitizeDiscount(source.discount ?? fallback.discount),
    dispatchMenuItems: sanitizeDispatchMenuItems(source.dispatchMenuItems ?? fallback.dispatchMenuItems),
    escortFare: sanitizeFixedTimeFare(source.escortFare, fallback.escortFare),
    specialVehicleMenuItems: sanitizeSpecialVehicleMenuItems(source.specialVehicleMenuItems ?? fallback.specialVehicleMenuItems),
    waitingFare: sanitizeFixedTimeFare(source.waitingFare, fallback.waitingFare),
  }
}

export function selectMeterModeSettings(settings: MeterSettings, mode: MeterMode): MeterSettings {
  if (mode === 'gps' || mode === 'obd') {
    const modeSettings = settings.meterSettings[mode]
    return { ...settings, ...modeSettings }
  }

  const timeSettings = settings.meterSettings.time
  return {
    ...settings,
    assistItems: timeSettings.assistItems,
    basicFare: { initialDistanceKm: 1, initialFareYen: timeSettings.baseFareYen, additionalDistanceKm: 1, additionalFareYen: 0 },
    discount: timeSettings.discount,
    dispatchMenuItems: timeSettings.dispatchMenuItems,
    escortFare: timeSettings.escortFare,
    meterTimeFare: { lowSpeedThresholdKmh: 999, unitFareYen: timeSettings.additionalFare.unitFareYen, unitSeconds: timeSettings.additionalFare.unitSeconds },
    specialVehicleMenuItems: timeSettings.specialVehicleMenuItems,
    waitingFare: timeSettings.waitingFare,
  }
}

export function sanitizeMeterSettings(value: unknown): MeterSettings {
  const source = toObject(value)
  const legacyGps = {
    basicFare: sanitizeBasicFare(source.basicFare),
    assistItems: sanitizeAssistItems(source.assistItems ?? source.careOptions),
    discount: sanitizeDiscount(source.discount),
    dispatchMenuItems: sanitizeDispatchMenuItems(source.dispatchMenuItems),
    escortFare: sanitizeFixedTimeFare(source.escortFare, defaultMeterSettings.escortFare),
    meterTimeFare: sanitizeMeterTimeFare(source.meterTimeFare),
    specialVehicleMenuItems: sanitizeSpecialVehicleMenuItems(source.specialVehicleMenuItems),
    waitingFare: sanitizeFixedTimeFare(source.waitingFare, defaultMeterSettings.waitingFare),
  }
  const modeSource = toObject(source.meterSettings)
  const gps = sanitizeMeterModeFareSettings(modeSource.gps ?? source.gps ?? legacyGps, legacyGps)
  const obd = sanitizeMeterModeFareSettings(modeSource.obd ?? source.obd ?? gps, gps)
  const time = sanitizeTimeMeterSettings(modeSource.time ?? source.time, defaultMeterSettings.meterSettings.time)

  return {
    meterSettings: { gps, time, obd },
    basicFare: gps.basicFare,
    assistItems: gps.assistItems,
    company: sanitizeCompany(source.company),
    discount: gps.discount,
    dispatchMenuItems: gps.dispatchMenuItems,
    specialVehicleMenuItems: gps.specialVehicleMenuItems,
    escortFare: gps.escortFare,
    expensePresets: sanitizeExpensePresets(source.expensePresets),
    meterTimeFare: gps.meterTimeFare,
    receipt: sanitizeReceipt(source.receipt),
    time: sanitizeTimeMeter(source.time),
    waitingFare: sanitizeFixedTimeFare(source.waitingFare, defaultMeterSettings.waitingFare),
  }
}

const isFirestorePermissionDenied = (error: unknown) => {
  if (error instanceof FirebaseError && error.code === 'permission-denied') {
    return true
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  return /permission-denied|insufficient permissions/i.test(message)
}

async function getAuthRoleForMeterSettings(): Promise<string | null> {
  try {
    const user = getAuth(getFirebaseApp()).currentUser
    if (!user) {
      return null
    }

    const token = await user.getIdTokenResult()
    const role = token.claims.role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

const canSeedMeterSettings = (role: string | null) =>
  role === 'owner'
  || role === 'manager'
  || role === 'hq_admin'
  || role === 'franchisee_owner'
  || role === 'store_manager'
  || role === 'superAdmin'

export async function fetchMeterSettings(scope?: TenantScope) {
  const settingsRef = getMeterSettingsRef(scope)
  const targetScope = scope ?? { franchiseeId: defaultFranchiseeId, storeId: defaultStoreId }

  let snapshot
  try {
    snapshot = await getDoc(settingsRef)
  } catch (error) {
    if (isFirestorePermissionDenied(error)) {
      return defaultMeterSettings
    }
    throw error
  }

  if (snapshot.exists()) {
    return sanitizeMeterSettings(snapshot.data())
  }

  const role = await getAuthRoleForMeterSettings()
  if (!canSeedMeterSettings(role)) {
    return defaultMeterSettings
  }

  const isDefaultScope =
    targetScope.franchiseeId === defaultFranchiseeId && targetScope.storeId === defaultStoreId

  if (isDefaultScope) {
    try {
      const legacySnapshot = await getDoc(getLegacyMeterSettingsRef())
      if (legacySnapshot.exists()) {
        const migratedSettings = sanitizeMeterSettings(legacySnapshot.data())
        await saveMeterSettings(migratedSettings, targetScope)
        return migratedSettings
      }
    } catch (error) {
      if (isFirestorePermissionDenied(error)) {
        return defaultMeterSettings
      }
      throw error
    }
  }

  try {
    await saveMeterSettings(defaultMeterSettings, targetScope)
  } catch (error) {
    if (isFirestorePermissionDenied(error)) {
      return defaultMeterSettings
    }
    throw error
  }

  return defaultMeterSettings
}

export function subscribeMeterSettings(
  scopeOrOnUpdate: TenantScope | ((settings: MeterSettings) => void),
  onUpdateOrOnError?: ((settings: MeterSettings) => void) | ((error: Error) => void),
  onError?: (error: Error) => void,
) {
  const scope = typeof scopeOrOnUpdate === 'function' ? undefined : scopeOrOnUpdate
  const onUpdate = typeof scopeOrOnUpdate === 'function' ? scopeOrOnUpdate : onUpdateOrOnError as (settings: MeterSettings) => void
  const errorHandler = typeof scopeOrOnUpdate === 'function' ? onUpdateOrOnError as ((error: Error) => void) | undefined : onError
  return onSnapshot(
    getMeterSettingsRef(scope),
    (snapshot) => {
      onUpdate(snapshot.exists() ? sanitizeMeterSettings(snapshot.data()) : defaultMeterSettings)
    },
    (error) => {
      if (isFirestorePermissionDenied(error)) {
        onUpdate(defaultMeterSettings)
        return
      }

      errorHandler?.(error)
    },
  )
}

export function subscribeLegacyMeterSettings(
  onUpdate: (settings: MeterSettings) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    getMeterSettingsRef(),
    (snapshot) => {
      onUpdate(snapshot.exists() ? sanitizeMeterSettings(snapshot.data()) : defaultMeterSettings)
    },
    (error) => {
      onError?.(error)
    },
  )
}

export async function saveMeterSettings(settings: MeterSettings, scope: TenantScope = { franchiseeId: defaultFranchiseeId, storeId: defaultStoreId }) {
  const settingsRef = getMeterSettingsRef(scope)
  const beforeSnapshot = await getDoc(settingsRef)
  const settingsWithCurrentGps = {
    ...settings,
    meterSettings: {
      ...settings.meterSettings,
      gps: {
        ...settings.meterSettings.gps,
        assistItems: settings.assistItems,
        basicFare: settings.basicFare,
        discount: settings.discount,
        dispatchMenuItems: settings.dispatchMenuItems,
        escortFare: settings.escortFare,
        meterTimeFare: settings.meterTimeFare,
        specialVehicleMenuItems: settings.specialVehicleMenuItems,
        waitingFare: settings.waitingFare,
      },
    },
  }
  const sanitizedSettings = sanitizeMeterSettings(settingsWithCurrentGps)
  const document: MeterSettingsDocument = {
    ...sanitizedSettings,
    ...tenantFields(scope),
    updatedAt: serverTimestamp(),
  }

  await setDoc(settingsRef, document, { merge: true })
  await createAuditLog({
    action: beforeSnapshot.exists() ? 'settings.updated' : 'settings.created',
    targetType: 'meterSettings',
    targetId: getMeterSettingsDocumentId(scope),
    franchiseeId: scope.franchiseeId,
    storeId: scope.storeId,
    before: beforeSnapshot.exists() ? sanitizeMeterSettings(beforeSnapshot.data()) : null,
    after: sanitizedSettings,
    reason: '店舗別メーター・帳票・会社設定の保存',
  })
  return sanitizedSettings
}
