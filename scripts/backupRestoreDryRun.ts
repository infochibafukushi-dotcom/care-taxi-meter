#!/usr/bin/env node
/**
 * Backup / restore dry-run (READ ONLY).
 *
 * - Never writes to Firestore / Auth / Storage / D1
 * - Never runs production restore (import / time-travel restore / Auth recreate)
 * - Refuses to run if DRY_RUN=false
 * - Does not change accounting expenses (26 / ¥136,578)
 *
 * Usage:
 *   npm run backup:restore:dry-run
 *   FIREBASE_PROJECT_ID=care-taxi-meter npm run backup:restore:dry-run -- --with-live-read
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT,
  ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN,
  AUTH_V2_BACKUP_DIR,
  AUTH_V2_BACKUP_FILES,
  BACKUP_RESTORE_BASELINE_COMMIT,
  CRITICAL_WARNINGS,
  FIRESTORE_BACKUP_BUCKET,
  FIRESTORE_BACKUP_OUTPUT_PREFIX_PATTERN,
  FIRESTORE_BACKUP_RETENTION_DAYS,
  FIRESTORE_BACKUP_SCHEDULE_CRON,
  FIRESTORE_BACKUP_SCHEDULE_LABEL,
  FIRESTORE_BACKUP_STATUS_DOC,
  POST_RESTORE_CHECKLIST,
  PRE_RESTORE_CHECKLIST,
  RESERVATION_V4_ORIGIN,
  RESERVATION_V4_WORKER,
  buildRestoreIncidentPlans,
  formatIncidentPlanForDryRun,
  runLocalPolicyDryRunChecks,
  summarizeDryRunChecks,
} from '../src/utils/backupRestoreRunbookPolicy'

const FORBIDDEN_WRITE = process.env.DRY_RUN === 'false'
if (FORBIDDEN_WRITE) {
  console.error('Refusing to run: DRY_RUN=false is forbidden for this script.')
  process.exit(2)
}

const withLiveRead = process.argv.includes('--with-live-read')

type LiveAccounting = {
  active: number
  sum: number
  matchedGuard: boolean
  source: 'firestore-rest' | 'skipped'
  note?: string
}

async function readLiveAccountingIfRequested(): Promise<LiveAccounting> {
  if (!withLiveRead) {
    return {
      active: ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT,
      sum: ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN,
      matchedGuard: true,
      source: 'skipped',
      note: 'Pass --with-live-read and GOOGLE_OAUTH_ACCESS_TOKEN for live count (read-only).',
    }
  }

  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || ''
  if (!token) {
    return {
      active: -1,
      sum: -1,
      matchedGuard: false,
      source: 'skipped',
      note: 'GOOGLE_OAUTH_ACCESS_TOKEN missing; live read skipped.',
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'care-taxi-meter'
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-goog-user-project': projectId,
  }

  const docs: Array<{ fields?: Record<string, { booleanValue?: boolean; stringValue?: string; integerValue?: string; doubleValue?: number }> }> =
    []
  let pageToken = ''
  do {
    const url = new URL(`${firestoreBase}/accountingExpenses`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      throw new Error(`accountingExpenses HTTP ${res.status}`)
    }
    const body = (await res.json()) as {
      documents?: typeof docs
      nextPageToken?: string
    }
    docs.push(...(body.documents || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)

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

  return {
    active,
    sum,
    matchedGuard:
      active === ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT &&
      sum === ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN,
    source: 'firestore-rest',
  }
}

function listLocalAuthV2Backups(): Array<{
  dir: string
  files: string[]
  hasAllExpectedFiles: boolean
}> {
  const root = join(process.cwd(), AUTH_V2_BACKUP_DIR)
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })
    .map((dir) => {
      const files = readdirSync(dir)
      const hasAllExpectedFiles = AUTH_V2_BACKUP_FILES.every((f) => files.includes(f))
      return { dir, files, hasAllExpectedFiles }
    })
}

function peekAuthBackupManifest(dir: string): Record<string, unknown> | null {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function main() {
  console.log('=== backup:restore:dry-run (READ ONLY) ===')
  console.log(
    JSON.stringify(
      {
        baselineCommit: BACKUP_RESTORE_BASELINE_COMMIT,
        dryRun: true,
        productionRestoreExecuted: false,
        productionDataModified: false,
        firestoreBackup: {
          bucket: FIRESTORE_BACKUP_BUCKET,
          scheduleCron: FIRESTORE_BACKUP_SCHEDULE_CRON,
          scheduleLabel: FIRESTORE_BACKUP_SCHEDULE_LABEL,
          retentionDays: FIRESTORE_BACKUP_RETENTION_DAYS,
          outputPrefixPattern: FIRESTORE_BACKUP_OUTPUT_PREFIX_PATTERN,
          statusDoc: FIRESTORE_BACKUP_STATUS_DOC,
        },
        d1TimeTravel: {
          owner: 'reservation-v4 (external)',
          worker: RESERVATION_V4_WORKER,
          origin: RESERVATION_V4_ORIGIN,
          usage: [
            'cd reservation-v4 project',
            'npx wrangler d1 time-travel info <DATABASE_NAME>',
            'select bookmark or --timestamp=<ISO>',
            'npx wrangler d1 time-travel restore <DATABASE_NAME> --bookmark=<BOOKMARK>',
            'NEVER run restore from this dry-run script',
          ],
        },
        authV2: {
          backupDir: AUTH_V2_BACKUP_DIR,
          expectedFiles: AUTH_V2_BACKUP_FILES,
          plaintextPasswordRestorable: false,
          recovery: [
            'Locate latest .auth-v2-backup/<stamp>/manifest.json',
            'Compare staffCredentials / firebaseAuthUsers counts (uid + claims only)',
            'Recreate missing Auth users if needed',
            'Reset passwords via upsertStaffCredential / Admin UI (plaintext not in backup)',
          ],
        },
        accountingGuard: {
          activeExpenses: ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT,
          sumYen: ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN,
          mustNotChange: true,
        },
        criticalWarnings: CRITICAL_WARNINGS,
      },
      null,
      2,
    ),
  )

  const policyChecks = runLocalPolicyDryRunChecks()
  const policySummary = summarizeDryRunChecks(policyChecks)
  console.log('\n=== local policy checks ===')
  console.log(JSON.stringify({ summary: policySummary, checks: policyChecks }, null, 2))

  const liveAccounting = await readLiveAccountingIfRequested()
  console.log('\n=== accounting integrity (read-only) ===')
  console.log(JSON.stringify(liveAccounting, null, 2))

  const authBackups = listLocalAuthV2Backups()
  console.log('\n=== local Auth V2 backups (metadata only) ===')
  console.log(
    JSON.stringify(
      {
        count: authBackups.length,
        backups: authBackups.map((b) => ({
          dir: b.dir,
          fileCount: b.files.length,
          hasAllExpectedFiles: b.hasAllExpectedFiles,
          manifest: peekAuthBackupManifest(b.dir),
        })),
      },
      null,
      2,
    ),
  )

  console.log('\n=== pre-restore checklist ===')
  for (const item of PRE_RESTORE_CHECKLIST) {
    console.log(`[ ] ${item}`)
  }

  console.log('\n=== post-restore checklist ===')
  for (const item of POST_RESTORE_CHECKLIST) {
    console.log(`[ ] ${item}`)
  }

  console.log('\n=== incident restore plans (documentation only) ===')
  for (const plan of buildRestoreIncidentPlans()) {
    console.log(formatIncidentPlanForDryRun(plan))
    console.log('')
  }

  const liveReadFailed =
    withLiveRead &&
    (liveAccounting.source !== 'firestore-rest' || !liveAccounting.matchedGuard)

  if (!policySummary.ok || liveReadFailed) {
    console.error('Dry-run FAILED (no production changes were made).')
    process.exit(5)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        message:
          'Dry-run passed. No production restore executed. No production data modified.',
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('Dry-run failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
