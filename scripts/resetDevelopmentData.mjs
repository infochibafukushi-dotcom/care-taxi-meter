#!/usr/bin/env node
/**
 * Development Firestore reset CLI (fail-closed).
 * Never run against production. Requires explicit env flags + confirm + bootstrap password.
 */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import {
  assertCliDevelopmentResetAllowed,
  buildDevelopmentResetConfirmText,
  validateBootstrapAdminPassword,
} from './lib/developmentResetGuard.mjs'

const PAGE_SIZE = 300
const DEFAULT_FRANCHISEE_ID = 'default-franchisee'
const HEADQUARTERS_STORE_ID = 'store_fc_headquarters'
const DEFAULT_ADMIN_STAFF_ID = 'staff_admin'
const DEFAULT_ADMIN_NAME = '山本信勝'

let projectId
let bootstrapAdminPassword
try {
  projectId = assertCliDevelopmentResetAllowed(process.env)
  const passwordCheck = validateBootstrapAdminPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD)
  if (!passwordCheck.ok) {
    throw new Error(passwordCheck.message)
  }
  bootstrapAdminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(
    [
      'Required (development only):',
      '  FIREBASE_PROJECT_ID=<dev-project-id>',
      '  DEV_RESET_ENABLED=true',
      '  DEV_RESET_ALLOWED_PROJECT_IDS=<comma-separated allowlist including FIREBASE_PROJECT_ID>',
      `  CONFIRM_RESET_DEVELOPMENT_DATA=${buildDevelopmentResetConfirmText('<project-id>')}`,
      '  ADMIN_BOOTSTRAP_PASSWORD=<12+ chars with letters and digits>',
      'Refuse when CI=true. Never set these for production project care-taxi-meter.',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`Target Firebase project ID: ${projectId}`)
console.log('This is a destructive development reset and cannot be undone.')

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
    projectId,
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
  projectId,
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

async function recreateInitialData(adminPassword) {
  const now = new Date().toISOString()
  const serverNow = new Date()

  await db.collection('companies').doc(DEFAULT_FRANCHISEE_ID).set({
    id: DEFAULT_FRANCHISEE_ID,
    name: '株式会社千葉福祉サポート',
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
    name: '株式会社千葉福祉サポート',
    storeName: '株式会社千葉福祉サポート',
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
    storeName: '株式会社千葉福祉サポート',
    userId: DEFAULT_ADMIN_NAME,
    password: adminPassword,
    name: DEFAULT_ADMIN_NAME,
    role: 'hq_admin',
    canDrive: false,
    isActive: true,
    phoneNumber: '',
    email: '',
    address: '',
    licenseNumber: '',
    licenseExpiresAt: '',
    accidentHistory: '',
    memo: '株式会社千葉福祉サポート初期管理者アカウント（CLI開発リセットで再作成）',
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

await recreateInitialData(bootstrapAdminPassword)

console.log(JSON.stringify(resetSummary, null, 2))
console.log('Bootstrap admin password was set from ADMIN_BOOTSTRAP_PASSWORD (value not logged).')
