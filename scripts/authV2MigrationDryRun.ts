#!/usr/bin/env node
/**
 * Auth V2 migration dry-run (READ ONLY).
 *
 * - Never writes to Firestore / Auth
 * - Never prints passwords, names, phones, emails
 * - Refuses to run if DRY_RUN=false
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=care-taxi-meter npx tsx scripts/authV2MigrationDryRun.ts
 */
import { createHash } from 'node:crypto'
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const FORBIDDEN_WRITE = process.env.DRY_RUN === 'false'
if (FORBIDDEN_WRITE) {
  console.error('Refusing to run: DRY_RUN=false is forbidden for this script.')
  process.exit(2)
}

const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'care-taxi-meter'

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
const normalizeLoginIdentifier = (value: string) => value.replace(/[\s\u3000]+/g, '')
const hasNonEmptyPassword = (value: unknown) => {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' && Number.isFinite(value)) return true
  return false
}

const bump = (map: Record<string, number>, key: string) => {
  map[key] = (map[key] || 0) + 1
}

type SkipReason =
  | 'missing_plaintext_password'
  | 'missing_company_id'
  | 'missing_store_id'
  | 'missing_user_id'
  | 'staff_disabled'
  | 'company_inactive'
  | 'duplicate_user_id_in_company'
  | 'company_not_found'

async function main() {
  initializeFirebaseApp()
  const db = getFirestore()

  const [staffSnap, companySnap] = await Promise.all([
    db.collection('staffMembers').get(),
    db.collection('companies').get(),
  ])

  const companies = new Map<
    string,
    { enabled: boolean; status: string; hasRepPassword: boolean }
  >()
  let companiesWithRepPassword = 0

  for (const doc of companySnap.docs) {
    const data = doc.data()
    const hasRepPassword =
      hasNonEmptyPassword(data.representativeInitialPassword) ||
      hasNonEmptyPassword(data.ownerPassword) ||
      hasNonEmptyPassword(data.initialPassword)
    if (hasRepPassword) companiesWithRepPassword += 1
    companies.set(doc.id, {
      enabled: data.enabled !== false,
      status: toStringValue(data.status) || 'active',
      hasRepPassword,
    })
  }

  const byRole: Record<string, number> = {}
  const byCompany: Record<string, number> = {}
  const byStore: Record<string, number> = {}
  const skipReasons: Record<string, number> = {}
  const userIdBuckets = new Map<string, string[]>()

  let totalStaff = 0
  let withPlainPassword = 0
  let missingCompanyId = 0
  let missingStoreId = 0
  let missingStaffId = 0
  let disabledStaff = 0
  let inactiveCompanyStaff = 0
  let migratable = 0

  for (const doc of staffSnap.docs) {
    totalStaff += 1
    const data = doc.data()
    const staffId = toStringValue(data.id) || doc.id
    if (!staffId) missingStaffId += 1

    const companyId = toStringValue(data.franchiseeId) || toStringValue(data.companyId)
    const storeId = toStringValue(data.storeId)
    const role = toStringValue(data.role) || 'driver'
    const enabled = data.enabled !== false && data.isActive !== false
    const userId = toStringValue(data.userId) || toStringValue(data.loginId)
    const normalizedUserId = normalizeLoginIdentifier(userId)
    const hasPassword = hasNonEmptyPassword(data.password)

    bump(byRole, role)
    bump(byCompany, companyId || '(missing)')
    bump(byStore, storeId || '(missing)')

    if (hasPassword) withPlainPassword += 1
    if (!companyId) missingCompanyId += 1
    if (!storeId) missingStoreId += 1
    if (!enabled) disabledStaff += 1

    const company = companyId ? companies.get(companyId) : undefined
    const companyInactive =
      !company ||
      company.enabled === false ||
      ['suspended', 'terminated', 'archived', 'ending'].includes(company.status.toLowerCase())
    if (companyInactive) inactiveCompanyStaff += 1

    if (companyId && normalizedUserId) {
      const key = `${companyId}\0${normalizedUserId}`
      const list = userIdBuckets.get(key) || []
      list.push(staffId)
      userIdBuckets.set(key, list)
    }
  }

  const duplicateUserIdGroups = [...userIdBuckets.values()].filter((ids) => ids.length > 1)
  const duplicateUserIdStaffCount = duplicateUserIdGroups.reduce((sum, ids) => sum + ids.length, 0)
  const duplicateStaffIds = new Set(duplicateUserIdGroups.flat())

  for (const doc of staffSnap.docs) {
    const data = doc.data()
    const staffId = toStringValue(data.id) || doc.id
    const companyId = toStringValue(data.franchiseeId) || toStringValue(data.companyId)
    const storeId = toStringValue(data.storeId)
    const userId = toStringValue(data.userId) || toStringValue(data.loginId)
    const enabled = data.enabled !== false && data.isActive !== false
    const hasPassword = hasNonEmptyPassword(data.password)
    const company = companyId ? companies.get(companyId) : undefined
    const companyInactive =
      !company ||
      company.enabled === false ||
      ['suspended', 'terminated', 'archived', 'ending'].includes((company.status || '').toLowerCase())

    const reasons: SkipReason[] = []
    if (!hasPassword) reasons.push('missing_plaintext_password')
    if (!companyId) reasons.push('missing_company_id')
    if (!storeId) reasons.push('missing_store_id')
    if (!normalizeLoginIdentifier(userId)) reasons.push('missing_user_id')
    if (!enabled) reasons.push('staff_disabled')
    if (!company) reasons.push('company_not_found')
    else if (companyInactive) reasons.push('company_inactive')
    if (duplicateStaffIds.has(staffId)) reasons.push('duplicate_user_id_in_company')

    if (reasons.length === 0) {
      migratable += 1
    } else {
      for (const reason of reasons) bump(skipReasons, reason)
    }
  }

  const report = {
    dryRun: true,
    projectId,
    generatedAt: new Date().toISOString(),
    companies: {
      total: companySnap.size,
      withRepresentativePasswordField: companiesWithRepPassword,
    },
    staffMembers: {
      total: totalStaff,
      withPlaintextPassword: withPlainPassword,
      missingCompanyId,
      missingStoreId,
      missingStaffId,
      disabledStaff,
      inactiveCompanyStaff,
      byRole,
      byCompanyCount: Object.keys(byCompany).length,
      byStoreCount: Object.keys(byStore).length,
      companyIdHashSample: Object.keys(byCompany)
        .slice(0, 5)
        .map((id) => ({
          companyIdHash: createHash('sha256').update(id).digest('hex').slice(0, 10),
          count: byCompany[id],
        })),
    },
    duplicates: {
      duplicateUserIdGroups: duplicateUserIdGroups.length,
      duplicateUserIdStaffCount,
    },
    migration: {
      autoMigratable: migratable,
      notAutoMigratable: totalStaff - migratable,
      skipReasonCounts: skipReasons,
      note: 'autoMigratable means plaintext password + tenant ids present; no Auth users are created by this script.',
    },
    authV2FlagsExpectedInProduction: {
      AUTH_V2_ENABLED: false,
      AUTH_V2_ENFORCE: false,
    },
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error('Dry-run failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
