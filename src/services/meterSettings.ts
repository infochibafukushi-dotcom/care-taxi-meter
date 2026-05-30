import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FieldValue } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import {
  basicFareSettings,
  careOptionMaster,
  escortFareSettings,
  expenseSettings,
  waitingFareSettings,
} from './fare'
import type {
  BasicFareSettings,
  CareOptionMasterItem,
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
}

export type MeterSettings = {
  basicFare: BasicFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  careOptions: CareOptionMasterItem[]
  expensePresets: ExpensePreset[]
  company: CompanySettings
  receipt: ReceiptSettings
}

export type MeterSettingsDocument = MeterSettings & {
  updatedAt: FieldValue
}

const settingsCollectionName = 'appSettings'
const meterSettingsDocumentId = 'meterSettings'
export const fixedTimeFareUnitSeconds = 30 * 60

export const defaultMeterSettings: MeterSettings = {
  basicFare: basicFareSettings,
  waitingFare: { ...waitingFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  escortFare: { ...escortFareSettings, unitSeconds: fixedTimeFareUnitSeconds },
  careOptions: careOptionMaster,
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

function getMeterSettingsRef() {
  const db = getFirestore(getFirebaseApp())
  return doc(db, settingsCollectionName, meterSettingsDocumentId)
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

function sanitizeTimeFare(value: unknown, fallback: TimeFareSettings): TimeFareSettings {
  const source = toObject(value)

  return {
    unitFareYen: toPositiveNumber(source.unitFareYen, fallback.unitFareYen),
    unitSeconds: fixedTimeFareUnitSeconds,
  }
}

function sanitizeCareOptions(value: unknown): CareOptionMasterItem[] {
  const source = Array.isArray(value) ? value : []

  return defaultMeterSettings.careOptions.map((defaultOption) => {
    const savedOption = source.find(
      (item) => toObject(item).id === defaultOption.id,
    )
    const savedOptionObject = toObject(savedOption)

    return {
      ...defaultOption,
      defaultAmountYen: toPositiveNumber(
        savedOptionObject.defaultAmountYen,
        defaultOption.defaultAmountYen,
      ),
    }
  })
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
  }
}

export function sanitizeMeterSettings(value: unknown): MeterSettings {
  const source = toObject(value)

  return {
    basicFare: sanitizeBasicFare(source.basicFare),
    careOptions: sanitizeCareOptions(source.careOptions),
    company: sanitizeCompany(source.company),
    escortFare: sanitizeTimeFare(source.escortFare, defaultMeterSettings.escortFare),
    expensePresets: sanitizeExpensePresets(source.expensePresets),
    receipt: sanitizeReceipt(source.receipt),
    waitingFare: sanitizeTimeFare(source.waitingFare, defaultMeterSettings.waitingFare),
  }
}

export async function fetchMeterSettings() {
  const snapshot = await getDoc(getMeterSettingsRef())

  if (!snapshot.exists()) {
    return defaultMeterSettings
  }

  return sanitizeMeterSettings(snapshot.data())
}

export async function saveMeterSettings(settings: MeterSettings) {
  const sanitizedSettings = sanitizeMeterSettings(settings)
  const document: MeterSettingsDocument = {
    ...sanitizedSettings,
    updatedAt: serverTimestamp(),
  }

  await setDoc(getMeterSettingsRef(), document, { merge: true })
  return sanitizedSettings
}
