import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE,
  ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS,
  ACCOUNTING_RECEIPT_NOT_FOUND_MESSAGE,
  ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE,
  ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE,
  assertAccountingReceiptStoragePathBelongsToReceipt,
  assertCanAccessAccountingReceipt,
  buildAccountingReceiptAccessLogFields,
  normalizeAccountingReceiptAccessRole,
  resolveAccountingReceiptStoragePathForVariant,
  type AccountingReceiptAccessAuth,
  type AccountingReceiptAccessRecord,
  type AccountingReceiptAccessVariant,
} from './accountingReceiptAccessAuth'

type GetAccountingReceiptAccessUrlRequest = {
  receiptId?: string
  variant?: AccountingReceiptAccessVariant
}

type GetAccountingReceiptAccessUrlResponse = {
  url: string
  expiresAt: string
  variant: AccountingReceiptAccessVariant
  receiptId: string
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const toHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) {
    return error
  }

  const message = error instanceof Error ? error.message : ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE
  if (message === ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE) {
    return new HttpsError('unauthenticated', message)
  }
  if (message === ACCOUNTING_RECEIPT_NOT_FOUND_MESSAGE) {
    return new HttpsError('not-found', message)
  }
  if (message === ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE) {
    return new HttpsError('failed-precondition', message)
  }
  if (message === ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE) {
    return new HttpsError('permission-denied', message)
  }
  return new HttpsError('internal', '証憑URLの発行に失敗しました。')
}

const readAuthContext = (request: {
  auth?: { uid: string; token: Record<string, unknown> } | null
}): AccountingReceiptAccessAuth => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE)
  }

  return {
    uid: request.auth.uid,
    role: normalizeAccountingReceiptAccessRole(request.auth.token.role),
    franchiseeId: toStringValue(
      request.auth.token.franchiseeId ?? request.auth.token.companyId,
    ),
    storeId: toStringValue(request.auth.token.storeId),
  }
}

const toReceiptRecord = (
  id: string,
  data: Record<string, unknown>,
): AccountingReceiptAccessRecord => ({
  id,
  franchiseeId: toStringValue(data.franchiseeId),
  companyId: toStringValue(data.companyId),
  storeId: toStringValue(data.storeId),
  storagePath: toStringValue(data.storagePath),
  originalStoragePath: toStringValue(data.originalStoragePath),
  ocrImageStoragePath: toStringValue(data.ocrImageStoragePath),
  downloadUrl: toStringValue(data.downloadUrl),
  imageUrl: toStringValue(data.imageUrl),
  originalDownloadUrl: toStringValue(data.originalDownloadUrl),
  ocrImageDownloadUrl: toStringValue(data.ocrImageDownloadUrl),
  documentType: toStringValue(data.documentType),
  mimeType: toStringValue(data.mimeType),
  originalMimeType: toStringValue(data.originalMimeType),
})

const parseVariant = (value: unknown): AccountingReceiptAccessVariant => {
  if (value === 'original') {
    return 'original'
  }
  return 'preview'
}

async function issueSignedReadUrl(storagePath: string, expiresAtMs: number): Promise<string> {
  const bucket = getStorage().bucket()
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', ACCOUNTING_RECEIPT_NOT_FOUND_MESSAGE)
  }

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAtMs,
  })
  return url
}

export const getAccountingReceiptAccessUrl = onCall(
  {
    region: 'asia-northeast1',
  },
  async (request): Promise<GetAccountingReceiptAccessUrlResponse> => {
    try {
      const auth = readAuthContext(request)
      const data = (request.data ?? {}) as GetAccountingReceiptAccessUrlRequest
      const receiptId = toStringValue(data.receiptId)
      const variant = parseVariant(data.variant)

      if (!receiptId) {
        throw new HttpsError('invalid-argument', 'receiptId は必須です。')
      }

      const snapshot = await getFirestore().collection('accountingReceipts').doc(receiptId).get()
      if (!snapshot.exists) {
        throw new HttpsError('not-found', ACCOUNTING_RECEIPT_NOT_FOUND_MESSAGE)
      }

      const receipt = toReceiptRecord(snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>)
      assertCanAccessAccountingReceipt(auth, receipt)

      const storagePath = resolveAccountingReceiptStoragePathForVariant(receipt, variant)
      if (!storagePath) {
        throw new HttpsError('failed-precondition', ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE)
      }
      assertAccountingReceiptStoragePathBelongsToReceipt(storagePath, receipt)

      const expiresAtMs = Date.now() + ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS
      const expiresAt = new Date(expiresAtMs).toISOString()
      const url = await issueSignedReadUrl(storagePath, expiresAtMs)

      logger.info(
        'Issued accounting receipt access url',
        buildAccountingReceiptAccessLogFields({
          receiptId,
          variant,
          uid: auth.uid,
          role: String(auth.role),
          franchiseeId: auth.franchiseeId,
          storeId: auth.storeId,
          expiresAt,
          url,
          token: url,
        }),
      )

      return {
        url,
        expiresAt,
        variant,
        receiptId,
      }
    } catch (error) {
      throw toHttpsError(error)
    }
  },
)
