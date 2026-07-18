#!/usr/bin/env node
/** Phase3B post-delete verification. Never prints password values. */
import { createHash } from 'node:crypto'

const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
if (!token) {
  console.error('Set GOOGLE_OAUTH_ACCESS_TOKEN')
  process.exit(2)
}

const STAFF_PW_FIELDS = [
  'password',
  'initialPassword',
  'ownerPassword',
  'representativeInitialPassword',
  'newPassword',
  'bootstrapPassword',
]
const COMPANY_PW_FIELDS = [
  'representativeInitialPassword',
  'ownerPassword',
  'initialPassword',
]

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
    if (!res.ok) throw new Error(`${collection} HTTP ${res.status}`)
    const body = await res.json()
    docs.push(...(body.documents || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return docs
}

function hasPlain(field) {
  if (!field) return false
  if (typeof field.stringValue === 'string') return field.stringValue.trim().length > 0
  return field.integerValue != null
}

function fieldPresent(fields, name) {
  return fields && Object.prototype.hasOwnProperty.call(fields, name)
}

function docId(name) {
  return String(name).split('/').pop()
}

async function sumAccounting() {
  const docs = await listCollection('accountingExpenses')
  let active = 0
  let sum = 0
  for (const d of docs) {
    const isDeleted = d.fields?.isDeleted?.booleanValue === true
    const deletedAt =
      typeof d.fields?.deletedAt?.stringValue === 'string' &&
      d.fields.deletedAt.stringValue.trim().length > 0
    if (isDeleted || deletedAt) continue
    active += 1
    const amount = d.fields?.taxIncludedAmount
    if (amount?.integerValue != null) sum += Number(amount.integerValue)
    else if (amount?.doubleValue != null) sum += Number(amount.doubleValue)
  }
  return { active, sum }
}

async function main() {
  const [staff, companies, creds] = await Promise.all([
    listCollection('staffMembers'),
    listCollection('companies'),
    listCollection('staffCredentials'),
  ])

  const staffPlain = staff.filter((d) =>
    STAFF_PW_FIELDS.some((f) => hasPlain(d.fields?.[f])),
  ).length
  const staffFieldPresent = staff.filter((d) =>
    STAFF_PW_FIELDS.some((f) => fieldPresent(d.fields, f)),
  ).length
  const companyPlain = companies.filter((d) =>
    COMPANY_PW_FIELDS.some((f) => hasPlain(d.fields?.[f])),
  ).length
  const companyFieldPresent = companies.filter((d) =>
    COMPANY_PW_FIELDS.some((f) => fieldPresent(d.fields, f)),
  ).length

  const credPlain = creds.filter((d) => hasPlain(d.fields?.password)).length
  const credWithHash = creds.filter(
    (d) => hasPlain(d.fields?.passwordHash) && hasPlain(d.fields?.passwordSalt),
  ).length

  const authUsers = []
  for (const c of creds) {
    const id = docId(c.name)
    const lookup = await fetch(`${authBase}/accounts:lookup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ localId: [id] }),
    })
    const body = await lookup.json()
    const user = body.users?.[0]
    let claims = null
    try {
      claims = user?.customAttributes ? JSON.parse(user.customAttributes) : null
    } catch {
      claims = null
    }
    authUsers.push({
      uidHash: createHash('sha256').update(id).digest('hex').slice(0, 10),
      exists: Boolean(user),
      disabled: Boolean(user?.disabled),
      role: claims?.role ?? null,
      hasCompanyId: Boolean(claims?.companyId || claims?.franchiseeId),
      hasStoreId: Boolean(claims?.storeId),
      hasStaffId: Boolean(claims?.staffId),
    })
  }

  const accounting = await sumAccounting()

  const report = {
    staffMembers: staff.length,
    staffPlainPasswordDocs: staffPlain,
    staffPasswordFieldPresentDocs: staffFieldPresent,
    companies: companies.length,
    companyPlainPasswordDocs: companyPlain,
    companyPasswordFieldPresentDocs: companyFieldPresent,
    staffCredentials: creds.length,
    credentialsWithHashAndSalt: credWithHash,
    credentialsWithPlainPassword: credPlain,
    firebaseAuthUsers: authUsers.filter((u) => u.exists).length,
    claimsOk: authUsers.every(
      (u) => u.exists && u.hasCompanyId && u.hasStoreId && u.hasStaffId && u.role,
    ),
    authUsers,
    accounting,
    ok:
      staffPlain === 0 &&
      staffFieldPresent === 0 &&
      companyPlain === 0 &&
      companyFieldPresent === 0 &&
      creds.length === 4 &&
      credWithHash === 4 &&
      credPlain === 0 &&
      authUsers.filter((u) => u.exists).length === 4 &&
      accounting.active === 26 &&
      accounting.sum === 136578,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exit(5)
}

main().catch((error) => {
  console.error('Verify failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
