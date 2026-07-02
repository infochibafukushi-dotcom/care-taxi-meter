#!/usr/bin/env node
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'

const DEFAULT_FRANCHISEE_ID = 'default-franchisee'
const HQ_STORE_ID = 'store_fc_headquarters'
const DEFAULT_STORE_ID = 'default-store'
const TARGET_STORE_NAME = 'ちばケアタクシー'
const OWNER_LOGIN_ID = '山本信勝'
const CHIBA_PATTERNS = ['ちばケアタクシー', 'ちばケア', 'chiba-care', 'chibacare']
const HQ_COMPANY_NAME = '株式会社千葉福祉サポート'
const PAGE_SIZE = 300

const TARGET_COLLECTIONS = [
  'staffMembers',
  'vehicles',
  'workSessions',
  'staffAttendance',
  'caseRecords',
  'meterSettings',
  'caseCounters',
  'stores',
] as const

type TargetCollection = (typeof TARGET_COLLECTIONS)[number]

type CompanyRecord = {
  id: string
  name: string
  corporateName: string
  tradeName: string
}

type StoreRecord = {
  id: string
  companyId: string
  franchiseeId: string
  name: string
  storeName: string
  companyName: string
}

type RepairTarget = {
  franchiseeId: string
  storeId: string
  storeName: string
  company: CompanyRecord
  store: StoreRecord
}

type SkipReason =
  | 'hq_admin_role'
  | 'hq_franchisee'
  | 'hq_store'
  | 'conflicting_tenant_ids'
  | 'other_franchisee'
  | 'other_store'
  | 'ambiguous'
  | 'already_ok'

type CollectionStats = {
  checked: number
  updatePlanned: number
  skipped: number
  skipReasons: Partial<Record<SkipReason, number>>
  plannedChanges: Array<{
    path: string
    fields: string[]
    reason: string
  }>
  skipSamples: Array<{
    path: string
    reason: SkipReason
    detail: string
  }>
}

const dryRun = process.env.DRY_RUN !== 'false'

const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT

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
      ...(projectId ? { projectId } : {}),
    })
  }
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeForMatch = (value: string) => value.trim().toLowerCase()

const matchesChibaPattern = (value: string) => {
  const normalized = normalizeForMatch(value)
  if (!normalized) {
    return false
  }

  return CHIBA_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()))
}

const docFranchiseeId = (data: Record<string, unknown>) =>
  toStringValue(data.franchiseeId) || toStringValue(data.companyId)

const docStoreId = (data: Record<string, unknown>) => toStringValue(data.storeId)

const docStoreName = (data: Record<string, unknown>) =>
  toStringValue(data.storeName) || toStringValue(data.name)

const isHqFranchiseeId = (franchiseeId: string) => franchiseeId === DEFAULT_FRANCHISEE_ID

const isHqStoreId = (storeId: string) =>
  storeId === HQ_STORE_ID || (storeId === DEFAULT_STORE_ID && isHqFranchiseeId(DEFAULT_FRANCHISEE_ID))

function toCompany(id: string, data: Record<string, unknown>): CompanyRecord {
  return {
    id,
    name: toStringValue(data.name),
    corporateName: toStringValue(data.corporateName),
    tradeName: toStringValue(data.tradeName),
  }
}

function toStore(id: string, data: Record<string, unknown>): StoreRecord {
  return {
    id,
    companyId: toStringValue(data.companyId),
    franchiseeId: toStringValue(data.franchiseeId) || toStringValue(data.companyId),
    name: toStringValue(data.name),
    storeName: toStringValue(data.storeName) || toStringValue(data.name),
    companyName: toStringValue(data.companyName),
  }
}

function companyMatchesChiba(company: CompanyRecord) {
  return [company.id, company.name, company.corporateName, company.tradeName].some((value) =>
    matchesChibaPattern(value),
  )
}

function isHeadquartersCompany(company: CompanyRecord) {
  if (company.id === DEFAULT_FRANCHISEE_ID) {
    return true
  }

  const labels = [company.name, company.corporateName, company.tradeName]
  const matchesHqName = labels.some((value) => value === HQ_COMPANY_NAME)
  const matchesChiba = companyMatchesChiba(company)

  return matchesHqName && !matchesChiba
}

function storeMatchesChiba(store: StoreRecord) {
  return [store.name, store.storeName, store.companyName].some((value) => matchesChibaPattern(value))
}

async function loadCompanies(db: Firestore) {
  const snapshot = await db.collection('companies').orderBy('sortOrder', 'asc').get()
  return snapshot.docs.map((document) => toCompany(document.id, document.data()))
}

async function loadStores(db: Firestore) {
  const snapshot = await db.collection('stores').orderBy('sortOrder', 'asc').get()
  return snapshot.docs.map((document) => toStore(document.id, document.data()))
}

function resolveRepairTarget(companies: CompanyRecord[], stores: StoreRecord[]): RepairTarget {
  const chibaCompanies = companies.filter(
    (company) => companyMatchesChiba(company) && !isHeadquartersCompany(company),
  )

  if (chibaCompanies.length === 0) {
    throw new Error(
      'ちばケアタクシーに一致する会社が見つかりません。companies の name / tradeName / corporateName を確認してください。',
    )
  }

  if (chibaCompanies.length > 1) {
    const ids = chibaCompanies.map((company) => company.id).join(', ')
    throw new Error(`ちばケアタクシー会社候補が複数あります。手動で対象を特定してください: ${ids}`)
  }

  const company = chibaCompanies[0]
  const franchiseStores = stores.filter((store) => store.franchiseeId === company.id || store.companyId === company.id)
  const chibaStores = franchiseStores.filter((store) => storeMatchesChiba(store) && !isHqStoreId(store.id))

  let store: StoreRecord | undefined

  if (chibaStores.length === 1) {
    store = chibaStores[0]
  } else if (chibaStores.length > 1) {
    const exactNameStore = chibaStores.find(
      (candidate) =>
        candidate.name === TARGET_STORE_NAME ||
        candidate.storeName === TARGET_STORE_NAME ||
        candidate.companyName === TARGET_STORE_NAME,
    )
    if (!exactNameStore) {
      const ids = chibaStores.map((candidate) => candidate.id).join(', ')
      throw new Error(`ちばケアタクシー店舗候補が複数あります。手動で対象を特定してください: ${ids}`)
    }
    store = exactNameStore
  } else {
    const nonHqStores = franchiseStores.filter((candidate) => !isHqStoreId(candidate.id))
    if (nonHqStores.length === 1) {
      store = nonHqStores[0]
      console.warn(
        `[repair] warning: 店舗名に「ちばケアタクシー」が無いため、franchisee 配下の唯一の店舗を採用します: ${store.id}`,
      )
    }
  }

  if (!store) {
    throw new Error(
      `franchiseeId=${company.id} 配下に補正対象の店舗が見つかりません。stores を確認してください。`,
    )
  }

  return {
    franchiseeId: company.id,
    storeId: store.id,
    storeName: store.storeName || store.name || TARGET_STORE_NAME,
    company,
    store,
  }
}

function hasConflictingTenantIds(data: Record<string, unknown>) {
  const franchiseeId = toStringValue(data.franchiseeId)
  const companyId = toStringValue(data.companyId)

  return Boolean(franchiseeId && companyId && franchiseeId !== companyId)
}

function belongsToTargetFranchisee(data: Record<string, unknown>, target: RepairTarget) {
  const franchiseeId = docFranchiseeId(data)
  return franchiseeId === target.franchiseeId
}

function belongsToTargetStore(data: Record<string, unknown>, target: RepairTarget) {
  const storeId = docStoreId(data)
  return storeId === target.storeId
}

function hasChibaStoreHint(data: Record<string, unknown>) {
  return matchesChibaPattern(docStoreName(data))
}

function isLikelyChibaDocument(
  data: Record<string, unknown>,
  target: RepairTarget,
  collectionName: TargetCollection,
  documentId: string,
) {
  if (collectionName === 'stores' && documentId === target.storeId) {
    return true
  }

  if (collectionName === 'meterSettings' && documentId === `${target.franchiseeId}_${target.storeId}`) {
    return true
  }

  if (collectionName === 'caseCounters' && documentId.startsWith(`${target.storeId}_`)) {
    return true
  }

  if (belongsToTargetFranchisee(data, target) || belongsToTargetStore(data, target)) {
    return true
  }

  const franchiseeId = docFranchiseeId(data)
  const storeId = docStoreId(data)

  if (!franchiseeId && !storeId && hasChibaStoreHint(data)) {
    return true
  }

  if (franchiseeId === target.franchiseeId && !storeId) {
    return true
  }

  if (!franchiseeId && storeId === target.storeId) {
    return true
  }

  return false
}

function classifyDocument(
  data: Record<string, unknown>,
  target: RepairTarget,
  collectionName: TargetCollection,
  documentId: string,
): { action: 'repair' | 'skip'; reason?: SkipReason; detail?: string } {
  const role = toStringValue(data.role)
  const franchiseeId = toStringValue(data.franchiseeId)
  const companyId = toStringValue(data.companyId)
  const storeId = docStoreId(data)
  const resolvedFranchisee = docFranchiseeId(data)

  if (collectionName === 'staffMembers' && (role === 'hq_admin' || role === 'superAdmin')) {
    return { action: 'skip', reason: 'hq_admin_role', detail: `role=${role}` }
  }

  if (isHqFranchiseeId(franchiseeId) || isHqFranchiseeId(companyId) || isHqFranchiseeId(resolvedFranchisee)) {
    return { action: 'skip', reason: 'hq_franchisee', detail: `franchisee=${resolvedFranchisee || 'empty'}` }
  }

  if (storeId && isHqStoreId(storeId)) {
    return { action: 'skip', reason: 'hq_store', detail: `storeId=${storeId}` }
  }

  if (hasConflictingTenantIds(data)) {
    return {
      action: 'skip',
      reason: 'conflicting_tenant_ids',
      detail: `franchiseeId=${franchiseeId}, companyId=${companyId}`,
    }
  }

  if (resolvedFranchisee && resolvedFranchisee !== target.franchiseeId) {
    return {
      action: 'skip',
      reason: 'other_franchisee',
      detail: `franchisee=${resolvedFranchisee}`,
    }
  }

  if (storeId && storeId !== target.storeId) {
    if (!(collectionName === 'stores' && documentId === target.storeId)) {
      return { action: 'skip', reason: 'other_store', detail: `storeId=${storeId}` }
    }
  }

  if (!isLikelyChibaDocument(data, target, collectionName, documentId)) {
    return { action: 'skip', reason: 'ambiguous', detail: 'ちばケアタクシー所属と判定できません' }
  }

  const patch = buildRepairPatch(data, target, collectionName, documentId)
  if (!patch) {
    return { action: 'skip', reason: 'already_ok', detail: 'tenant fields は既に整合しています' }
  }

  return { action: 'repair' }
}

function buildRepairPatch(
  data: Record<string, unknown>,
  target: RepairTarget,
  collectionName: TargetCollection,
  documentId: string,
): Record<string, string> | null {
  const patch: Record<string, string> = {}

  const franchiseeId = toStringValue(data.franchiseeId)
  const companyId = toStringValue(data.companyId)
  const storeId = docStoreId(data)
  const storeName = docStoreName(data)

  if (!franchiseeId && companyId === target.franchiseeId) {
    patch.franchiseeId = target.franchiseeId
  }

  if (!companyId && franchiseeId === target.franchiseeId) {
    patch.companyId = target.franchiseeId
  }

  if (!franchiseeId && !companyId && isLikelyChibaDocument(data, target, collectionName, documentId)) {
    patch.franchiseeId = target.franchiseeId
    patch.companyId = target.franchiseeId
  }

  if (!storeId && isLikelyChibaDocument(data, target, collectionName, documentId)) {
    patch.storeId = collectionName === 'stores' ? documentId : target.storeId
  }

  const effectiveStoreId = patch.storeId || storeId || (collectionName === 'stores' ? documentId : '')
  if (!storeName && effectiveStoreId === target.storeId) {
    patch.storeName = target.storeName
  }

  return Object.keys(patch).length > 0 ? patch : null
}

function describePatch(patch: Record<string, string>) {
  return Object.entries(patch)
    .map(([field, value]) => `${field}=${value}`)
    .join(', ')
}

function createCollectionStats(): CollectionStats {
  return {
    checked: 0,
    updatePlanned: 0,
    skipped: 0,
    skipReasons: {},
    plannedChanges: [],
    skipSamples: [],
  }
}

function recordSkip(stats: CollectionStats, path: string, reason: SkipReason, detail: string) {
  stats.skipped += 1
  stats.skipReasons[reason] = (stats.skipReasons[reason] ?? 0) + 1

  if (stats.skipSamples.length < 5) {
    stats.skipSamples.push({ path, reason, detail })
  }
}

async function fetchAllDocuments(db: Firestore, collectionName: TargetCollection) {
  const documents: Array<{ id: string; data: Record<string, unknown> }> = []

  let lastDocumentId: string | undefined
  while (true) {
    let query = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
    if (lastDocumentId) {
      query = query.startAfter(lastDocumentId)
    }

    const snapshot = await query.get()
    if (snapshot.empty) {
      break
    }

    snapshot.docs.forEach((document) => {
      documents.push({ id: document.id, data: document.data() as Record<string, unknown> })
    })

    lastDocumentId = snapshot.docs[snapshot.docs.length - 1].id
    if (snapshot.size < PAGE_SIZE) {
      break
    }
  }

  return documents
}

async function repairCollection(
  db: Firestore,
  collectionName: TargetCollection,
  target: RepairTarget,
) {
  const stats = createCollectionStats()
  const documents = await fetchAllDocuments(db, collectionName)

  for (const document of documents) {
    stats.checked += 1
    const path = `${collectionName}/${document.id}`
    const classification = classifyDocument(document.data, target, collectionName, document.id)

    if (classification.action === 'skip') {
      recordSkip(stats, path, classification.reason ?? 'ambiguous', classification.detail ?? '')
      continue
    }

    const patch = buildRepairPatch(document.data, target, collectionName, document.id)
    if (!patch) {
      recordSkip(stats, path, 'already_ok', 'tenant fields は既に整合しています')
      continue
    }

    stats.updatePlanned += 1
    stats.plannedChanges.push({
      path,
      fields: Object.keys(patch),
      reason: describePatch(patch),
    })

    if (!dryRun) {
      await db
        .collection(collectionName)
        .doc(document.id)
        .set(
          {
            ...patch,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
    }
  }

  return stats
}

function logCollectionStats(collectionName: TargetCollection, stats: CollectionStats) {
  console.log(
    `[repair] ${collectionName}: checked ${stats.checked} / update planned ${stats.updatePlanned} / skipped ${stats.skipped}`,
  )

  stats.plannedChanges.forEach((change) => {
    console.log(`[repair]   update ${change.path}: ${change.fields.join(', ')} (${change.reason})`)
  })

  stats.skipSamples.forEach((sample) => {
    console.log(`[repair]   skip ${sample.path}: ${sample.reason} (${sample.detail})`)
  })

  const otherSkipCount = stats.skipped - stats.skipSamples.length
  if (otherSkipCount > 0) {
    console.log(`[repair]   skip others: ${otherSkipCount} more`)
  }
}

async function verifyOwnerStaff(db: Firestore, target: RepairTarget) {
  const snapshot = await db.collection('staffMembers').get()
  const ownerCandidates = snapshot.docs
    .map((document) => ({
      id: document.id,
      data: document.data() as Record<string, unknown>,
    }))
    .filter((staff) => {
      const franchiseeId = docFranchiseeId(staff.data)
      const loginId = toStringValue(staff.data.loginId) || toStringValue(staff.data.userId)
      const role = toStringValue(staff.data.role)
      return (
        franchiseeId === target.franchiseeId &&
        loginId === OWNER_LOGIN_ID &&
        (role === 'owner' || role === 'franchisee_owner')
      )
    })

  if (ownerCandidates.length === 0) {
    console.warn(
      `[repair] warning: franchiseeId=${target.franchiseeId} に loginId=${OWNER_LOGIN_ID} の owner が見つかりません`,
    )
    return
  }

  const owner = ownerCandidates[0]
  console.log(
    `[repair] owner staff check: found ${OWNER_LOGIN_ID} (id=${owner.id}, role=${toStringValue(owner.data.role)})`,
  )
}

async function countDrivers(db: Firestore, target: RepairTarget) {
  const snapshot = await db.collection('staffMembers').get()
  const drivers = snapshot.docs.filter((document) => {
    const data = document.data() as Record<string, unknown>
    const franchiseeId = docFranchiseeId(data)
    const storeId = docStoreId(data)
    const role = toStringValue(data.role)
    const enabled = data.enabled !== false && data.isActive !== false

    return (
      franchiseeId === target.franchiseeId &&
      storeId === target.storeId &&
      role === 'driver' &&
      enabled
    )
  })

  if (drivers.length === 0) {
    console.warn('[repair] notice: ちばケアタクシー側に有効な driver が 0 件です。必要なら別途テストスタッフを作成してください。')
    return
  }

  console.log(`[repair] driver count on chiba side: ${drivers.length}`)
}

async function main() {
  initializeFirebaseApp()
  const db = getFirestore()

  console.log(`[repair] DRY_RUN=${dryRun ? 'true' : 'false'}`)
  if (projectId) {
    console.log(`[repair] projectId: ${projectId}`)
  }

  const companies = await loadCompanies(db)
  const stores = await loadStores(db)
  const target = resolveRepairTarget(companies, stores)

  console.log(`[repair] target franchiseeId: ${target.franchiseeId}`)
  console.log(`[repair] target storeId: ${target.storeId}`)
  console.log(`[repair] target storeName: ${target.storeName}`)
  console.log(
    `[repair] target company: ${target.company.name || target.company.corporateName || target.company.id}`,
  )

  await verifyOwnerStaff(db, target)

  const collectionStats: Partial<Record<TargetCollection, CollectionStats>> = {}
  let totalUpdates = 0

  for (const collectionName of TARGET_COLLECTIONS) {
    const stats = await repairCollection(db, collectionName, target)
    collectionStats[collectionName] = stats
    totalUpdates += stats.updatePlanned
    logCollectionStats(collectionName, stats)
  }

  await countDrivers(db, target)

  console.log(`[repair] summary: total updates ${dryRun ? 'planned' : 'applied'}: ${totalUpdates}`)

  if (dryRun && totalUpdates > 0) {
    console.log('[repair] dry-run complete. Apply with: DRY_RUN=false npm run repair:chiba-care-taxi-tenant')
  }
}

main().catch((error) => {
  console.error('[repair] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
