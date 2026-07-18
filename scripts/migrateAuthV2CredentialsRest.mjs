#!/usr/bin/env node
/**
 * Auth V2 migration via Google OAuth access token + REST (no ADC required).
 *
 * Required:
 *   CONFIRM_MIGRATE_AUTH_V2=MIGRATE-AUTH-V2-4
 *   GOOGLE_OAUTH_ACCESS_TOKEN=<gcloud auth print-access-token>
 *
 * Never prints password plaintext / names / phones / emails.
 */
import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto'

const EXPECTED_COUNT = 4
const REQUIRED_CONFIRM = 'MIGRATE-AUTH-V2-4'
const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
const confirm = String(process.env.CONFIRM_MIGRATE_AUTH_V2 || '').trim()

if (confirm !== REQUIRED_CONFIRM) {
  console.error(`Refusing. Set CONFIRM_MIGRATE_AUTH_V2=${REQUIRED_CONFIRM}`)
  process.exit(2)
}
if (!token) {
  console.error('Refusing. Set GOOGLE_OAUTH_ACCESS_TOKEN from: gcloud auth print-access-token')
  process.exit(2)
}
if (process.env.AUTH_V2_ENFORCE === 'true') {
  console.error('Refusing while AUTH_V2_ENFORCE=true')
  process.exit(2)
}

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const authBase = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}`

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'x-goog-user-project': projectId,
}

async function listCollection(collection) {
  const docs = []
  let pageToken = ''
  do {
    const url = new URL(`${firestoreBase}/${collection}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`${collection} list HTTP ${res.status}`)
    const body = await res.json()
    docs.push(...(body.documents || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return docs
}

function fields(doc) {
  return doc.fields || {}
}
function str(field) {
  if (!field) return ''
  if (typeof field.stringValue === 'string') return field.stringValue.trim()
  if (field.integerValue != null) return String(field.integerValue)
  return ''
}
function bool(field, fallback = true) {
  if (!field) return fallback
  if (typeof field.booleanValue === 'boolean') return field.booleanValue
  return fallback
}
function passwordValue(field) {
  if (!field) return ''
  if (typeof field.stringValue === 'string') return field.stringValue
  if (field.integerValue != null) return String(field.integerValue)
  return ''
}
function docId(name) {
  return String(name).split('/').pop()
}
function normalizeLoginIdentifier(value) {
  return value.trim().replace(/[\s\u3000]+/g, '')
}
function toRole(value) {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

function scryptAsync(password, salt, keyLength, parameters) {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keyLength,
      { N: parameters.N, r: parameters.r, p: parameters.p },
      (error, derived) => {
        if (error) reject(error)
        else resolve(derived)
      },
    )
  })
}

async function hashPassword(password) {
  const parameters = { N: 16384, r: 8, p: 1, keyLength: 64, saltBytes: 16 }
  const salt = randomBytes(parameters.saltBytes)
  const derived = await scryptAsync(password, salt, parameters.keyLength, parameters)
  return {
    passwordHash: derived.toString('base64'),
    passwordSalt: salt.toString('base64'),
    hashAlgorithm: 'scrypt',
    hashParameters: parameters,
  }
}

async function patchCredential(staffId, data) {
  const name = `${firestoreBase}/staffCredentials/${encodeURIComponent(staffId)}`
  const fieldPaths = Object.keys(data)
  const url = `${name}?${fieldPaths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')}`
  const body = { fields: {} }
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      body.fields[key] = { nullValue: null }
    } else if (typeof value === 'number') {
      body.fields[key] = { integerValue: String(value) }
    } else if (typeof value === 'object' && value && 'mapValue' in value) {
      body.fields[key] = value
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      body.fields[key] = { timestampValue: value }
    } else {
      body.fields[key] = { stringValue: String(value) }
    }
  }

  // Try patch; if missing, create.
  let res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) })
  if (res.status === 404) {
    const createUrl = `${firestoreBase}/staffCredentials?documentId=${encodeURIComponent(staffId)}`
    res = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(body) })
  }
  if (!res.ok) {
    throw new Error(`credential write HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

function toMapValue(obj) {
  const fields = {}
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = { integerValue: String(v) }
  }
  return { mapValue: { fields } }
}

async function ensureAuthUser(uid, claims) {
  // lookup
  const lookupRes = await fetch(`${authBase}/accounts:lookup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId: [uid] }),
  })
  const lookupBody = await lookupRes.json().catch(() => ({}))
  const exists = Array.isArray(lookupBody.users) && lookupBody.users.length > 0

  if (!exists) {
    const createRes = await fetch(`${authBase}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ localId: uid, disabled: false }),
    })
    if (!createRes.ok) {
      throw new Error(`auth create HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`)
    }
  }

  const updateRes = await fetch(`${authBase}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      localId: uid,
      customAttributes: JSON.stringify(claims),
    }),
  })
  if (!updateRes.ok) {
    throw new Error(`auth claims HTTP ${updateRes.status}: ${(await updateRes.text()).slice(0, 200)}`)
  }

  return exists ? 'existing' : 'created'
}

async function main() {
  const [staffDocs, companyDocs] = await Promise.all([
    listCollection('staffMembers'),
    listCollection('companies'),
  ])
  const companyIds = new Set(companyDocs.map((d) => docId(d.name)))
  const staffIdSet = new Set()
  let duplicateStaffIds = 0
  const targets = []

  for (const doc of staffDocs) {
    const f = fields(doc)
    const staffId = str(f.id) || docId(doc.name)
    if (staffIdSet.has(staffId)) duplicateStaffIds += 1
    staffIdSet.add(staffId)
    const companyId = str(f.franchiseeId) || str(f.companyId)
    const storeId = str(f.storeId)
    const userId = str(f.userId) || str(f.loginId)
    const normalizedUserId = normalizeLoginIdentifier(userId)
    const password = passwordValue(f.password)
    const enabled = bool(f.enabled, true) && bool(f.isActive, true)
    const role = toRole(str(f.role))
    if (!password || !companyId || !companyIds.has(companyId) || !storeId || !normalizedUserId || !enabled) {
      continue
    }
    targets.push({ staffId, companyId, storeId, role, normalizedUserId, password })
  }

  if (duplicateStaffIds > 0) {
    console.error(JSON.stringify({ abort: true, reason: 'duplicate_staff_id', duplicateStaffIds }))
    process.exit(3)
  }
  if (targets.length !== EXPECTED_COUNT) {
    console.error(
      JSON.stringify({
        abort: true,
        expected: EXPECTED_COUNT,
        found: targets.length,
        message: 'Target count is not 4. Migration stopped.',
      }),
    )
    process.exit(4)
  }
  if (new Set(targets.map((t) => t.staffId)).size !== targets.length) {
    console.error(JSON.stringify({ abort: true, reason: 'credential_id_collision' }))
    process.exit(5)
  }

  const results = []
  let successCount = 0
  let failedCount = 0
  let authCreated = 0
  let authExisting = 0

  for (const target of targets) {
    try {
      const hashed = await hashPassword(target.password)
      const now = new Date().toISOString()
      await patchCredential(target.staffId, {
        companyId: target.companyId,
        franchiseeId: target.companyId,
        storeId: target.storeId,
        staffId: target.staffId,
        normalizedUserId: target.normalizedUserId,
        passwordHash: hashed.passwordHash,
        passwordSalt: hashed.passwordSalt,
        hashAlgorithm: hashed.hashAlgorithm,
        hashParameters: toMapValue(hashed.hashParameters),
        authUid: target.staffId,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: now,
        updatedAt: now,
        createdAt: now,
      })

      const claims = {
        role: target.role,
        franchiseeId: target.companyId,
        companyId: target.companyId,
        storeId: target.storeId,
        staffId: target.staffId,
      }
      const authStatus = await ensureAuthUser(target.staffId, claims)
      if (authStatus === 'created') authCreated += 1
      else authExisting += 1

      successCount += 1
      results.push({
        staffIdHash: createHash('sha256').update(target.staffId).digest('hex').slice(0, 10),
        status: 'success',
        authStatus,
        claims: {
          role: claims.role,
          hasCompanyId: true,
          hasStoreId: Boolean(claims.storeId),
          hasStaffId: true,
        },
      })
    } catch (error) {
      failedCount += 1
      results.push({
        staffIdHash: createHash('sha256').update(target.staffId).digest('hex').slice(0, 10),
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
  if (failedCount > 0) process.exit(6)
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
