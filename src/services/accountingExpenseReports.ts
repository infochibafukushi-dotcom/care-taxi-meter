import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingExpenseReportInput,
  StoredAccountingExpenseReport,
  StoredAccountingExpenseReportImage,
} from '../types/accountingExpenseReport'
import {
  EXPENSE_REPORT_BODY_MAX_LENGTH,
  normalizeExpenseReportDateMode,
  normalizeExpenseReportTargetType,
} from '../types/accountingExpenseReport'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import {
  createAccountingTenantConstraints,
  logAccountingQueryFailure,
  resolveAccountingTenantFields,
} from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'
import {
  ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE,
  ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE,
  isAccountingReceiptFileSizeAllowed,
  isAccountingReceiptImageMime,
  isAccountingReceiptPdfMime,
} from '../utils/accountingReceiptFile'

const collectionName = 'accountingExpenseReports'

const readTimestampAsIso = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }
  return undefined
}

const toStoredImage = (value: unknown): StoredAccountingExpenseReportImage | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const data = value as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : ''
  const storagePath = typeof data.storagePath === 'string' ? data.storagePath : ''
  if (!id || !storagePath) {
    return null
  }
  return {
    id,
    storagePath,
    originalFileName: typeof data.originalFileName === 'string' ? data.originalFileName : '',
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'image/jpeg',
    caption: typeof data.caption === 'string' ? data.caption : null,
    displayOrder: Number(data.displayOrder ?? 0),
    fileSizeBytes: typeof data.fileSizeBytes === 'number' ? data.fileSizeBytes : undefined,
    createdAt:
      typeof data.createdAt === 'string' ? data.createdAt : new Date(0).toISOString(),
  }
}

const toStoredReport = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): StoredAccountingExpenseReport => {
  const data = snapshot.data()
  const images = Array.isArray(data.images)
    ? data.images.map(toStoredImage).filter((image): image is StoredAccountingExpenseReportImage => Boolean(image))
    : []

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    targetType: normalizeExpenseReportTargetType(data.targetType),
    targetId: String(data.targetId ?? ''),
    title: String(data.title ?? ''),
    startDate: typeof data.startDate === 'string' ? data.startDate : null,
    endDate: typeof data.endDate === 'string' ? data.endDate : null,
    dateMode: normalizeExpenseReportDateMode(data.dateMode),
    body: String(data.body ?? ''),
    images,
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
    updatedByName: String(data.updatedByName ?? ''),
    isDeleted: data.isDeleted === true,
    deletedAt: readTimestampAsIso(data.deletedAt),
    deletedBy: typeof data.deletedBy === 'string' ? data.deletedBy : '',
    createdAt: readTimestampAsIso(data.createdAt),
    updatedAt: readTimestampAsIso(data.updatedAt),
  }
}

export async function fetchAccountingExpenseReports(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('updatedAt', 'desc'),
      ),
    )
    return snapshots.docs.map(toStoredReport).filter((report) => matchesTenantScope(report, scope))
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error)
    throw error
  }
}

export async function fetchAccountingExpenseReportsForTarget({
  scope,
  targetType,
  targetId,
}: {
  scope?: TenantAccessScope
  targetType: 'expense' | 'expense_group'
  targetId: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        where('targetType', '==', targetType),
        where('targetId', '==', targetId),
      ),
    )
    return snapshots.docs
      .map(toStoredReport)
      .filter((report) => matchesTenantScope(report, scope) && report.isDeleted !== true)
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error, { targetType, targetId })
    throw error
  }
}

export const buildEmptyExpenseReportInput = ({
  franchiseeId,
  storeId,
  staffId,
  staffName,
  targetType,
  targetId,
  title = '',
  startDate = null,
  endDate = null,
}: {
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  targetType: 'expense' | 'expense_group'
  targetId: string
  title?: string
  startDate?: string | null
  endDate?: string | null
}): AccountingExpenseReportInput => {
  const tenant = resolveAccountingTenantFields({ franchiseeId, storeId })
  return {
    ...tenant,
    targetType,
    targetId,
    title,
    startDate,
    endDate,
    dateMode: 'auto',
    body: '',
    images: [],
    createdBy: staffId,
    createdByName: staffName,
    updatedBy: staffId,
    updatedByName: staffName,
  }
}

export type ExpenseReportDraftImage = {
  /** 既存画像 ID。新規は一時 ID */
  id: string
  /** 既存 Storage パス */
  storagePath?: string
  /** 新規アップロード待ち File */
  file?: File
  /** プレビュー用 object URL（メモリ） */
  previewUrl?: string
  originalFileName: string
  mimeType: string
  caption: string
  displayOrder: number
  createdAt: string
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
  uploadError?: string
}

const sanitizeStorageFileName = (fileName: string) =>
  fileName.replace(/[^\w.\-()\u3040-\u30ff\u3400-\u9fff]+/g, '_').slice(0, 80) || 'photo.jpg'

export const validateExpenseReportImageFile = (file: File) => {
  if (!isAccountingReceiptFileSizeAllowed(file.size)) {
    return { ok: false as const, message: ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE }
  }
  if (isAccountingReceiptPdfMime(file.type) || file.name.toLowerCase().endsWith('.pdf')) {
    return {
      ok: false as const,
      message: 'レポート写真は画像（JPG / PNG / WebP）のみ対応しています。',
    }
  }
  if (!isAccountingReceiptImageMime(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    return { ok: false as const, message: ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE }
  }
  return { ok: true as const }
}

export const validateExpenseReportForSave = (input: {
  title: string
  body: string
}): string[] => {
  const errors: string[] = []
  if (!input.title.trim()) {
    errors.push('レポートタイトルは必須です。')
  }
  if (input.body.length > EXPENSE_REPORT_BODY_MAX_LENGTH) {
    errors.push(`レポート本文は${EXPENSE_REPORT_BODY_MAX_LENGTH.toLocaleString()}文字以内にしてください。`)
  }
  return errors
}

async function uploadReportImageFile({
  file,
  franchiseeId,
  storeId,
  reportId,
  imageId,
}: {
  file: File
  franchiseeId: string
  storeId: string
  reportId: string
  imageId: string
}) {
  const storage = getStorage(getFirebaseApp())
  const fileName = sanitizeStorageFileName(file.name)
  const storagePath = `accounting/${franchiseeId}/${storeId}/reports/${reportId}/${imageId}/${fileName}`
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || 'image/jpeg',
  })
  return storagePath
}

export async function loadAccountingExpenseReportImageBlobUrl(storagePath: string) {
  if (!storagePath.trim() || isReviewDemoRuntimeEnabled()) {
    return ''
  }
  const storage = getStorage(getFirebaseApp())
  const bytes = await getBytes(ref(storage, storagePath))
  const blob = new Blob([bytes])
  return URL.createObjectURL(blob)
}

export async function saveAccountingExpenseReport({
  mode,
  reportId,
  input,
  draftImages,
  removedImageStoragePaths = [],
}: {
  mode: 'create' | 'update'
  reportId?: string
  input: AccountingExpenseReportInput
  draftImages: ExpenseReportDraftImage[]
  removedImageStoragePaths?: string[]
}): Promise<{
  reportId: string
  imageUploadFailures: Array<{ fileName: string; message: string }>
}> {
  if (isReviewDemoRuntimeEnabled()) {
    return { reportId: reportId || 'review-demo-report', imageUploadFailures: [] }
  }

  const validationErrors = validateExpenseReportForSave(input)
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'))
  }

  const db = getFirestore(getFirebaseApp())
  const resolvedReportId =
    mode === 'update' && reportId ? reportId : doc(collection(db, collectionName)).id

  const imageUploadFailures: Array<{ fileName: string; message: string }> = []
  const savedImages: StoredAccountingExpenseReportImage[] = []

  for (const [index, draft] of draftImages.entries()) {
    if (draft.file) {
      try {
        const storagePath = await uploadReportImageFile({
          file: draft.file,
          franchiseeId: input.franchiseeId,
          storeId: input.storeId,
          reportId: resolvedReportId,
          imageId: draft.id,
        })
        savedImages.push({
          id: draft.id,
          storagePath,
          originalFileName: draft.originalFileName,
          mimeType: draft.mimeType || draft.file.type || 'image/jpeg',
          caption: draft.caption.trim() || null,
          displayOrder: index,
          fileSizeBytes: draft.file.size,
          createdAt: draft.createdAt || new Date().toISOString(),
        })
      } catch (error) {
        imageUploadFailures.push({
          fileName: draft.originalFileName,
          message: error instanceof Error ? error.message : 'アップロードに失敗しました。',
        })
      }
      continue
    }

    if (draft.storagePath) {
      savedImages.push({
        id: draft.id,
        storagePath: draft.storagePath,
        originalFileName: draft.originalFileName,
        mimeType: draft.mimeType,
        caption: draft.caption.trim() || null,
        displayOrder: index,
        createdAt: draft.createdAt || new Date().toISOString(),
      })
    }
  }

  const payload = removeUndefinedFields({
    ...input,
    targetType: normalizeExpenseReportTargetType(input.targetType),
    dateMode: normalizeExpenseReportDateMode(input.dateMode),
    title: input.title.trim(),
    body: input.body,
    images: savedImages,
    isDeleted: false,
    updatedAt: serverTimestamp(),
    ...(mode === 'create' ? { createdAt: serverTimestamp() } : {}),
  })

  const reportRef = doc(db, collectionName, resolvedReportId)
  const batch = writeBatch(db)
  if (mode === 'create') {
    batch.set(reportRef, payload)
  } else {
    batch.set(reportRef, payload, { merge: true })
  }
  await batch.commit()

  const storage = getStorage(getFirebaseApp())
  for (const storagePath of removedImageStoragePaths) {
    if (!storagePath.trim()) {
      continue
    }
    try {
      await deleteObject(ref(storage, storagePath))
    } catch (error) {
      console.warn('[accounting] failed to delete report image', { storagePath, error })
    }
  }

  return { reportId: resolvedReportId, imageUploadFailures }
}

export async function softDeleteAccountingExpenseReport({
  reportId,
  deletedBy,
}: {
  reportId: string
  deletedBy: string
  deleteStorageFiles?: boolean
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, reportId), {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy,
    updatedBy: deletedBy,
    updatedAt: serverTimestamp(),
  })
}

export async function softDeleteAccountingExpenseReportWithImages({
  report,
  deletedBy,
}: {
  report: StoredAccountingExpenseReport
  deletedBy: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, report.id), {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy,
    updatedBy: deletedBy,
    updatedAt: serverTimestamp(),
  })

  const storage = getStorage(getFirebaseApp())
  for (const image of report.images) {
    if (!image.storagePath) {
      continue
    }
    try {
      await deleteObject(ref(storage, image.storagePath))
    } catch (error) {
      console.warn('[accounting] failed to delete report image on report delete', {
        storagePath: image.storagePath,
        error,
      })
    }
  }
}
