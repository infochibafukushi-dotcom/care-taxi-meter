import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { deleteObject, getBytes, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingReceiptCandidateFields,
  AccountingReceiptInput,
  ReceiptStatus,
  StoredAccountingReceipt,
} from '../types/accounting'
import { normalizeReceiptStatus } from '../types/accounting'
import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import {
  createAccountingTenantConstraints,
  logAccountingQueryFailure,
  resolveAccountingTenantFields,
} from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingReceipts'

export const OCR_IMAGE_UNAVAILABLE_MESSAGE =
  'OCRに使用できる画像URLがありません。もう一度撮影してください。'

const guessMimeTypeFromPath = (storagePath: string) => {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith('.png')) {
    return 'image/png'
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
    return 'image/heic'
  }

  return 'image/jpeg'
}

const isStorageObjectNotFound = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: string }).code) === 'storage/object-not-found'
  }

  return false
}

const isPermissionDenied = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: string }).code)
    return code === 'permission-denied' || code === 'storage/unauthorized'
  }

  return false
}

export type DeleteAccountingReceiptResult = {
  storageImageWasMissing?: boolean
}

const removeUndefinedFields = <T extends Record<string, unknown>>(data: T) =>
  Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T

const readTimestampAsIso = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }

  return undefined
}

const toStoredReceipt = (snapshot: { id: string; data: () => Record<string, unknown> }): StoredAccountingReceipt => {
  const data = snapshot.data()
  const linkedExpenseId = typeof data.linkedExpenseId === 'string' ? data.linkedExpenseId : ''

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    storagePath: String(data.storagePath ?? ''),
    downloadUrl: String(data.downloadUrl ?? ''),
    mimeType: String(data.mimeType ?? data.contentType ?? ''),
    fileName: String(data.fileName ?? ''),
    fileSizeBytes: Number(data.fileSizeBytes ?? data.size ?? 0),
    status: normalizeReceiptStatus(data.status, linkedExpenseId || undefined),
    linkedExpenseId: linkedExpenseId || undefined,
    memo: typeof data.memo === 'string' ? data.memo : '',
    receiptDate: typeof data.receiptDate === 'string' ? data.receiptDate : '',
    vendorNameCandidate: typeof data.vendorNameCandidate === 'string' ? data.vendorNameCandidate : '',
    invoiceNumberCandidate: typeof data.invoiceNumberCandidate === 'string' ? data.invoiceNumberCandidate : '',
    invoiceRegisteredNameCandidate:
      typeof data.invoiceRegisteredNameCandidate === 'string' ? data.invoiceRegisteredNameCandidate : '',
    amountTotalCandidate:
      typeof data.amountTotalCandidate === 'number' ? data.amountTotalCandidate : undefined,
    taxAmountCandidate: typeof data.taxAmountCandidate === 'number' ? data.taxAmountCandidate : undefined,
    taxRateCandidate: typeof data.taxRateCandidate === 'number' ? data.taxRateCandidate : undefined,
    ocrRawText: typeof data.ocrRawText === 'string' ? data.ocrRawText : '',
    ocrParsedFields:
      data.ocrParsedFields && typeof data.ocrParsedFields === 'object'
        ? (data.ocrParsedFields as StoredAccountingReceipt['ocrParsedFields'])
        : undefined,
    ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
    ocrProcessedAt: typeof data.ocrProcessedAt === 'string' ? data.ocrProcessedAt : undefined,
    suggestedExpenseCategory:
      (data.suggestedExpenseCategory as StoredAccountingReceipt['suggestedExpenseCategory']) ?? '',
    uploadedBy: String(data.uploadedBy ?? ''),
    uploadedByName: String(data.uploadedByName ?? ''),
    createdAt: readTimestampAsIso(data.createdAt),
    updatedAt: readTimestampAsIso(data.updatedAt),
    invalidatedAt: typeof data.invalidatedAt === 'string' ? data.invalidatedAt : undefined,
  }
}

export async function fetchAccountingReceipts(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())

  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('createdAt', 'desc'),
      ),
    )

    return snapshots.docs.map(toStoredReceipt).filter((receipt) => matchesTenantScope(receipt, scope))
  } catch (error) {
    try {
      const snapshots = await getDocs(
        query(collection(db, collectionName), ...createAccountingTenantConstraints(scope)),
      )
      return snapshots.docs
        .map(toStoredReceipt)
        .filter((receipt) => matchesTenantScope(receipt, scope))
        .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
    } catch (fallbackError) {
      logAccountingQueryFailure(collectionName, scope, fallbackError)
      throw error
    }
  }
}

export async function fetchUnorganizedAccountingReceipts(scope?: TenantAccessScope) {
  const receipts = await fetchAccountingReceipts(scope)
  return receipts.filter((receipt) => receipt.status === 'unorganized')
}

export async function uploadAccountingReceiptImage({
  file,
  franchiseeId,
  storeId,
  uploadedBy,
  uploadedByName,
  memo,
  candidateFields,
}: {
  file: File
  franchiseeId: string
  storeId: string
  uploadedBy: string
  uploadedByName: string
  memo?: string
  candidateFields?: AccountingReceiptCandidateFields
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return {
      receiptId: 'review-demo-receipt',
      downloadUrl: '',
      storagePath: '',
    }
  }

  const db = getFirestore(getFirebaseApp())
  const tenant = resolveAccountingTenantFields({ franchiseeId, storeId })

  const receiptRef = await addDoc(
    collection(db, collectionName),
    removeUndefinedFields({
      ...tenant,
      storagePath: '',
      downloadUrl: '',
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSizeBytes: file.size,
      status: 'unorganized' satisfies ReceiptStatus,
      memo: memo ?? '',
      ...candidateFields,
      uploadedBy,
      uploadedByName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  )

  const storagePath = `accounting/${franchiseeId}/${storeId}/receipts/${receiptRef.id}/${file.name}`
  const storage = getStorage(getFirebaseApp())
  const storageRef = ref(storage, storagePath)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
  })
  const downloadUrl = await getDownloadURL(storageRef)

  await updateDoc(doc(db, collectionName, receiptRef.id), {
    storagePath,
    downloadUrl,
    updatedAt: serverTimestamp(),
  })

  return {
    receiptId: receiptRef.id,
    downloadUrl,
    storagePath,
  }
}

export async function updateUnorganizedAccountingReceipt({
  receiptId,
  patch,
}: {
  receiptId: string
  patch: Partial<AccountingReceiptInput>
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(
    doc(db, collectionName, receiptId),
    removeUndefinedFields({
      ...patch,
      updatedAt: serverTimestamp(),
    }),
  )
}

export async function saveReceiptOnly({
  receiptId,
  memo,
  candidateFields,
  updatedBy,
  updatedByName,
}: {
  receiptId: string
  memo?: string
  candidateFields?: AccountingReceiptCandidateFields
  updatedBy: string
  updatedByName: string
}) {
  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      status: 'unorganized',
      memo,
      ...candidateFields,
      uploadedBy: updatedBy,
      uploadedByName: updatedByName,
    },
  })
}

export async function applyOcrCandidatesToAccountingReceipt({
  receiptId,
  ocr,
}: {
  receiptId: string
  ocr: AccountingReceiptOcrResult
}) {
  const parsed = ocr.parsed

  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      receiptDate: parsed.receiptDate ?? parsed.transactionDate,
      vendorNameCandidate: parsed.vendorName,
      invoiceNumberCandidate: parsed.invoiceNumber,
      invoiceRegisteredNameCandidate: parsed.invoiceRegisteredName,
      amountTotalCandidate: parsed.taxIncludedAmount,
      taxAmountCandidate: parsed.consumptionTaxAmount,
      taxRateCandidate: parsed.taxRate,
      ocrRawText: ocr.ocrRawText,
      ocrParsedFields: parsed,
      ocrConfidence: ocr.ocrConfidence,
      ocrProcessedAt: new Date().toISOString(),
      suggestedExpenseCategory: ocr.suggestedExpenseCategory ?? '',
    },
  })
}

export async function loadAccountingReceiptImageBlob({
  imageBlob,
  downloadUrl,
  storagePath,
  mimeType,
}: {
  imageBlob?: Blob | File | null
  downloadUrl?: string
  storagePath?: string
  mimeType?: string
}) {
  if (imageBlob && imageBlob.size > 0) {
    return imageBlob
  }

  const normalizedPath = storagePath?.trim() ?? ''
  if (normalizedPath) {
    const storage = getStorage(getFirebaseApp())
    const bytes = await getBytes(ref(storage, normalizedPath))
    const type = mimeType?.trim() || guessMimeTypeFromPath(normalizedPath)

    return new Blob([bytes], { type })
  }

  const normalizedUrl = downloadUrl?.trim() ?? ''
  if (!normalizedUrl) {
    throw new Error(OCR_IMAGE_UNAVAILABLE_MESSAGE)
  }

  try {
    const response = await fetch(normalizedUrl)
    if (!response.ok) {
      throw new Error(`証憑画像の取得に失敗しました (${response.status})`)
    }

    return response.blob()
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `証憑画像の取得に失敗しました。${error.message}`
        : OCR_IMAGE_UNAVAILABLE_MESSAGE,
    )
  }
}

export async function linkAccountingReceiptToExpense({
  receiptId,
  expenseId,
}: {
  receiptId: string
  expenseId: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, receiptId), {
    status: 'linked' satisfies ReceiptStatus,
    linkedExpenseId: expenseId,
    updatedAt: serverTimestamp(),
  })
}

export async function invalidateAccountingReceipt({
  receiptId,
}: {
  receiptId: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, receiptId), {
    status: 'invalid' satisfies ReceiptStatus,
    invalidatedAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAccountingReceipt(receiptId: string): Promise<DeleteAccountingReceiptResult> {
  if (isReviewDemoRuntimeEnabled()) {
    return {}
  }

  const db = getFirestore(getFirebaseApp())
  const receiptRef = doc(db, collectionName, receiptId)

  let snapshot
  try {
    snapshot = await getDoc(receiptRef)
  } catch (error) {
    if (isPermissionDenied(error)) {
      throw new Error('未整理領収書データの読み取り権限がありません。Firestore rules を確認してください。')
    }

    throw new Error(
      error instanceof Error ? `未整理領収書データの取得に失敗しました。${error.message}` : '未整理領収書データの取得に失敗しました。',
    )
  }

  if (!snapshot.exists()) {
    return {}
  }

  const receipt = toStoredReceipt(snapshot)

  if (receipt.status !== 'unorganized') {
    throw new Error('未整理の領収書のみ削除できます。')
  }

  let storageImageWasMissing = false
  const storagePath = receipt.storagePath.trim()
  if (storagePath) {
    try {
      const storage = getStorage(getFirebaseApp())
      await deleteObject(ref(storage, storagePath))
    } catch (error) {
      if (isStorageObjectNotFound(error)) {
        storageImageWasMissing = true
      } else if (isPermissionDenied(error)) {
        throw new Error('領収書画像の削除権限がありません。Storage rules を確認してください。')
      } else {
        const detail = error instanceof Error ? error.message : '不明なエラー'
        throw new Error(`領収書画像の削除に失敗しました。${detail}`)
      }
    }
  }

  try {
    await deleteDoc(receiptRef)
  } catch (error) {
    if (isPermissionDenied(error)) {
      throw new Error('未整理領収書データの削除権限がありません。Firestore rules を確認してください。')
    }

    throw new Error(
      error instanceof Error ? `未整理領収書データの削除に失敗しました。${error.message}` : '未整理領収書データの削除に失敗しました。',
    )
  }

  return { storageImageWasMissing }
}

export async function resolveAccountingReceiptDownloadUrl({
  downloadUrl,
  storagePath,
}: {
  downloadUrl?: string
  storagePath?: string
}) {
  const normalizedUrl = downloadUrl?.trim() ?? ''
  if (normalizedUrl) {
    return normalizedUrl
  }

  const normalizedPath = storagePath?.trim() ?? ''
  if (!normalizedPath || isReviewDemoRuntimeEnabled()) {
    return ''
  }

  const storage = getStorage(getFirebaseApp())
  return getDownloadURL(ref(storage, normalizedPath))
}

export type { AccountingReceiptInput, StoredAccountingReceipt }
