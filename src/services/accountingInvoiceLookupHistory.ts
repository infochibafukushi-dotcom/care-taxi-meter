import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { InvoiceRegistrantLookupResult } from '../types/invoiceRegistrant'
import type { StaffRole } from '../types/work'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAuditLog, type AuditActor } from './auditLogs'
import { createAccountingTenantConstraints } from './accountingTenant'
import { matchesTenantScope, normalizeTenantRole, type TenantAccessScope } from './tenancy'

export const ACCOUNTING_INVOICE_LOOKUP_ACTION = 'accounting.invoice_lookup'
export const ACCOUNTING_INVOICE_LOOKUP_TARGET_TYPE = 'invoice_registration_number'

export const INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE =
  'インボイス検索履歴を保存できませんでした。再ログイン後に再検索してください。'

export type InvoiceLookupHistoryOrigin = 'manual' | 'ocr'

export type InvoiceLookupHistoryOutcome = 'success' | 'not_found' | 'error' | 'skipped'

export type InvoiceLookupHistoryLookupSource =
  | 'nta-invoice-api'
  | 'cache'
  | 'fallback'
  | 'none'

export type InvoiceLookupAuditContext = {
  actor: AuditActor
  franchiseeId: string
  storeId: string
  origin: InvoiceLookupHistoryOrigin
  expenseId?: string
  receiptId?: string
  onHistoryPersistFailure?: () => void
}

export type AccountingInvoiceLookupHistoryAfterData = {
  schemaVersion: 1
  origin: InvoiceLookupHistoryOrigin
  outcome: InvoiceLookupHistoryOutcome
  apiCalled: boolean
  lookupSource: InvoiceLookupHistoryLookupSource
  usedFallback: boolean
  invoiceNumber: string
  registeredName?: string
  registrationStatus?: string
  lookupMethod?: string
  requestedAt: string
  completedAt: string
  durationMs: number
  expenseId?: string
  receiptId?: string
  errorCode?: string
  errorMessage?: string
}

export type StoredAccountingInvoiceLookupHistory = {
  id: string
  franchiseeId: string
  storeId: string
  actionType: string
  targetId: string
  actorUserId: string
  actorUserName: string
  actorRole: StaffRole | ''
  createdAt?: string
  afterData: AccountingInvoiceLookupHistoryAfterData | null
}

const SENSITIVE_PATTERN =
  /NTA_INVOICE_API_ID|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|https?:\/\/[^\s]+|localStorage|cloudflare|stack|trace/gi

const MAX_ERROR_MESSAGE_LENGTH = 200

/** 履歴保存用。正規化済み T+13 桁のみ残し、不正入力の生値は保存しない。 */
export const normalizeInvoiceNumberForHistory = (value: string): string => {
  const half = value
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^0-9T]/g, '')

  if (/^T\d{13}$/.test(half)) {
    return half
  }

  if (/^\d{13}$/.test(half)) {
    return `T${half}`
  }

  return ''
}

export const sanitizeInvoiceLookupErrorMessage = (value: unknown): string => {
  const raw = value instanceof Error ? value.message : String(value ?? '')
  const scrubbed = raw
    .replace(SENSITIVE_PATTERN, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()

  if (!scrubbed) {
    return 'lookup_failed'
  }

  return scrubbed.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${scrubbed.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
    : scrubbed
}

export const sanitizeInvoiceLookupErrorCode = (value: unknown): string => {
  if (!value) {
    return 'lookup_error'
  }

  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.name || 'Error'
        : String(value)

  const scrubbed = raw
    .replace(SENSITIVE_PATTERN, '[redacted]')
    .replace(/[^A-Za-z0-9._:/-]/g, '_')
    .slice(0, 64)

  return scrubbed || 'lookup_error'
}

const isNotFoundMessage = (message?: string) =>
  Boolean(message && /登録情報が見つかりません|not[_\s-]?found/i.test(message))

export const resolveInvoiceLookupHistoryMeta = (
  result: InvoiceRegistrantLookupResult,
): {
  outcome: InvoiceLookupHistoryOutcome
  apiCalled: boolean
  lookupSource: InvoiceLookupHistoryLookupSource
  usedFallback: boolean
  invoiceNumber: string
  registeredName?: string
  registrationStatus?: string
  lookupMethod?: string
  errorCode?: string
  errorMessage?: string
} => {
  if (result.status === 'skipped') {
    return {
      outcome: 'skipped',
      apiCalled: false,
      lookupSource: 'none',
      usedFallback: false,
      invoiceNumber: normalizeInvoiceNumberForHistory(result.invoiceNumber ?? ''),
      errorCode: 'invalid_invoice_number',
      errorMessage: sanitizeInvoiceLookupErrorMessage(result.message),
    }
  }

  if (result.status === 'success') {
    const source = result.registrant.source
    const usedFallback = Boolean(result.usedFallback || source === 'fallback')
    const lookupSource: InvoiceLookupHistoryLookupSource =
      source === 'cache' ? 'cache' : usedFallback ? 'fallback' : 'nta-invoice-api'

    return {
      outcome: 'success',
      apiCalled: lookupSource !== 'cache',
      lookupSource,
      usedFallback,
      invoiceNumber: result.registrant.invoiceNumber,
      registeredName: result.registrant.registeredName || undefined,
      registrationStatus: result.registrant.registrationStatus || undefined,
      lookupMethod: result.registrant.lookupMethod || undefined,
    }
  }

  if (result.status === 'not_found' || isNotFoundMessage(result.message)) {
    return {
      outcome: 'not_found',
      apiCalled: true,
      lookupSource: 'nta-invoice-api',
      usedFallback: false,
      invoiceNumber: normalizeInvoiceNumberForHistory(
        'invoiceNumber' in result ? (result.invoiceNumber ?? '') : '',
      ),
      errorCode: 'not_found',
      errorMessage: sanitizeInvoiceLookupErrorMessage(result.message),
    }
  }

  return {
    outcome: 'error',
    apiCalled: true,
    lookupSource: 'nta-invoice-api',
    usedFallback: false,
    invoiceNumber: normalizeInvoiceNumberForHistory(result.invoiceNumber ?? ''),
    errorCode: sanitizeInvoiceLookupErrorCode('api_error'),
    errorMessage: sanitizeInvoiceLookupErrorMessage(result.message),
  }
}

export const buildInvoiceLookupHistoryAfterData = ({
  result,
  origin,
  requestedAt,
  completedAt,
  expenseId,
  receiptId,
}: {
  result: InvoiceRegistrantLookupResult
  origin: InvoiceLookupHistoryOrigin
  requestedAt: string
  completedAt: string
  expenseId?: string
  receiptId?: string
}): AccountingInvoiceLookupHistoryAfterData => {
  const meta = resolveInvoiceLookupHistoryMeta(result)
  const durationMs = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(requestedAt).getTime(),
  )

  const afterData: AccountingInvoiceLookupHistoryAfterData = {
    schemaVersion: 1,
    origin,
    outcome: meta.outcome,
    apiCalled: meta.apiCalled,
    lookupSource: meta.lookupSource,
    usedFallback: meta.usedFallback,
    invoiceNumber: meta.invoiceNumber,
    requestedAt,
    completedAt,
    durationMs,
  }

  if (meta.registeredName) {
    afterData.registeredName = meta.registeredName
  }
  if (meta.registrationStatus) {
    afterData.registrationStatus = meta.registrationStatus
  }
  if (meta.lookupMethod) {
    afterData.lookupMethod = meta.lookupMethod
  }
  if (expenseId?.trim()) {
    afterData.expenseId = expenseId.trim()
  }
  if (receiptId?.trim()) {
    afterData.receiptId = receiptId.trim()
  }
  if (meta.errorCode) {
    afterData.errorCode = meta.errorCode
  }
  if (meta.errorMessage) {
    afterData.errorMessage = meta.errorMessage
  }

  return afterData
}

const toIsoCreatedAt = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value) {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

export const mapFirestoreDocToInvoiceLookupHistory = (
  id: string,
  data: Record<string, unknown>,
): StoredAccountingInvoiceLookupHistory | null => {
  const actionType = String(data.actionType ?? data.action ?? '')
  if (actionType !== ACCOUNTING_INVOICE_LOOKUP_ACTION) {
    return null
  }

  const rawAfter =
    data.afterData && typeof data.afterData === 'object'
      ? (data.afterData as Record<string, unknown>)
      : data.after && typeof data.after === 'object'
        ? (data.after as Record<string, unknown>)
        : null

  let afterData: AccountingInvoiceLookupHistoryAfterData | null = null
  if (rawAfter) {
    const origin = rawAfter.origin === 'ocr' ? 'ocr' : 'manual'
    const outcome =
      rawAfter.outcome === 'success' ||
      rawAfter.outcome === 'not_found' ||
      rawAfter.outcome === 'error' ||
      rawAfter.outcome === 'skipped'
        ? rawAfter.outcome
        : 'error'
    const lookupSource =
      rawAfter.lookupSource === 'nta-invoice-api' ||
      rawAfter.lookupSource === 'cache' ||
      rawAfter.lookupSource === 'fallback' ||
      rawAfter.lookupSource === 'none'
        ? rawAfter.lookupSource
        : 'none'

    afterData = {
      schemaVersion: 1,
      origin,
      outcome,
      apiCalled: Boolean(rawAfter.apiCalled),
      lookupSource,
      usedFallback: Boolean(rawAfter.usedFallback),
      invoiceNumber: asOptionalString(rawAfter.invoiceNumber) ?? '',
      requestedAt: asOptionalString(rawAfter.requestedAt) ?? '',
      completedAt: asOptionalString(rawAfter.completedAt) ?? '',
      durationMs: Number(rawAfter.durationMs ?? 0) || 0,
    }

    const registeredName = asOptionalString(rawAfter.registeredName)
    if (registeredName) afterData.registeredName = registeredName
    const registrationStatus = asOptionalString(rawAfter.registrationStatus)
    if (registrationStatus) afterData.registrationStatus = registrationStatus
    const lookupMethod = asOptionalString(rawAfter.lookupMethod)
    if (lookupMethod) afterData.lookupMethod = lookupMethod
    const expenseId = asOptionalString(rawAfter.expenseId)
    if (expenseId) afterData.expenseId = expenseId
    const receiptId = asOptionalString(rawAfter.receiptId)
    if (receiptId) afterData.receiptId = receiptId
    const errorCode = asOptionalString(rawAfter.errorCode)
    if (errorCode) afterData.errorCode = errorCode
    const errorMessage = asOptionalString(rawAfter.errorMessage)
    if (errorMessage) {
      afterData.errorMessage = sanitizeInvoiceLookupErrorMessage(errorMessage)
    }
  }

  return {
    id,
    franchiseeId: String(data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    actionType,
    targetId: String(data.targetId ?? ''),
    actorUserId: String(data.userId ?? data.changedBy ?? ''),
    actorUserName: String(data.userName ?? data.changedByName ?? ''),
    actorRole: normalizeTenantRole(String(data.role ?? data.changedByRole ?? '')),
    createdAt: toIsoCreatedAt(data.createdAt),
    afterData,
  }
}

export async function recordAccountingInvoiceLookupHistory({
  auditContext,
  result,
  requestedAt,
  completedAt,
}: {
  auditContext: InvoiceLookupAuditContext
  result: InvoiceRegistrantLookupResult
  requestedAt: string
  completedAt: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (isReviewDemoRuntimeEnabled()) {
    return { ok: true }
  }

  const afterData = buildInvoiceLookupHistoryAfterData({
    result,
    origin: auditContext.origin,
    requestedAt,
    completedAt,
    expenseId: auditContext.expenseId,
    receiptId: auditContext.receiptId,
  })

  try {
    await createAuditLog({
      action: ACCOUNTING_INVOICE_LOOKUP_ACTION,
      targetType: ACCOUNTING_INVOICE_LOOKUP_TARGET_TYPE,
      targetId: afterData.invoiceNumber,
      actor: auditContext.actor,
      franchiseeId: auditContext.franchiseeId,
      storeId: auditContext.storeId,
      before: null,
      after: afterData,
    })
    return { ok: true }
  } catch (error) {
    console.warn('[accounting] invoice lookup history save failed', {
      outcome: afterData.outcome,
      lookupSource: afterData.lookupSource,
      apiCalled: afterData.apiCalled,
      origin: afterData.origin,
      errorCode:
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : 'unknown',
    })
    return { ok: false, message: INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE }
  }
}

export async function fetchAccountingInvoiceLookupHistory(
  accessScope?: TenantAccessScope,
  maximumCount = 100,
): Promise<StoredAccountingInvoiceLookupHistory[]> {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  const capped = Math.min(Math.max(1, maximumCount), 100)
  const tenantConstraints = createAccountingTenantConstraints(accessScope)
  const constraints: QueryConstraint[] = [
    where('actionType', '==', ACCOUNTING_INVOICE_LOOKUP_ACTION),
    ...tenantConstraints,
    orderBy('createdAt', 'desc'),
    limit(capped),
  ]

  const snapshots = await getDocs(query(collection(db, 'auditLogs'), ...constraints))

  return snapshots.docs
    .map((snapshot) =>
      mapFirestoreDocToInvoiceLookupHistory(snapshot.id, snapshot.data() as Record<string, unknown>),
    )
    .filter((row): row is StoredAccountingInvoiceLookupHistory => Boolean(row))
    .filter((row) => matchesTenantScope(row, accessScope))
}
