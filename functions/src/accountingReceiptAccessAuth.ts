export type AccountingReceiptAccessRole =
  | 'hq_admin'
  | 'superAdmin'
  | 'owner'
  | 'franchisee_owner'
  | 'manager'
  | 'store_manager'
  | 'driver'
  | string

export type AccountingReceiptAccessVariant = 'preview' | 'original'

export type AccountingReceiptAccessAuth = {
  uid: string
  role: AccountingReceiptAccessRole
  franchiseeId: string
  storeId: string
}

export type AccountingReceiptAccessRecord = {
  id: string
  franchiseeId: string
  companyId: string
  storeId: string
  storagePath?: string
  originalStoragePath?: string
  ocrImageStoragePath?: string
  downloadUrl?: string
  imageUrl?: string
  originalDownloadUrl?: string
  ocrImageDownloadUrl?: string
  documentType?: string
  mimeType?: string
  originalMimeType?: string
}

export const ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS = 7 * 60 * 1000

export const ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE = 'この証憑へのアクセス権限がありません。'
export const ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE = '認証が必要です。'
export const ACCOUNTING_RECEIPT_NOT_FOUND_MESSAGE = '証憑が見つかりません。'
export const ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE = '証憑ファイルの保存先がありません。'

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const normalizeAccountingReceiptAccessRole = (
  value: unknown,
): AccountingReceiptAccessRole => {
  const role = toStringValue(value)
  if (role === 'superAdmin' || role === 'hq_admin') return 'hq_admin'
  if (role === 'franchisee_owner' || role === 'owner') return 'owner'
  if (role === 'store_manager' || role === 'manager') return 'manager'
  if (role === 'driver') return 'driver'
  return role
}

export const isHqAccountingReceiptAccessRole = (role: AccountingReceiptAccessRole) =>
  role === 'hq_admin' || role === 'superAdmin'

export const isOwnerAccountingReceiptAccessRole = (role: AccountingReceiptAccessRole) =>
  role === 'owner' || role === 'franchisee_owner'

export const isManagerAccountingReceiptAccessRole = (role: AccountingReceiptAccessRole) =>
  role === 'manager' || role === 'store_manager'

export const canRoleRequestAccountingReceiptAccess = (role: AccountingReceiptAccessRole) =>
  isHqAccountingReceiptAccessRole(role) ||
  isOwnerAccountingReceiptAccessRole(role) ||
  isManagerAccountingReceiptAccessRole(role)

export const resolveReceiptTenantIds = (receipt: AccountingReceiptAccessRecord) => ({
  franchiseeId: toStringValue(receipt.franchiseeId) || toStringValue(receipt.companyId),
  storeId: toStringValue(receipt.storeId),
})

/**
 * 認証・ロール・加盟店／店舗の一致を確認する。
 * 他社・他店舗・未認証・driver は拒否。
 */
export function assertCanAccessAccountingReceipt(
  auth: AccountingReceiptAccessAuth | null | undefined,
  receipt: AccountingReceiptAccessRecord,
): void {
  if (!auth?.uid) {
    throw new Error(ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE)
  }

  const role = normalizeAccountingReceiptAccessRole(auth.role)
  if (!canRoleRequestAccountingReceiptAccess(role)) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }

  if (isHqAccountingReceiptAccessRole(role)) {
    return
  }

  const { franchiseeId: receiptFranchiseeId, storeId: receiptStoreId } = resolveReceiptTenantIds(receipt)
  const tokenFranchiseeId = toStringValue(auth.franchiseeId)
  const tokenStoreId = toStringValue(auth.storeId)

  if (!tokenFranchiseeId || !receiptFranchiseeId || tokenFranchiseeId !== receiptFranchiseeId) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }

  if (isOwnerAccountingReceiptAccessRole(role)) {
    return
  }

  if (!tokenStoreId || !receiptStoreId || tokenStoreId !== receiptStoreId) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }
}

const isPdfReceipt = (receipt: AccountingReceiptAccessRecord) => {
  const documentType = toStringValue(receipt.documentType).toLowerCase()
  const mime = toStringValue(receipt.mimeType).toLowerCase()
  const originalMime = toStringValue(receipt.originalMimeType).toLowerCase()
  return (
    documentType === 'pdf' ||
    mime === 'application/pdf' ||
    originalMime === 'application/pdf'
  )
}

export function resolveAccountingReceiptStoragePathForVariant(
  receipt: AccountingReceiptAccessRecord,
  variant: AccountingReceiptAccessVariant,
): string {
  if (variant === 'original') {
    return (
      toStringValue(receipt.originalStoragePath) ||
      toStringValue(receipt.storagePath) ||
      ''
    )
  }

  const ocrPath = toStringValue(receipt.ocrImageStoragePath)
  if (ocrPath) {
    return ocrPath
  }

  if (isPdfReceipt(receipt)) {
    return ''
  }

  return toStringValue(receipt.storagePath) || toStringValue(receipt.originalStoragePath) || ''
}

/**
 * Storage パスが当該証憑のテナント／receiptId 配下であることを確認する。
 * パストラバーサルや他社オブジェクト指定を拒否する。
 */
export function assertAccountingReceiptStoragePathBelongsToReceipt(
  storagePath: string,
  receipt: AccountingReceiptAccessRecord,
): void {
  const normalizedPath = toStringValue(storagePath).replace(/^\/+/, '')
  if (!normalizedPath) {
    throw new Error(ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE)
  }

  if (normalizedPath.includes('..') || normalizedPath.includes('\\')) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }

  const { franchiseeId, storeId } = resolveReceiptTenantIds(receipt)
  const receiptId = toStringValue(receipt.id)
  if (!franchiseeId || !storeId || !receiptId) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }

  const expectedPrefix = `accounting/${franchiseeId}/${storeId}/receipts/${receiptId}/`
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  }
}

export function buildAccountingReceiptAccessLogFields(input: {
  receiptId: string
  variant: AccountingReceiptAccessVariant
  uid: string
  role: string
  franchiseeId: string
  storeId: string
  expiresAt: string
  /** 渡されてもログに出さないための受け皿（意図的に無視） */
  url?: string
  token?: string
}) {
  return {
    receiptId: input.receiptId,
    variant: input.variant,
    uid: input.uid,
    role: input.role,
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    expiresAt: input.expiresAt,
  }
}
