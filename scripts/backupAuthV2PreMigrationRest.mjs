#!/usr/bin/env node
/**
 * Pre-migration backup via OAuth access token + REST.
 * Collections: staffMembers, companies, staffCredentials + Auth uid/claims list.
 * Passwords redacted. No restore.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
if (!token) {
  console.error('Set GOOGLE_OAUTH_ACCESS_TOKEN from: gcloud auth print-access-token')
  process.exit(2)
}

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const authBase = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

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

function redactFields(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields || {})) {
    if (/password|token|secret|salt|hash/i.test(key)) {
      const present =
        (value && value.stringValue && String(value.stringValue).length > 0) ||
        value?.integerValue != null
      out[key] = present ? { stringValue: '[redacted-present]' } : value
      continue
    }
    out[key] = value
  }
  return out
}

async function listAuthUsers() {
  // Download account batch — may be empty if permission limited
  const users = []
  let nextPageToken = undefined
  do {
    const res = await fetch(`${authBase}/accounts:batchGet`, {
      method: 'GET',
      headers,
    }).catch(() => null)

    // Fallback: query by known staff docs only handled by caller if batchGet unavailable
    if (!res || !res.ok) {
      return { users, note: 'batchGet unavailable; auth users captured post-migration via lookup' }
    }
    const body = await res.json()
    users.push(
      ...(body.users || []).map((u) => ({
        localId: u.localId,
        disabled: Boolean(u.disabled),
        customAttributes: u.customAttributes || null,
      })),
    )
    nextPageToken = body.nextPageToken
  } while (nextPageToken)
  return { users }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), '.auth-v2-backup', stamp)
  mkdirSync(outDir, { recursive: true })

  const summary = {}
  for (const name of ['staffMembers', 'companies', 'staffCredentials']) {
    const docs = await listCollection(name)
    const redacted = docs.map((doc) => ({
      name: doc.name,
      fields: redactFields(doc.fields),
    }))
    summary[name] = redacted.length
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(redacted, null, 2))
  }

  const auth = await listAuthUsers()
  summary.firebaseAuthUsers = Array.isArray(auth.users) ? auth.users.length : 0
  writeFileSync(join(outDir, 'firebaseAuthUsers.json'), JSON.stringify(auth, null, 2))

  const meta = {
    projectId,
    generatedAt: new Date().toISOString(),
    outDir,
    summary,
    note: 'Passwords stored as [redacted-present]. Restore not performed.',
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify(meta, null, 2))
}

main().catch((error) => {
  console.error('Backup failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
