#!/usr/bin/env node
/**
 * Pre-migration backup (auth-related collections only).
 * Does not include images/PDFs/accounting receipts.
 * Does not restore.
 * Never prints password plaintext.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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

const redactDoc = (data: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (/password|token|secret|salt|hash/i.test(key) && value != null && value !== '') {
      out[key] = '[redacted-present]'
      continue
    }
    out[key] = value
  }
  return out
}

async function listAllAuthUsers() {
  const auth = getAuth()
  const users: Array<Record<string, unknown>> = []
  let pageToken: string | undefined
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users) {
      users.push({
        uid: user.uid,
        disabled: user.disabled,
        customClaims: user.customClaims || null,
        // no email/phone/displayName in backup report payload for privacy
        hasEmail: Boolean(user.email),
        hasPhone: Boolean(user.phoneNumber),
      })
    }
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function main() {
  initializeFirebaseApp()
  const db = getFirestore()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), '.auth-v2-backup', stamp)
  mkdirSync(outDir, { recursive: true })

  const collections = ['staffMembers', 'companies', 'staffCredentials'] as const
  const summary: Record<string, number> = {}

  for (const name of collections) {
    const snap = await db.collection(name).get()
    const docs = snap.docs.map((doc) => ({
      id: doc.id,
      data: redactDoc(doc.data() as Record<string, unknown>),
    }))
    summary[name] = docs.length
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(docs, null, 2), 'utf8')
  }

  const authUsers = await listAllAuthUsers()
  summary.firebaseAuthUsers = authUsers.length
  writeFileSync(join(outDir, 'firebaseAuthUsers.json'), JSON.stringify(authUsers, null, 2), 'utf8')

  const meta = {
    projectId,
    generatedAt: new Date().toISOString(),
    outDir,
    summary,
    note: 'Passwords redacted as [redacted-present]. Restore is not performed by this script.',
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(meta, null, 2), 'utf8')
  console.log(JSON.stringify(meta, null, 2))
}

main().catch((error) => {
  console.error('Backup failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
