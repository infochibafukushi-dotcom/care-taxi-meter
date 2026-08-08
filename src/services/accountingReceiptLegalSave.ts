import {
  addDoc,
  collection,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingReceiptLegalStatus,
  ReceiptPaperSizeSelection,
} from '../types/accountingReceiptLegal'
import { DEFAULT_SCANNER_INPUT_MODE } from '../utils/accountingScannerDeadline'
import { evaluateScannerDeadline } from '../utils/accountingScannerDeadline'
import {
  buildLegalMasterStoragePath,
  buildLegalThumbnailStoragePath,
} from '../utils/accountingScannerPaths'
import { normalizeScannerSearchVendorName } from '../utils/accountingScannerSearchQuery'
import { detectSourceDevice } from '../types/accounting'
import { computeFileSha256 } from '../utils/imageHash'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { resolveAccountingTenantFields } from './accountingTenant'
import { assertTransitionAccountingReceiptLegalStatus } from '../utils/receiptLegalStatus'
import { LEGAL_MASTER_MAX_BYTES } from '../utils/receiptLegalMaster'
import { recordScannerAuditEvent } from './accountingScannerAudit'

export {
  buildLegalMasterStoragePath,
  buildLegalThumbnailStoragePath,
} from '../utils/accountingScannerPaths'

const collectionName = 'accountingReceipts'

const uploadStorageFile = async (storagePath: string, file: Blob, contentType: string) => {
  if (file.size >= LEGAL_MASTER_MAX_BYTES) {
    throw new Error('保存画像が10MBを超えています。法定画質を維持したまま保存できません。')
  }
  const storage = getStorage(getFirebaseApp())
  await uploadBytes(ref(storage, storagePath), file, { contentType })
}

export type SaveLegalPendingTimestampInput = {
  franchiseeId: string
  storeId: string
  uploadedBy: string
  uploadedByName: string
  legalMasterBlob: Blob
  thumbnailBlob: Blob
  paper: ReceiptPaperSizeSelection
  widthPx: number
  heightPx: number
  estimatedDpi: number
  capturedAt: string
  transactionDate?: string
  receivedDate?: string | null
  foundDate?: string
  receiptId?: string
  memo?: string
  businessHolidays?: string[]
  vendorNameCandidate?: string
  amountTotalCandidate?: number | null
}

export type SaveLegalPendingTimestampResult = {
  receiptId: string
  fileHash: string
  legalMasterStoragePath: string
  thumbnailStoragePath: string
  legalStatus: AccountingReceiptLegalStatus
  version: number
  imageHash: string
  requiresPaperOriginal: boolean
  deadlineDueDate: string | null
}

/**
 * 正式保存準備: master → thumb → Firestore + versions/v1。
 * タイムスタンプ未付与のため legal_pending_timestamp または late_saved。
 */
export async function saveAccountingReceiptLegalPendingTimestamp(
  input: SaveLegalPendingTimestampInput,
): Promise<SaveLegalPendingTimestampResult> {
  const deadline = evaluateScannerDeadline({
    receivedDate: input.receivedDate,
    foundDate: input.foundDate,
    mode: DEFAULT_SCANNER_INPUT_MODE,
    calendar: { holidays: input.businessHolidays },
  })

  // タイムスタンプ未付与の間は legal_pending_timestamp を維持。
  // 期限超過は requiresPaperOriginal / paperOriginalReason で表現し、
  // 発行・検証成功時に late_saved へ遷移する（ダミー発行での昇格は禁止）。
  const legalStatus: AccountingReceiptLegalStatus = 'legal_pending_timestamp'

  if (isReviewDemoRuntimeEnabled()) {
    const fileHash = await computeFileSha256(input.legalMasterBlob)
    return {
      receiptId: input.receiptId?.trim() || 'review-demo-legal-receipt',
      fileHash,
      legalMasterStoragePath: '',
      thumbnailStoragePath: '',
      legalStatus,
      version: 1,
      imageHash: fileHash,
      requiresPaperOriginal: deadline.requiresPaperOriginal,
      deadlineDueDate: deadline.dueDate,
    }
  }

  const db = getFirestore(getFirebaseApp())
  const tenant = resolveAccountingTenantFields({
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
  })
  const version = 1
  const sourceDevice = detectSourceDevice()
  const fileHash = await computeFileSha256(input.legalMasterBlob)
  const imageHash = fileHash

  const thumbIsWebp = input.thumbnailBlob.type === 'image/webp'
  const thumbExt = thumbIsWebp ? 'webp' : 'jpg'
  const thumbContentType = thumbIsWebp ? 'image/webp' : 'image/jpeg'

  let receiptId = input.receiptId?.trim() ?? ''
  if (!receiptId) {
    const receiptRef = await addDoc(
      collection(db, collectionName),
      removeUndefinedFields({
        ...tenant,
        storagePath: '',
        downloadUrl: '',
        imageUrl: '',
        mimeType: 'image/jpeg',
        fileName: 'legal-master.jpg',
        fileSizeBytes: input.legalMasterBlob.size,
        imageHash,
        fileHash,
        documentType: 'image',
        originalFileName: 'legal-master.jpg',
        originalMimeType: 'image/jpeg',
        originalFileSizeBytes: input.legalMasterBlob.size,
        status: 'unorganized',
        receiptStatus: 'ocr_ready',
        captureMode: 'scanner_v1',
        legalStatus: 'image_review',
        version,
        activeVersion: version,
        timestampStatus: 'none',
        scannerInputMode: DEFAULT_SCANNER_INPUT_MODE,
        sourceDevice,
        memo: input.memo ?? '',
        uploadedBy: input.uploadedBy,
        uploadedByName: input.uploadedByName,
        createdBy: input.uploadedBy,
        updatedBy: input.uploadedBy,
        capturedAt: input.capturedAt,
        transactionDate: input.transactionDate || '',
        receivedDate: input.receivedDate ?? null,
        foundDate: input.foundDate || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        editHistory: [
          {
            editedAt: new Date().toISOString(),
            editedBy: input.uploadedBy,
            sourceDevice,
            changedFields: ['create', 'scanner_v1'],
          },
        ],
      }),
    )
    receiptId = receiptRef.id
  }

  const legalMasterStoragePath = buildLegalMasterStoragePath({
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    receiptId,
    version,
  })
  const thumbnailStoragePath = buildLegalThumbnailStoragePath({
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    receiptId,
    version,
    thumbExt,
  })

  await uploadStorageFile(legalMasterStoragePath, input.legalMasterBlob, 'image/jpeg')
  await uploadStorageFile(thumbnailStoragePath, input.thumbnailBlob, thumbContentType)

  assertTransitionAccountingReceiptLegalStatus('image_review', legalStatus)

  await updateDoc(doc(db, collectionName, receiptId), {
    storagePath: legalMasterStoragePath,
    downloadUrl: '',
    imageUrl: '',
    originalStoragePath: legalMasterStoragePath,
    originalDownloadUrl: '',
    ocrImageStoragePath: '',
    ocrImageDownloadUrl: '',
    mimeType: 'image/jpeg',
    fileName: 'legal-master.jpg',
    fileSizeBytes: input.legalMasterBlob.size,
    originalFileName: 'legal-master.jpg',
    originalMimeType: 'image/jpeg',
    originalFileSizeBytes: input.legalMasterBlob.size,
    captureMode: 'scanner_v1',
    legalStatus,
    legalMasterStoragePath,
    thumbnailStoragePath,
    legalMasterMimeType: 'image/jpeg',
    legalWidthPx: input.widthPx,
    legalHeightPx: input.heightPx,
    paperSizeType: input.paper.paperSizeType,
    paperWidthMm: input.paper.paperWidthMm,
    paperHeightMm: input.paper.paperHeightMm,
    estimatedDpi: input.estimatedDpi,
    fileHash,
    imageHash,
    version,
    activeVersion: version,
    previousVersionId: '',
    timestampStatus: 'pending',
    timestampProvider: '',
    timestampTokenId: '',
    timestampedAt: '',
    timestampVerifiedAt: '',
    timestampAlgorithm: '',
    timestampTokenStoragePath: '',
    capturedAt: input.capturedAt,
    transactionDate: input.transactionDate || '',
    receivedDate: input.receivedDate ?? null,
    foundDate: input.foundDate || '',
    scannerInputMode: DEFAULT_SCANNER_INPUT_MODE,
    requiresPaperOriginal: deadline.requiresPaperOriginal,
    paperOriginalReason: deadline.reason || '',
    deadlineDueDate: deadline.dueDate || '',
    // 法定保存期間の目安（自動物理削除はしない）
    retentionUntil: (() => {
      const base = (input.transactionDate || input.receivedDate || input.capturedAt || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) {
        return ''
      }
      const year = Number(base.slice(0, 4)) + 7
      return `${year}${base.slice(4)}`
    })(),
    searchAmountYen:
      typeof input.amountTotalCandidate === 'number' && Number.isFinite(input.amountTotalCandidate)
        ? input.amountTotalCandidate
        : null,
    searchVendorName: normalizeScannerSearchVendorName(input.vendorNameCandidate ?? ''),
    vendorNameCandidate: input.vendorNameCandidate ?? '',
    amountTotalCandidate:
      typeof input.amountTotalCandidate === 'number' && Number.isFinite(input.amountTotalCandidate)
        ? input.amountTotalCandidate
        : null,
    status: 'unorganized',
    updatedBy: input.uploadedBy,
    updatedAt: serverTimestamp(),
  })

  await setDoc(
    doc(db, collectionName, receiptId, 'versions', `v${version}`),
    removeUndefinedFields({
      version,
      previousVersion: null,
      legalMasterStoragePath,
      thumbnailStoragePath,
      fileHash,
      legalWidthPx: input.widthPx,
      legalHeightPx: input.heightPx,
      estimatedDpi: input.estimatedDpi,
      timestampStatus: 'pending',
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: input.uploadedBy,
      franchiseeId: input.franchiseeId,
      storeId: input.storeId,
      companyId: input.franchiseeId,
    }),
  )

  await recordScannerAuditEvent({
    eventType: 'image_confirmed',
    receiptId,
    version,
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    actor: {
      userId: input.uploadedBy,
      userName: input.uploadedByName,
      role: '',
      franchiseeId: input.franchiseeId,
      storeId: input.storeId,
    },
    metadata: {
      legalStatus,
      fileHash,
      requiresPaperOriginal: deadline.requiresPaperOriginal,
    },
  })

  return {
    receiptId,
    fileHash,
    legalMasterStoragePath,
    thumbnailStoragePath,
    legalStatus,
    version,
    imageHash,
    requiresPaperOriginal: deadline.requiresPaperOriginal,
    deadlineDueDate: deadline.dueDate,
  }
}
