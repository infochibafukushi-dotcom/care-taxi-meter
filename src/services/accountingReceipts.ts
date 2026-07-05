import {
  addDoc,
  collection,
  doc,
  getFirestore,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type { AccountingReceiptInput, ReceiptStatus, StoredAccountingReceipt } from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { resolveAccountingTenantFields } from './accountingTenant'

const collectionName = 'accountingReceipts'

export async function uploadAccountingReceiptImage({
  file,
  franchiseeId,
  storeId,
  uploadedBy,
  uploadedByName,
}: {
  file: File
  franchiseeId: string
  storeId: string
  uploadedBy: string
  uploadedByName: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return {
      receiptId: 'review-demo-receipt',
      downloadUrl: '',
      storagePath: '',
    }
  }

  const db = getFirestore(getFirebaseApp())
  const receiptRef = await addDoc(collection(db, collectionName), {
    ...resolveAccountingTenantFields({ franchiseeId, storeId }),
    storagePath: '',
    downloadUrl: '',
    mimeType: file.type || 'application/octet-stream',
    fileName: file.name,
    fileSizeBytes: file.size,
    status: 'active' satisfies ReceiptStatus,
    uploadedBy,
    uploadedByName,
    createdAt: serverTimestamp(),
  })

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
  })

  return {
    receiptId: receiptRef.id,
    downloadUrl,
    storagePath,
  }
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
    status: 'invalidated' satisfies ReceiptStatus,
    invalidatedAt: new Date().toISOString(),
  })
}

export type { AccountingReceiptInput, StoredAccountingReceipt }
