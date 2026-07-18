#!/usr/bin/env node
/**
 * Phase3B: delete legacy plaintext auth fields only.
 *
 * Required:
 *   CONFIRM_DELETE_LEGACY_PLAINTEXT=DELETE-LEGACY-PLAINTEXT-AUTH-4
 *   GOOGLE_OAUTH_ACCESS_TOKEN
 *
 * Aborts unless staff password count == 4 and credentials == 4.
 * Never prints password values. Does not delete documents.
 */
import { createHash } from 'node:crypto'

const REQUIRED_CONFIRM = 'DELETE-LEGACY-PLAINTEXT-AUTH-4'
const EXPECTED_STAFF_PASSWORD = 4
const EXPECTED_CREDENTIALS = 4
const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
const confirm = String(process.env.CONFIRM_DELETE_LEGACY_PLAINTEXT || '').trim()

if (confirm !== REQUIRED_CONFIRM) {
  console.error(`Refusing. Set CONFIRM_DELETE_LEGACY_PLAINTEXT=${REQUIRED_CONFIRM}`)
  process.exit(2)
}
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

function docId(name) {
  return String(name).split('/').pop()
}

async function deleteFields(docName, fieldNames) {
  // Firestore REST: fields listed in updateMask but omitted from `fields` are deleted.
  const body = {
    writes: [
      {
        update: {
          name: docName,
          fields: {},
        },
        updateMask: { fieldPaths: fieldNames },
        currentDocument: { exists: true },
      },
    ],
  }
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    throw new Error(`commit delete HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

async function main() {
  const [staff, companies, creds] = await Promise.all([
    listCollection('staffMembers'),
    listCollection('companies'),
    listCollection('staffCredentials'),
  ])

  const staffWithPassword = staff.filter((d) => hasPlain(d.fields?.password))
  if (staffWithPassword.length !== EXPECTED_STAFF_PASSWORD) {
    console.error(
      JSON.stringify({
        abort: true,
        expectedStaffPassword: EXPECTED_STAFF_PASSWORD,
        found: staffWithPassword.length,
      }),
    )
    process.exit(3)
  }
  if (creds.length !== EXPECTED_CREDENTIALS) {
    console.error(
      JSON.stringify({
        abort: true,
        expectedCredentials: EXPECTED_CREDENTIALS,
        found: creds.length,
      }),
    )
    process.exit(4)
  }

  const results = []
  let staffFieldsDeleted = 0
  let companyFieldsDeleted = 0

  for (const doc of staff) {
    const present = STAFF_PW_FIELDS.filter((f) => hasPlain(doc.fields?.[f]) || doc.fields?.[f] != null)
    // Delete field if key exists (including empty string leftovers)
    const toDelete = STAFF_PW_FIELDS.filter((f) => doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, f))
    if (toDelete.length === 0) continue
    try {
      await deleteFields(doc.name, toDelete)
      staffFieldsDeleted += toDelete.length
      results.push({
        collection: 'staffMembers',
        idHash: createHash('sha256').update(docId(doc.name)).digest('hex').slice(0, 10),
        deletedFields: toDelete,
        hadPlainValues: present,
        status: 'success',
      })
    } catch (error) {
      results.push({
        collection: 'staffMembers',
        idHash: createHash('sha256').update(docId(doc.name)).digest('hex').slice(0, 10),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const doc of companies) {
    const toDelete = COMPANY_PW_FIELDS.filter(
      (f) => doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, f),
    )
    if (toDelete.length === 0) continue
    try {
      await deleteFields(doc.name, toDelete)
      companyFieldsDeleted += toDelete.length
      results.push({
        collection: 'companies',
        idHash: createHash('sha256').update(docId(doc.name)).digest('hex').slice(0, 10),
        deletedFields: toDelete,
        status: 'success',
      })
    } catch (error) {
      results.push({
        collection: 'companies',
        idHash: createHash('sha256').update(docId(doc.name)).digest('hex').slice(0, 10),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const failed = results.filter((r) => r.status === 'failed').length
  console.log(
    JSON.stringify(
      {
        confirm: REQUIRED_CONFIRM,
        projectId,
        staffFieldsDeleted,
        companyFieldsDeleted,
        failed,
        credentialsUntouched: creds.length,
        results,
      },
      null,
      2,
    ),
  )
  if (failed > 0) process.exit(6)
}

main().catch((error) => {
  console.error('Delete failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
