import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { defaultAdminStaffMemberId, defaultAdminStaffPassword, defaultAdminStaffUserId } from './staffMembers'
import { defaultCompany } from './companies'
import { headquartersStore } from './stores'

const resetBatchSize = 450

const resetCollections = [
  'auditLogs',
  'caseRecords',
  'workSessions',
  'meterSettings',
  'vehicles',
  'stores',
  'staffMembers',
  'companies',
]

type ResetSummary = {
  deletedByCollection: Record<string, number>
  recreatedDocuments: string[]
}

async function deleteCollection(collectionName: string) {
  const db = getFirestore(getFirebaseApp())
  let deletedCount = 0

  while (true) {
    const snapshots = await getDocs(
      query(collection(db, collectionName), orderBy('__name__'), limit(resetBatchSize)),
    )

    if (snapshots.empty) {
      return deletedCount
    }

    const batch = writeBatch(db)
    snapshots.docs.forEach((snapshot) => {
      batch.delete(snapshot.ref)
    })
    await batch.commit()
    deletedCount += snapshots.size
  }
}

async function recreateInitialData() {
  const db = getFirestore(getFirebaseApp())
  const recreatedDocuments = [
    `companies/${defaultCompany.id}`,
    `stores/${headquartersStore.id}`,
    `staffMembers/${defaultAdminStaffMemberId}`,
  ]

  await setDoc(doc(db, 'companies', defaultCompany.id), {
    ...defaultCompany,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'stores', headquartersStore.id), {
    ...headquartersStore,
    companyId: defaultCompany.id,
    franchiseeId: defaultCompany.id,
    storeName: headquartersStore.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'staffMembers', defaultAdminStaffMemberId), {
    id: defaultAdminStaffMemberId,
    companyId: defaultCompany.id,
    franchiseeId: defaultCompany.id,
    storeId: headquartersStore.id,
    storeName: headquartersStore.name,
    userId: defaultAdminStaffUserId,
    password: defaultAdminStaffPassword,
    name: defaultAdminStaffUserId,
    role: 'hq_admin',
    canDrive: false,
    isActive: true,
    phoneNumber: '',
    email: '',
    address: '',
    licenseNumber: '',
    licenseExpiresAt: '',
    accidentHistory: '',
    memo: 'FC本部初期管理者アカウント',
    enabled: true,
    sortOrder: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return recreatedDocuments
}

export async function resetHeadquartersDevelopmentData(): Promise<ResetSummary> {
  const deletedByCollection: ResetSummary['deletedByCollection'] = {}

  for (const collectionName of resetCollections) {
    deletedByCollection[collectionName] = await deleteCollection(collectionName)
  }

  const recreatedDocuments = await recreateInitialData()

  return {
    deletedByCollection,
    recreatedDocuments,
  }
}
