#!/usr/bin/env node
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'

const CONFIRMATION = 'delete-dev-data'
const PAGE_SIZE = 300
const DEFAULT_FRANCHISEE_ID = 'default-franchisee'
const HEADQUARTERS_STORE_ID = 'store_fc_headquarters'
const DEFAULT_ADMIN_STAFF_ID = 'staff_admin'
const DEFAULT_ADMIN_NAME = '山本信勝'
const DEFAULT_ADMIN_PASSWORD = '123'

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
const confirmation = process.env.CONFIRM_RESET_DEVELOPMENT_DATA

if (confirmation !== CONFIRMATION) {
  console.error(
    `Refusing to reset data. Set CONFIRM_RESET_DEVELOPMENT_DATA=${CONFIRMATION} to continue.`,
  )
  process.exit(1)
}

function credentialFromEnvironment() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson))
  }

  return applicationDefault()
}

if (getApps().length === 0) {
  initializeApp({
    credential: credentialFromEnvironment(),
    ...(projectId ? { projectId } : {}),
  })
}

const db = getFirestore()

const fullDeleteCollections = [
  'auditLogs',
  'caseRecords',
  'workSessions',
  'meterSettings',
  'vehicles',
  'stores',
  'staffMembers',
  'companies',
]

const resetSummary = {
  deletedByCollection: {},
  recreatedDocuments: [],
}

async function deleteQuerySnapshot(querySnapshot) {
  if (querySnapshot.empty) {
    return 0
  }

  const batch = db.batch()
  querySnapshot.docs.forEach((documentSnapshot) => {
    batch.delete(documentSnapshot.ref)
  })
  await batch.commit()
  return querySnapshot.size
}

async function deleteCollection(collectionName) {
  let deletedCount = 0

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE)
      .get()

    if (snapshot.empty) {
      break
    }

    deletedCount += await deleteQuerySnapshot(snapshot)
  }

  resetSummary.deletedByCollection[collectionName] = deletedCount
}

async function recreateInitialData() {
  const now = new Date().toISOString()
  const serverNow = new Date()

  await db.collection('companies').doc(DEFAULT_FRANCHISEE_ID).set({
    id: DEFAULT_FRANCHISEE_ID,
    name: 'FC本部',
    enabled: true,
    sortOrder: 1,
    ownerName: DEFAULT_ADMIN_NAME,
    phoneNumber: '',
    email: '',
    address: '',
    memo: '',
    createdAt: serverNow,
    updatedAt: serverNow,
  })
  resetSummary.recreatedDocuments.push(`companies/${DEFAULT_FRANCHISEE_ID}`)

  await db.collection('stores').doc(HEADQUARTERS_STORE_ID).set({
    id: HEADQUARTERS_STORE_ID,
    companyId: DEFAULT_FRANCHISEE_ID,
    franchiseeId: DEFAULT_FRANCHISEE_ID,
    name: 'FC本部',
    storeName: 'FC本部',
    status: 'active',
    enabled: true,
    isActive: true,
    sortOrder: 0,
    createdAt: serverNow,
    updatedAt: serverNow,
  })
  resetSummary.recreatedDocuments.push(`stores/${HEADQUARTERS_STORE_ID}`)

  await db.collection('staffMembers').doc(DEFAULT_ADMIN_STAFF_ID).set({
    id: DEFAULT_ADMIN_STAFF_ID,
    companyId: DEFAULT_FRANCHISEE_ID,
    franchiseeId: DEFAULT_FRANCHISEE_ID,
    storeId: HEADQUARTERS_STORE_ID,
    storeName: 'FC本部',
    userId: DEFAULT_ADMIN_NAME,
    password: DEFAULT_ADMIN_PASSWORD,
    name: DEFAULT_ADMIN_NAME,
    role: 'superAdmin',
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
    createdAt: serverNow,
    updatedAt: serverNow,
    resetAt: now,
  })
  resetSummary.recreatedDocuments.push(`staffMembers/${DEFAULT_ADMIN_STAFF_ID}`)
}

for (const collectionName of fullDeleteCollections) {
  await deleteCollection(collectionName)
}

await recreateInitialData()

console.log(JSON.stringify(resetSummary, null, 2))
