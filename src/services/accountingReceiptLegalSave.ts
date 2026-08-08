import {
  addDoc,
  collection,
  doc,
  getFirestore,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingReceiptLegalStatus,
  ReceiptPaperSizeSelection,
} from '../types/accountingReceiptLegal'
import { detectSourceDevice } from '../types/accounting'
import { computeFileSha256 } from '../utils/imageHash'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { resolveAccountingTenantFields } from './accountingTenant'
import { assertTransitionAccountingReceiptLegalStatus } from '../utils/receiptLegalStatus'
import { LEGAL_MASTER_MAX_BYTES } from '../utils/receiptLegalMaster'

const collectionName = 'accountingReceipts'

export const buildLegalMasterStoragePath = (params: {
  franchiseeId: string
  storeId: string
  receiptId: string
  version?: number
}) => {
  const version = params.version ?? 1
  return `accounting/${params.franchiseeId}/${params.storeId}/receipts/${params.receiptId}/legal/v${version}/master.jpg`
}

export const buildLegalThumbnailStoragePath = (params: {
  franchiseeId: string
  storeId: string
  receiptId: string
  version?: number
  thumbExt?: 'webp' | 'jpg'
}) => {
  const version = params.version ?? 1
  const ext = params.thumbExt ?? 'webp'
  return `accounting/${params.franchiseeId}/${params.storeId}/receipts/${params.receiptId}/legal/v${version}/thumb.${ext}`
}

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
  receivedDate?: string
  /** 事前に固定した receiptId（冪等）。未指定なら新規発行 */
  receiptId?: string
  memo?: string
}

export type SaveLegalPendingTimestampResult = {
  receiptId: string
  fileHash: string
  legalMasterStoragePath: string
  thumbnailStoragePath: string
  legalStatus: AccountingReceiptLegalStatus
  version: number
  imageHash: string
}

/**
 * 正式保存準備: master → thumb → Firestore。
 * legalStatus = legal_pending_timestamp（タイムスタンプ未付与）。
 * OCR画像は保存しない。
 */
export async function saveAccountingReceiptLegalPendingTimestamp(
  input: SaveLegalPendingTimestampInput,
): Promise<SaveLegalPendingTimestampResult> {
  if (isReviewDemoRuntimeEnabled()) {
    const fileHash = await computeFileSha256(input.legalMasterBlob)
    return {
      receiptId: input.receiptId?.trim() || 'review-demo-legal-receipt',
      fileHash,
      legalMasterStoragePath: '',
      thumbnailStoragePath: '',
      legalStatus: 'legal_pending_timestamp',
      version: 1,
      imageHash: fileHash,
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
  // 二重計上互換: imageHash にも同じハッシュを入れる（マスター確定バイト）
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
        timestampStatus: 'none',
        sourceDevice,
        memo: input.memo ?? '',
        uploadedBy: input.uploadedBy,
        uploadedByName: input.uploadedByName,
        createdBy: input.uploadedBy,
        updatedBy: input.uploadedBy,
        capturedAt: input.capturedAt,
        transactionDate: input.transactionDate || '',
        receivedDate: input.receivedDate || input.transactionDate || '',
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

  assertTransitionAccountingReceiptLegalStatus('image_review', 'legal_pending_timestamp')

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
    legalStatus: 'legal_pending_timestamp',
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
    previousVersionId: '',
    timestampStatus: 'pending',
    timestampProvider: '',
    timestampTokenId: '',
    timestampedAt: '',
    capturedAt: input.capturedAt,
    transactionDate: input.transactionDate || '',
    receivedDate: input.receivedDate || input.transactionDate || '',
    // legalSavedAt はタイムスタンプ付与後（第3段階）まで設定しない
    status: 'unorganized',
    updatedBy: input.uploadedBy,
    updatedAt: serverTimestamp(),
  })

  return {
    receiptId,
    fileHash,
    legalMasterStoragePath,
    thumbnailStoragePath,
    legalStatus: 'legal_pending_timestamp',
    version,
    imageHash,
  }
}
