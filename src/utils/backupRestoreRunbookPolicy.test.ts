import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT,
  ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN,
  BACKUP_RESTORE_BASELINE_COMMIT,
  CRITICAL_WARNINGS,
  FIRESTORE_BACKUP_BUCKET,
  FIRESTORE_BACKUP_RETENTION_DAYS,
  FIRESTORE_BACKUP_SCHEDULE_CRON,
  POST_RESTORE_CHECKLIST,
  PRE_RESTORE_CHECKLIST,
  buildRestoreIncidentPlans,
  formatIncidentPlanForDryRun,
  runLocalPolicyDryRunChecks,
  summarizeDryRunChecks,
} from './backupRestoreRunbookPolicy'

describe('backupRestoreRunbookPolicy', () => {
  it('locks baseline commit and Firestore backup facts', () => {
    expect(BACKUP_RESTORE_BASELINE_COMMIT).toBe(
      '909b60e9d97e8f56cad044e2bc6ee07f1e1b287e',
    )
    expect(FIRESTORE_BACKUP_BUCKET).toBe('care-taxi-meter-fs-backup-ane1')
    expect(FIRESTORE_BACKUP_SCHEDULE_CRON).toBe('30 3 * * 0')
    expect(FIRESTORE_BACKUP_RETENTION_DAYS).toBe(30)
  })

  it('does not change accounting integrity guard values', () => {
    expect(ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT).toBe(26)
    expect(ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN).toBe(136_578)
  })

  it('passes local dry-run policy checks', () => {
    const checks = runLocalPolicyDryRunChecks()
    expect(summarizeDryRunChecks(checks)).toEqual({
      ok: true,
      passed: checks.length,
      failed: 0,
    })
  })

  it('fails dry-run when accounting guard is tampered', () => {
    const checks = runLocalPolicyDryRunChecks({
      accountingActiveCount: 25,
      accountingSumYen: 136_578,
    })
    const summary = summarizeDryRunChecks(checks)
    expect(summary.ok).toBe(false)
    expect(checks.find((c) => c.id === 'accounting_integrity_guard')?.ok).toBe(false)
  })

  it('covers all required incident kinds with gates and image/password warnings', () => {
    const plans = buildRestoreIncidentPlans()
    expect(plans.map((p) => p.kind).sort()).toEqual(
      [
        'firestore_corruption',
        'receipt_image_display_failure',
        'reservation_d1_corruption',
        'single_expense_soft_deleted',
        'staff_auth_corruption',
      ].sort(),
    )
    for (const plan of plans) {
      expect(plan.requiredGates.length).toBeGreaterThanOrEqual(3)
      expect(formatIncidentPlanForDryRun(plan)).toContain(plan.titleJa)
    }
    expect(CRITICAL_WARNINGS.some((w) => w.includes('複製されない'))).toBe(true)
    expect(CRITICAL_WARNINGS.some((w) => w.includes('復元できない'))).toBe(true)
    expect(CRITICAL_WARNINGS.some((w) => w.includes('平文パスワード'))).toBe(true)
  })

  it('exposes non-empty pre/post restore checklists', () => {
    expect(PRE_RESTORE_CHECKLIST.length).toBeGreaterThanOrEqual(8)
    expect(POST_RESTORE_CHECKLIST.length).toBeGreaterThanOrEqual(6)
    expect(PRE_RESTORE_CHECKLIST.some((c) => c.includes('承認'))).toBe(true)
    expect(POST_RESTORE_CHECKLIST.some((c) => c.includes('136,578'))).toBe(true)
  })
})
