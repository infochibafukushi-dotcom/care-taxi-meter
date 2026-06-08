#!/usr/bin/env node
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'

const CONFIRMATION = 'delete-dev-data'
const PAGE_SIZE = 300

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
  'caseRecords',
  'cases',
  'sales',
  'salesAggregates',
  'salesSummaries',
  'analyticsCache',
  'analyticsCaches',
  'caseCounters',
  'auditLogs',
]

const resetSummary = {
  deletedByCollection: {},
  preservedByCollection: {},
}

const textValue = (value) => (typeof value === 'string' ? value.trim() : '')

const isHeadquartersAdmin = (data) => {
  const name = textValue(data.name)
  const role = textValue(data.role)
  const userId = textValue(data.userId)

  return name === '山本信勝' && role === 'superAdmin' && (userId === 'admin' || userId === '')
}

const isHeadquartersStore = (data, documentId) => {
  const name = textValue(data.name || data.storeName)
  const storeId = textValue(data.id || data.storeId || documentId)

  return storeId === 'store_fc_headquarters' || name === 'FC本部'
}

const isHeadquartersTenant = (data, documentId) => {
  const tenantId = textValue(data.id || data.tenantId || data.franchiseeId || data.companyId || documentId)
  const name = textValue(data.name || data.tenantName || data.companyName)

  return ['default-franchisee', 'chiba-care-taxi'].includes(tenantId) || name === 'FC本部'
}

async function deleteQuerySnapshot(collectionName, querySnapshot) {
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

    deletedCount += await deleteQuerySnapshot(collectionName, snapshot)
  }

  resetSummary.deletedByCollection[collectionName] = deletedCount
}

async function deleteCollectionExcept(collectionName, shouldPreserve) {
  let deletedCount = 0
  const preservedDocumentIds = new Set()

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE)
      .get()

    if (snapshot.empty) {
      break
    }

    const batch = db.batch()
    let batchDeleteCount = 0

    snapshot.docs.forEach((documentSnapshot) => {
      if (shouldPreserve(documentSnapshot.data(), documentSnapshot.id)) {
        preservedDocumentIds.add(documentSnapshot.id)
        return
      }

      batch.delete(documentSnapshot.ref)
      batchDeleteCount += 1
    })

    if (batchDeleteCount > 0) {
      await batch.commit()
      deletedCount += batchDeleteCount
    }

    if (batchDeleteCount === 0) {
      break
    }
  }

  resetSummary.deletedByCollection[collectionName] = deletedCount
  resetSummary.preservedByCollection[collectionName] = preservedDocumentIds.size
}

for (const collectionName of fullDeleteCollections) {
  await deleteCollection(collectionName)
}

for (const collectionName of ['staffMembers', 'staff', 'users']) {
  await deleteCollectionExcept(collectionName, isHeadquartersAdmin)
}

await deleteCollectionExcept('stores', isHeadquartersStore)
await deleteCollectionExcept('tenants', isHeadquartersTenant)

console.log(JSON.stringify(resetSummary, null, 2))
