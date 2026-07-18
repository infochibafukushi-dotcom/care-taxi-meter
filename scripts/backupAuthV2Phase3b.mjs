#!/usr/bin/env node
/**
 * Phase3B dedicated backup before plaintext deletion.
 * Never prints password values. Does not restore.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const REQUIRED_COMMIT = '42ae63e99e2de2bfb2a2202b96649f8af214ad83'
const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
if (!token) {
  console.error('Set GOOGLE_OAUTH_ACCESS_TOKEN')
  process.exit(2)
}

const commitId = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
})()

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

function redactFields(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields || {})) {
    if (/password|token|secret|salt|hash/i.test(key)) {
      out[key] = hasPlain(value) ? { stringValue: '[redacted-present]' } : value
      continue
    }
    out[key] = value
  }
  return out
}

function docId(name) {
  return String(name).split('/').pop()
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), '.auth-v2-backup', `phase3b-pre-delete-${stamp}`)
  mkdirSync(outDir, { recursive: true })

  const [staff, companies, creds] = await Promise.all([
    listCollection('staffMembers'),
    listCollection('companies'),
    listCollection('staffCredentials'),
  ])

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
      uid: id,
      exists: Boolean(user),
      disabled: Boolean(user?.disabled),
      claims,
    })
  }

  writeFileSync(
    join(outDir, 'staffMembers.json'),
    JSON.stringify(
      staff.map((d) => ({ name: d.name, fields: redactFields(d.fields) })),
      null,
      2,
    ),
  )
  writeFileSync(
    join(outDir, 'companies.json'),
    JSON.stringify(
      companies.map((d) => ({ name: d.name, fields: redactFields(d.fields) })),
      null,
      2,
    ),
  )
  writeFileSync(
    join(outDir, 'staffCredentials.json'),
    JSON.stringify(
      creds.map((d) => ({ name: d.name, fields: redactFields(d.fields) })),
      null,
      2,
    ),
  )
  writeFileSync(join(outDir, 'firebaseAuthUsers.json'), JSON.stringify(authUsers, null, 2))

  const deletionTargetFields = {
    staffMembers: STAFF_PW_FIELDS,
    companies: COMPANY_PW_FIELDS,
  }

  const meta = {
    phase: '3B',
    purpose: 'pre-plaintext-deletion-backup',
    projectId,
    generatedAt: new Date().toISOString(),
    commitId,
    requiredBaseCommit: REQUIRED_COMMIT,
    outDir,
    deletionTargetFields,
    summary: {
      staffMembers: staff.length,
      companies: companies.length,
      staffCredentials: creds.length,
      firebaseAuthUsers: authUsers.filter((u) => u.exists).length,
      staffWithPassword: staff.filter((d) => hasPlain(d.fields?.password)).length,
      companiesWithRepresentativeInitialPassword: companies.filter((d) =>
        hasPlain(d.fields?.representativeInitialPassword),
      ).length,
    },
    note: 'Passwords redacted as [redacted-present]. Restore is manual and not executed by scripts.',
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify(meta, null, 2))
}

main().catch((error) => {
  console.error('Backup failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
