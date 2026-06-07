import { doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FieldValue } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { defaultFranchiseeId, defaultStoreId, tenantFields } from './tenancy'
import type { TenantScope } from './tenancy'
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
} from './fare'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  DispatchMenuItem,
  MeterTimeFareSettings,
  SpecialVehicleMenuItem,
  TimeFareSettings,
} from './fare'

export type ExpensePreset = {
  id: string
  name: string
  defaultAmountYen: number
}

export type CompanySettings = {
  companyName: string
  phoneNumber: string
  email: string
  address: string
}

export type ReceiptSettings = {
  issuerName: string
  receiptDefault: string
  statementDefault: string
  invoiceNumber: string
  defaultReceiptNote: string
}

export type MeterSettings = {
  basicFare: BasicFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  meterTimeFare: MeterTimeFareSettings
  assistItems: CareOptionMasterItem[]
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  expensePresets: ExpensePreset[]
  company: CompanySettings
  receipt: ReceiptSettings
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

export const defaultMeterSettings: MeterSettings = {
  basicFare: basicFareSettings,
  waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  meterTimeFare: meterTimeFareSettings,
  assistItems: careOptionMaster,
  dispatchMenuItems: dispatchMenuMaster,
  specialVehicleMenuItems: specialVehicleMenuMaster,
  expensePresets: expenseSettings.defaultItems,
  company: {
    address: '',
    companyName: '',
    email: '',
    phoneNumber: '',
  },
  receipt: {
    issuerName: '',
    receiptDefault: '領収書',
    statementDefault: '利用明細書',
    invoiceNumber: '',
    defaultReceiptNote: '介護タクシー利用料として',
  },
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

  return [...sanitizedItems, ...missingDefaults].sort(
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

function sanitizeCompany(value: unknown): CompanySettings {
  const source = toObject(value)

  return {
    address: toStringValue(source.address),
    companyName: toStringValue(source.companyName),
    email: toStringValue(source.email),
    phoneNumber: toStringValue(source.phoneNumber),
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
  }
}

export function sanitizeMeterSettings(value: unknown): MeterSettings {
  const source = toObject(value)

  return {
    basicFare: sanitizeBasicFare(source.basicFare),
    assistItems: sanitizeAssistItems(source.assistItems ?? source.careOptions),
    company: sanitizeCompany(source.company),
    dispatchMenuItems: sanitizeDispatchMenuItems(source.dispatchMenuItems),
    specialVehicleMenuItems: sanitizeSpecialVehicleMenuItems(source.specialVehicleMenuItems),
    escortFare: sanitizeFixedTimeFare(source.escortFare, defaultMeterSettings.escortFare),
    expensePresets: sanitizeExpensePresets(source.expensePresets),
    meterTimeFare: sanitizeMeterTimeFare(source.meterTimeFare),
    receipt: sanitizeReceipt(source.receipt),
    waitingFare: sanitizeFixedTimeFare(source.waitingFare, defaultMeterSettings.waitingFare),
  }
}

export async function fetchMeterSettings(scope?: TenantScope) {
  const settingsRef = getMeterSettingsRef(scope)
  const snapshot = await getDoc(settingsRef)

  if (snapshot.exists()) {
    return sanitizeMeterSettings(snapshot.data())
  }

  const legacySnapshot = await getDoc(getLegacyMeterSettingsRef())
  if (legacySnapshot.exists()) {
    const migratedSettings = sanitizeMeterSettings(legacySnapshot.data())
    await saveMeterSettings(migratedSettings, scope)
    return migratedSettings
  }

  await saveMeterSettings(defaultMeterSettings, scope)
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
  const sanitizedSettings = sanitizeMeterSettings(settings)
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
