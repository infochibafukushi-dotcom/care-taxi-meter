import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { deleteObject, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingReceiptVersionRecord,
  ScannerDeleteReason,
} from '../types/accountingReceiptLegal'
import type { StoredAccountingReceipt } from '../types/accounting'
import { computeFileSha256 } from '../utils/imageHash'
import {
  buildLegalMasterStoragePath,
  buildLegalThumbnailStoragePath,
} from '../utils/accountingScannerPaths'
import {
  assertTransitionAccountingReceiptLegalStatus,
  canHardDeleteScannerReceipt,
  canPromoteToLegalSaved,
} from '../utils/receiptLegalStatus'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { LEGAL_MASTER_MAX_BYTES } from '../utils/receiptLegalMaster'
import type { AuditActor } from './auditLogs'
import { recordScannerAuditEvent } from './accountingScannerAudit'

const collectionName = 'accountingReceipts'

const deleteStorageQuietly = async (storagePath?: string) => {
  const path = storagePath?.trim()
  if (!path) {
    return
  }
  try {
    await deleteObject(ref(getStorage(getFirebaseApp()), path))
  } catch {
    // missing object は無視
  }
}

/** issued 後の master 上書きを禁止 */
export async function assertMasterImmutable(receipt: Pick<
  StoredAccountingReceipt,
  'timestampStatus' | 'legalMasterStoragePath' | 'fileHash'
>) {
  if (receipt.timestampStatus !== 'issued') {
    return
  }
  const path = receipt.legalMasterStoragePath?.trim()
  const expected = receipt.fileHash?.trim().toLowerCase()
  if (!path || !expected) {
    throw new Error('正式保存済み証憑の整合性を確認できません。')
  }
  const bytes = await getBytes(ref(getStorage(getFirebaseApp()), path))
  const hash = await computeFileSha256(new Blob([bytes]))
  if (hash !== expected) {
    throw new Error('保存画像のハッシュが一致しません。master の改変が疑われます。')
  }
}

export async function verifyStoredMasterHash(receipt: StoredAccountingReceipt): Promise<{
  ok: boolean
  currentHash: string
  expectedHash: string
}> {
  const path = receipt.legalMasterStoragePath?.trim() || ''
  const expectedHash = (receipt.fileHash || '').trim().toLowerCase()
  if (!path || !expectedHash) {
    return { ok: false, currentHash: '', expectedHash }
  }
  const bytes = await getBytes(ref(getStorage(getFirebaseApp()), path))
  const currentHash = await computeFileSha256(new Blob([bytes]))
  return { ok: currentHash === expectedHash, currentHash, expectedHash }
}

/**
 * タイムスタンプ発行前の完全削除（画像を残さない）。
 * 取消の軽量監査ログのみ残す。
 */
export async function hardDeletePreTimestampScannerReceipt(input: {
  receipt: StoredAccountingReceipt
  actor: AuditActor
  reason: ScannerDeleteReason | string
}): Promise<void> {
  const { receipt, actor, reason } = input
  if (
    !canHardDeleteScannerReceipt({
      legalStatus: receipt.legalStatus,
      timestampStatus: receipt.timestampStatus,
    })
  ) {
    throw new Error('タイムスタンプ発行済みの証憑は完全削除できません。論理削除を使用してください。')
  }

  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  const versionsSnap = await getDocs(collection(db, collectionName, receipt.id, 'versions'))
  for (const versionDoc of versionsSnap.docs) {
    const data = versionDoc.data() as AccountingReceiptVersionRecord
    await deleteStorageQuietly(data.legalMasterStoragePath)
    await deleteStorageQuietly(data.thumbnailStoragePath)
    await deleteStorageQuietly(data.timestampTokenStoragePath)
    await deleteDoc(versionDoc.ref)
  }

  await deleteStorageQuietly(receipt.legalMasterStoragePath)
  await deleteStorageQuietly(receipt.thumbnailStoragePath)
  await deleteStorageQuietly(receipt.timestampTokenStoragePath)
  await deleteStorageQuietly(receipt.originalStoragePath)
  await deleteStorageQuietly(receipt.ocrImageStoragePath)

  await deleteDoc(doc(db, collectionName, receipt.id))

  await recordScannerAuditEvent({
    eventType: 'hard_deleted_pre_timestamp',
    receiptId: receipt.id,
    version: receipt.version,
    actor,
    reason: String(reason),
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
  })
}

/** タイムスタンプ発行後の論理削除 */
export async function softDeleteIssuedScannerReceipt(input: {
  receipt: StoredAccountingReceipt
  actor: AuditActor
  reason: ScannerDeleteReason | string
}): Promise<void> {
  const { receipt, actor, reason } = input
  if (receipt.timestampStatus !== 'issued' && receipt.legalStatus !== 'accounting_confirmed') {
    // late_saved で issued の場合もある。issued 以外は hard delete 側へ。
    if (
      canHardDeleteScannerReceipt({
        legalStatus: receipt.legalStatus,
        timestampStatus: receipt.timestampStatus,
      })
    ) {
      throw new Error('タイムスタンプ未発行の証憑は完全削除を使用してください。')
    }
  }

  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  assertTransitionAccountingReceiptLegalStatus(
    receipt.legalStatus || 'legal_saved_accounting_pending',
    'deleted',
  )

  await updateDoc(doc(getFirestore(getFirebaseApp()), collectionName, receipt.id), {
    legalStatus: 'deleted',
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.userId,
    deleteReason: String(reason),
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
  })

  await recordScannerAuditEvent({
    eventType: 'deleted',
    receiptId: receipt.id,
    version: receipt.activeVersion || receipt.version,
    actor,
    reason: String(reason),
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
  })
}

export async function confirmScannerReceiptAccounting(input: {
  receipt: StoredAccountingReceipt
  expenseId: string
  actor: AuditActor
}): Promise<void> {
  const { receipt, expenseId, actor } = input
  if (!canPromoteToLegalSaved(receipt.timestampStatus) && receipt.legalStatus !== 'late_saved') {
    throw new Error('タイムスタンプ未検証のため経理確認済みへ進めません。')
  }
  if (
    receipt.legalStatus !== 'legal_saved_accounting_pending' &&
    receipt.legalStatus !== 'late_saved'
  ) {
    throw new Error('経理確認できる法定状態ではありません。')
  }

  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  assertTransitionAccountingReceiptLegalStatus(
    receipt.legalStatus,
    'accounting_confirmed',
  )

  await updateDoc(doc(getFirestore(getFirebaseApp()), collectionName, receipt.id), {
    legalStatus: 'accounting_confirmed',
    // 期限超過等で紙原本必須の場合はフラグを維持
    requiresPaperOriginal: receipt.requiresPaperOriginal === true,
    linkedExpenseId: expenseId,
    status: 'linked',
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
  })

  await recordScannerAuditEvent({
    eventType: 'accounting_linked',
    receiptId: receipt.id,
    version: receipt.activeVersion || receipt.version,
    actor,
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
    metadata: { expenseId },
  })
}

/**
 * 同一書類の再撮影。v2 master を追加し、タイムスタンプ発行完了まで active は v1 のまま。
 */
export async function createScannerReceiptVersion(input: {
  receipt: StoredAccountingReceipt
  legalMasterBlob: Blob
  thumbnailBlob: Blob
  widthPx: number
  heightPx: number
  estimatedDpi: number
  changeReason: string
  actor: AuditActor
}): Promise<{ version: number; legalMasterStoragePath: string; fileHash: string }> {
  const { receipt, actor } = input
  if (receipt.captureMode !== 'scanner_v1') {
    throw new Error('legacy 証憑には版を追加できません。新規スキャナ登録を行ってください。')
  }
  if (input.legalMasterBlob.size >= LEGAL_MASTER_MAX_BYTES) {
    throw new Error('保存画像が10MBを超えています。')
  }

  const nextVersion = Math.max(receipt.version || 1, receipt.activeVersion || 1) + 1
  const fileHash = await computeFileSha256(input.legalMasterBlob)
  const legalMasterStoragePath = buildLegalMasterStoragePath({
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
    receiptId: receipt.id,
    version: nextVersion,
  })
  const thumbIsWebp = input.thumbnailBlob.type === 'image/webp'
  const thumbnailStoragePath = buildLegalThumbnailStoragePath({
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
    receiptId: receipt.id,
    version: nextVersion,
    thumbExt: thumbIsWebp ? 'webp' : 'jpg',
  })

  if (!isReviewDemoRuntimeEnabled()) {
    const storage = getStorage(getFirebaseApp())
    await uploadBytes(ref(storage, legalMasterStoragePath), input.legalMasterBlob, {
      contentType: 'image/jpeg',
    })
    await uploadBytes(ref(storage, thumbnailStoragePath), input.thumbnailBlob, {
      contentType: thumbIsWebp ? 'image/webp' : 'image/jpeg',
    })

    const db = getFirestore(getFirebaseApp())
    await setDoc(
      doc(db, collectionName, receipt.id, 'versions', `v${nextVersion}`),
      removeUndefinedFields({
        version: nextVersion,
        previousVersion: receipt.activeVersion || receipt.version || 1,
        legalMasterStoragePath,
        thumbnailStoragePath,
        fileHash,
        legalWidthPx: input.widthPx,
        legalHeightPx: input.heightPx,
        estimatedDpi: input.estimatedDpi,
        timestampStatus: 'pending',
        changeReason: input.changeReason,
        isActive: false,
        createdAt: new Date().toISOString(),
        createdBy: actor.userId,
        franchiseeId: receipt.franchiseeId,
        storeId: receipt.storeId,
        companyId: receipt.franchiseeId,
      }),
    )

    // activeVersion はまだ旧版のまま。ポインタ更新は v2 の issued 後。
    await updateDoc(doc(db, collectionName, receipt.id), {
      version: nextVersion,
      previousVersionId: `v${receipt.activeVersion || receipt.version || 1}`,
      changeReason: input.changeReason,
      changedAt: new Date().toISOString(),
      changedBy: actor.userId,
      // 作業中フィールド（確定前）
      pendingVersion: nextVersion,
      pendingLegalMasterStoragePath: legalMasterStoragePath,
      pendingThumbnailStoragePath: thumbnailStoragePath,
      pendingFileHash: fileHash,
      updatedAt: serverTimestamp(),
      updatedBy: actor.userId,
    })
  }

  await recordScannerAuditEvent({
    eventType: 'version_created',
    receiptId: receipt.id,
    version: nextVersion,
    actor,
    reason: input.changeReason,
    franchiseeId: receipt.franchiseeId,
    storeId: receipt.storeId,
  })

  return { version: nextVersion, legalMasterStoragePath, fileHash }
}

/** vN のタイムスタンプ発行成功後に activeVersion を切替 */
export async function activateScannerReceiptVersion(input: {
  receiptId: string
  version: number
  actor: AuditActor
  franchiseeId: string
  storeId: string
}): Promise<void> {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }
  const db = getFirestore(getFirebaseApp())
  const versionRef = doc(db, collectionName, input.receiptId, 'versions', `v${input.version}`)
  const versionSnap = await getDoc(versionRef)
  if (!versionSnap.exists()) {
    throw new Error('版データが見つかりません。')
  }
  const versionData = versionSnap.data() as AccountingReceiptVersionRecord
  if (versionData.timestampStatus !== 'issued') {
    throw new Error('タイムスタンプ未発行の版は有効版にできません。')
  }

  const versions = await getDocs(
    query(collection(db, collectionName, input.receiptId, 'versions'), orderBy('version', 'asc')),
  )
  for (const item of versions.docs) {
    await updateDoc(item.ref, { isActive: item.id === `v${input.version}` })
  }

  await updateDoc(doc(db, collectionName, input.receiptId), {
    activeVersion: input.version,
    legalMasterStoragePath: versionData.legalMasterStoragePath,
    thumbnailStoragePath: versionData.thumbnailStoragePath || '',
    timestampTokenStoragePath: versionData.timestampTokenStoragePath || '',
    fileHash: versionData.fileHash,
    imageHash: versionData.fileHash,
    legalWidthPx: versionData.legalWidthPx,
    legalHeightPx: versionData.legalHeightPx,
    estimatedDpi: versionData.estimatedDpi,
    timestampStatus: versionData.timestampStatus,
    timestampProvider: versionData.timestampProvider || '',
    timestampTokenId: versionData.timestampTokenId || '',
    timestampedAt: versionData.timestampedAt || '',
    timestampVerifiedAt: versionData.timestampVerifiedAt || '',
    pendingVersion: null,
    pendingLegalMasterStoragePath: '',
    pendingThumbnailStoragePath: '',
    pendingFileHash: '',
    updatedAt: serverTimestamp(),
    updatedBy: input.actor.userId,
  })
}

export async function fetchScannerReceiptVersions(receiptId: string) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as AccountingReceiptVersionRecord[]
  }
  const snap = await getDocs(
    query(collection(getFirestore(getFirebaseApp()), collectionName, receiptId, 'versions'), orderBy('version', 'asc')),
  )
  return snap.docs.map((item) => item.data() as AccountingReceiptVersionRecord)
}
