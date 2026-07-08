import {
  addDoc,
  arrayUnion,
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
  AccountingReceiptConfirmedFields,
  AccountingReceiptEditHistoryEntry,
  AccountingReceiptInput,
  AccountingReceiptOcrCandidates,
  AccountingReceiptWorkflowStatus,
  ReceiptStatus,
  StoredAccountingReceipt,
} from '../types/accounting'
import {
  detectSourceDevice,
  mapLegacyStatusToWorkflow,
  normalizeAccountingReceiptWorkflowStatus,
  normalizeReceiptStatus,
} from '../types/accounting'
import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import {
  buildConfirmedDraftFromCandidates,
  buildOcrCandidatesFromParsed,
} from '../utils/accountingReceiptClassification'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
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
  const downloadUrl = String(data.downloadUrl ?? data.imageUrl ?? '')
  const status = normalizeReceiptStatus(data.status ?? data.receiptStatus, linkedExpenseId || undefined)
  const ocrParsedFields =
    data.ocrParsedFields && typeof data.ocrParsedFields === 'object'
      ? (data.ocrParsedFields as StoredAccountingReceipt['ocrParsedFields'])
      : undefined
  const ocrCandidates =
    data.ocrCandidates && typeof data.ocrCandidates === 'object'
      ? (data.ocrCandidates as AccountingReceiptOcrCandidates)
      : undefined
  const hasOcr = Boolean(
    ocrCandidates?.rawText ||
      data.ocrRawText ||
      ocrParsedFields ||
      data.ocrProcessedAt,
  )
  const receiptStatus = normalizeAccountingReceiptWorkflowStatus(
    data.receiptStatus,
    mapLegacyStatusToWorkflow(status, hasOcr, linkedExpenseId || undefined),
  )

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    storagePath: String(data.storagePath ?? ''),
    downloadUrl,
    imageUrl: String(data.imageUrl ?? downloadUrl),
    mimeType: String(data.mimeType ?? data.contentType ?? ''),
    fileName: String(data.fileName ?? ''),
    fileSizeBytes: Number(data.fileSizeBytes ?? data.size ?? 0),
    status,
    receiptStatus,
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
    ocrParsedFields,
    ocrCandidates,
    confirmed:
      data.confirmed && typeof data.confirmed === 'object'
        ? (data.confirmed as AccountingReceiptConfirmedFields)
        : undefined,
    editHistory: Array.isArray(data.editHistory)
      ? (data.editHistory as AccountingReceiptEditHistoryEntry[])
      : [],
    sourceDevice:
      data.sourceDevice === 'mobile' || data.sourceDevice === 'pc'
        ? data.sourceDevice
        : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : String(data.uploadedBy ?? ''),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : String(data.uploadedBy ?? ''),
    ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
    ocrProcessedAt: typeof data.ocrProcessedAt === 'string' ? data.ocrProcessedAt : undefined,
    suggestedExpenseCategory:
      (data.suggestedExpenseCategory as StoredAccountingReceipt['suggestedExpenseCategory']) ?? '',
    invoiceRegistrant:
      data.invoiceRegistrant && typeof data.invoiceRegistrant === 'object'
        ? (data.invoiceRegistrant as StoredAccountingReceipt['invoiceRegistrant'])
        : undefined,
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
  return receipts.filter((receipt) => {
    const workflow =
      receipt.receiptStatus ??
      mapLegacyStatusToWorkflow(
        receipt.status,
        Boolean(receipt.ocrCandidates || receipt.ocrRawText),
        receipt.linkedExpenseId,
      )
    return (
      receipt.status === 'unorganized' &&
      (workflow === 'draft' || workflow === 'ocr_ready')
    )
  })
}

const buildEditHistoryUnion = (
  editedBy: string,
  changedFields: string[],
  sourceDevice = detectSourceDevice(),
) =>
  arrayUnion({
    editedAt: new Date().toISOString(),
    editedBy,
    sourceDevice,
    changedFields,
  }) as unknown as AccountingReceiptEditHistoryEntry[]

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

  const sourceDevice = detectSourceDevice()
  const receiptRef = await addDoc(
    collection(db, collectionName),
    removeUndefinedFields({
      ...tenant,
      storagePath: '',
      downloadUrl: '',
      imageUrl: '',
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSizeBytes: file.size,
      status: 'unorganized' satisfies ReceiptStatus,
      receiptStatus: 'draft' satisfies AccountingReceiptWorkflowStatus,
      sourceDevice,
      memo: memo ?? '',
      ...candidateFields,
      uploadedBy,
      uploadedByName,
      createdBy: uploadedBy,
      updatedBy: uploadedBy,
      editHistory: [
        {
          editedAt: new Date().toISOString(),
          editedBy: uploadedBy,
          sourceDevice,
          changedFields: ['create', 'image'],
        },
      ],
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
    imageUrl: downloadUrl,
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
  patch: Partial<AccountingReceiptInput> & Record<string, unknown>
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
    }) as Record<string, unknown>,
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
  editedBy = 'system',
}: {
  receiptId: string
  ocr: AccountingReceiptOcrResult
  editedBy?: string
}) {
  const parsed = ocr.parsed
  const ocrCandidates =
    ocr.ocrCandidates ??
    buildOcrCandidatesFromParsed({
      parsed,
      rawText: ocr.ocrRawText,
      suggestedExpenseCategory: ocr.suggestedExpenseCategory,
    })
  const confirmedDraft = buildConfirmedDraftFromCandidates(ocrCandidates)
  const sourceDevice = detectSourceDevice()

  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      receiptDate: parsed.receiptDate ?? parsed.transactionDate ?? ocrCandidates.date,
      vendorNameCandidate: ocrCandidates.vendorName || parsed.vendorName,
      invoiceNumberCandidate: ocrCandidates.invoiceNumber || parsed.invoiceNumber,
      invoiceRegisteredNameCandidate:
        ocrCandidates.invoiceRegisteredName || parsed.invoiceRegisteredName,
      amountTotalCandidate: ocrCandidates.amount ?? parsed.taxIncludedAmount,
      taxAmountCandidate: ocrCandidates.taxAmount ?? parsed.consumptionTaxAmount,
      taxRateCandidate: parsed.taxRate,
      ocrRawText: ocr.ocrRawText,
      ocrParsedFields: parsed,
      ocrCandidates,
      confirmed: confirmedDraft,
      receiptStatus: 'ocr_ready',
      status: 'unorganized',
      ocrConfidence: ocr.ocrConfidence,
      ocrProcessedAt: new Date().toISOString(),
      suggestedExpenseCategory: ocr.suggestedExpenseCategory ?? ocrCandidates.accountTitle ?? '',
      invoiceRegistrant: ocr.invoiceRegistrant,
      updatedBy: editedBy,
      sourceDevice,
      editHistory: buildEditHistoryUnion(editedBy, ['ocrCandidates', 'receiptStatus'], sourceDevice),
    },
  })
}

export async function saveConfirmedAccountingReceipt({
  receiptId,
  confirmed,
  editedBy,
}: {
  receiptId: string
  confirmed: AccountingReceiptConfirmedFields
  editedBy: string
  previousHistory?: AccountingReceiptEditHistoryEntry[]
}) {
  const sourceDevice = detectSourceDevice()
  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      confirmed,
      receiptStatus: 'confirmed',
      status: 'unorganized',
      receiptDate: confirmed.date,
      vendorNameCandidate: confirmed.vendorName,
      invoiceNumberCandidate: confirmed.invoiceNumber,
      invoiceRegisteredNameCandidate: confirmed.invoiceRegisteredName,
      amountTotalCandidate: confirmed.amount,
      taxAmountCandidate: confirmed.taxAmount,
      memo: confirmed.memo,
      updatedBy: editedBy,
      sourceDevice,
      editHistory: buildEditHistoryUnion(editedBy, ['confirmed', 'receiptStatus'], sourceDevice),
    },
  })
}

export async function rejectAccountingReceiptWorkflow({
  receiptId,
  editedBy,
}: {
  receiptId: string
  editedBy: string
  previousHistory?: AccountingReceiptEditHistoryEntry[]
}) {
  const sourceDevice = detectSourceDevice()
  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      receiptStatus: 'rejected',
      status: 'invalid',
      updatedBy: editedBy,
      sourceDevice,
      editHistory: buildEditHistoryUnion(editedBy, ['receiptStatus'], sourceDevice),
    },
  })
}

export async function saveReceiptDraftEdits({
  receiptId,
  confirmed,
  ocrCandidates,
  editedBy,
  changedFields,
}: {
  receiptId: string
  confirmed: AccountingReceiptConfirmedFields
  ocrCandidates?: AccountingReceiptOcrCandidates
  editedBy: string
  previousHistory?: AccountingReceiptEditHistoryEntry[]
  changedFields: string[]
}) {
  const sourceDevice = detectSourceDevice()
  await updateUnorganizedAccountingReceipt({
    receiptId,
    patch: {
      confirmed,
      ocrCandidates,
      receiptStatus: 'ocr_ready',
      status: 'unorganized',
      receiptDate: confirmed.date,
      vendorNameCandidate: confirmed.vendorName,
      invoiceNumberCandidate: confirmed.invoiceNumber,
      invoiceRegisteredNameCandidate: confirmed.invoiceRegisteredName,
      amountTotalCandidate: confirmed.amount,
      taxAmountCandidate: confirmed.taxAmount,
      memo: confirmed.memo,
      updatedBy: editedBy,
      sourceDevice,
      editHistory: buildEditHistoryUnion(editedBy, changedFields, sourceDevice),
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

    return new Blob([new Uint8Array(bytes)], { type })
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
      { cause: error },
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
    receiptStatus: 'confirmed' satisfies AccountingReceiptWorkflowStatus,
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
    receiptStatus: 'rejected' satisfies AccountingReceiptWorkflowStatus,
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
      throw new Error('未整理領収書データの読み取り権限がありません。Firestore rules を確認してください。', {
        cause: error,
      })
    }

    throw new Error(
      error instanceof Error ? `未整理領収書データの取得に失敗しました。${error.message}` : '未整理領収書データの取得に失敗しました。',
      { cause: error },
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
        throw new Error('領収書画像の削除権限がありません。Storage rules を確認してください。', { cause: error })
      } else {
        const detail = error instanceof Error ? error.message : '不明なエラー'
        throw new Error(`領収書画像の削除に失敗しました。${detail}`, { cause: error })
      }
    }
  }

  try {
    await deleteDoc(receiptRef)
  } catch (error) {
    if (isPermissionDenied(error)) {
      throw new Error('未整理領収書データの削除権限がありません。Firestore rules を確認してください。', {
        cause: error,
      })
    }

    throw new Error(
      error instanceof Error ? `未整理領収書データの削除に失敗しました。${error.message}` : '未整理領収書データの削除に失敗しました。',
      { cause: error },
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
