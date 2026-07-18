#!/usr/bin/env node
/**
 * Auth V2 production migration (writes credentials + Auth users).
 *
 * Required:
 *   CONFIRM_MIGRATE_AUTH_V2=MIGRATE-AUTH-V2-4
 *   FIREBASE_PROJECT_ID=care-taxi-meter
 *
 * Safety:
 *   - Aborts unless exactly 4 migratable staff exist
 *   - Does NOT delete staffMembers.password or company password fields
 *   - Does NOT set AUTH_V2_ENFORCE
 *   - Never prints password plaintext, names, phones, or emails
 */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { hashPassword } from '../functions/src/passwordCrypto'
import { buildStaffCustomClaims } from '../functions/src/staffClaims'
import {
  STAFF_CREDENTIALS_COLLECTION,
  buildCredentialId,
  normalizeLoginIdentifier,
} from '../functions/src/staffCredentials'

const EXPECTED_COUNT = 4
const REQUIRED_CONFIRM = 'MIGRATE-AUTH-V2-4'

const confirm = String(process.env.CONFIRM_MIGRATE_AUTH_V2 || '').trim()
if (confirm !== REQUIRED_CONFIRM) {
  console.error(
    `Refusing to migrate. Set CONFIRM_MIGRATE_AUTH_V2=${REQUIRED_CONFIRM} (got empty or mismatch).`,
  )
  process.exit(2)
}

if (process.env.AUTH_V2_ENFORCE === 'true') {
  console.error('Refusing to migrate while AUTH_V2_ENFORCE=true.')
  process.exit(2)
}

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'care-taxi-meter'

function credentialFromEnvironment() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson) as Record<string, string>)
  }
  return applicationDefault()
}

function initializeFirebaseApp() {
  if (getApps().length === 0) {
    initializeApp({
      credential: credentialFromEnvironment(),
      projectId,
    })
  }
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const toPasswordValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
const toRole = (value: unknown): 'driver' | 'manager' | 'owner' | 'hq_admin' => {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

type MigrateTarget = {
  staffId: string
  companyId: string
  franchiseeId: string
  storeId: string
  role: 'driver' | 'manager' | 'owner' | 'hq_admin'
  normalizedUserId: string
  plaintextPassword: string
}

async function main() {
  initializeFirebaseApp()
  const db = getFirestore()
  const auth = getAuth()

  const staffSnap = await db.collection('staffMembers').get()
  const companySnap = await db.collection('companies').get()
  const companyIds = new Set(companySnap.docs.map((doc) => doc.id))

  const staffIdSet = new Set<string>()
  let duplicateStaffIds = 0
  const targets: MigrateTarget[] = []
  const skipped: Array<{ staffIdHash: string; reason: string }> = []

  for (const doc of staffSnap.docs) {
    const data = doc.data()
    const staffId = toStringValue(data.id) || doc.id
    if (staffIdSet.has(staffId)) duplicateStaffIds += 1
    staffIdSet.add(staffId)

    const companyId = toStringValue(data.franchiseeId) || toStringValue(data.companyId)
    const storeId = toStringValue(data.storeId)
    const userId = toStringValue(data.userId) || toStringValue(data.loginId)
    const normalizedUserId = normalizeLoginIdentifier(userId)
    const password = toPasswordValue(data.password)
    const enabled = data.enabled !== false && data.isActive !== false
    const role = toRole(data.role)
    const staffIdHash = staffId.slice(0, 8)

    if (!password) {
      skipped.push({ staffIdHash, reason: 'missing_plaintext_password' })
      continue
    }
    if (!companyId || !companyIds.has(companyId)) {
      skipped.push({ staffIdHash, reason: 'invalid_company' })
      continue
    }
    if (!storeId || !normalizedUserId || !enabled) {
      skipped.push({
        staffIdHash,
        reason: !storeId ? 'missing_store' : !normalizedUserId ? 'missing_user' : 'disabled',
      })
      continue
    }

    targets.push({
      staffId,
      companyId,
      franchiseeId: companyId,
      storeId,
      role,
      normalizedUserId,
      plaintextPassword: password,
    })
  }

  if (duplicateStaffIds > 0) {
    console.error(`Abort: duplicate staffId values detected (count=${duplicateStaffIds}).`)
    process.exit(3)
  }

  if (targets.length !== EXPECTED_COUNT) {
    console.error(
      JSON.stringify(
        {
          abort: true,
          expected: EXPECTED_COUNT,
          found: targets.length,
          skipped,
          message: 'Target count is not 4. Migration stopped.',
        },
        null,
        2,
      ),
    )
    process.exit(4)
  }

  // Credential id collision check (doc id = staffId)
  const credentialIds = targets.map((t) => buildCredentialId(t.staffId))
  if (new Set(credentialIds).size !== credentialIds.length) {
    console.error('Abort: staffCredentials document id collision among targets.')
    process.exit(5)
  }

  const results: Array<Record<string, unknown>> = []
  let successCount = 0
  let authCreated = 0
  let authExisting = 0
  let failedCount = 0

  for (const target of targets) {
    const credentialId = buildCredentialId(target.staffId)
    try {
      const existingCred = await db.collection(STAFF_CREDENTIALS_COLLECTION).doc(credentialId).get()
      const hashed = await hashPassword(target.plaintextPassword)
      const now = new Date()

      await db
        .collection(STAFF_CREDENTIALS_COLLECTION)
        .doc(credentialId)
        .set(
          {
            companyId: target.companyId,
            franchiseeId: target.franchiseeId,
            storeId: target.storeId,
            staffId: target.staffId,
            normalizedUserId: target.normalizedUserId,
            passwordHash: hashed.passwordHash,
            passwordSalt: hashed.passwordSalt,
            hashAlgorithm: hashed.hashAlgorithm,
            hashParameters: hashed.hashParameters,
            authUid: target.staffId,
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: now,
            updatedAt: now,
            ...(existingCred.exists ? {} : { createdAt: now }),
          },
          { merge: true },
        )

      const claims = buildStaffCustomClaims({
        id: target.staffId,
        companyId: target.companyId,
        franchiseeId: target.franchiseeId,
        storeId: target.storeId,
        role: target.role,
      })

      let authStatus: 'created' | 'existing' = 'existing'
      try {
        await auth.getUser(target.staffId)
        authExisting += 1
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'auth/user-not-found') {
          throw error
        }
        await auth.createUser({
          uid: target.staffId,
          disabled: false,
        })
        authCreated += 1
        authStatus = 'created'
      }

      await auth.setCustomUserClaims(target.staffId, claims)

      successCount += 1
      results.push({
        staffIdHash: target.staffId.slice(0, 8),
        status: 'success',
        credentialIdHash: credentialId.slice(0, 8),
        authStatus,
        claims: {
          role: claims.role,
          hasCompanyId: Boolean(claims.companyId),
          hasStoreId: Boolean(claims.storeId),
          hasStaffId: Boolean(claims.staffId),
        },
        plaintextPasswordDeleted: false,
      })
    } catch (error) {
      failedCount += 1
      results.push({
        staffIdHash: target.staffId.slice(0, 8),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        projectId,
        confirm: REQUIRED_CONFIRM,
        expected: EXPECTED_COUNT,
        successCount,
        failedCount,
        authCreated,
        authExisting,
        plaintextFieldsPreserved: true,
        AUTH_V2_ENFORCE: false,
        results,
      },
      null,
      2,
    ),
  )

  if (failedCount > 0) {
    process.exit(6)
  }
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
