/**
 * Backup / restore runbook policy (dry-run / documentation source of truth).
 * Production restore is NEVER executed by scripts that import this module.
 *
 * Baseline: main commit 909b60e9d97e8f56cad044e2bc6ee07f1e1b287e
 */

import {
  LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST,
  LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST,
  LIGHTWEIGHT_BACKUP_RETENTION_DAYS,
} from './lightweightBackupPolicy'

/** Documented baseline for this runbook. */
export const BACKUP_RESTORE_BASELINE_COMMIT =
  '909b60e9d97e8f56cad044e2bc6ee07f1e1b287e'

export const FIRESTORE_BACKUP_BUCKET = 'care-taxi-meter-fs-backup-ane1'
export const FIRESTORE_BACKUP_SCHEDULE_CRON = '30 3 * * 0'
export const FIRESTORE_BACKUP_SCHEDULE_LABEL = '毎週日曜 03:30 JST（Asia/Tokyo）'
export const FIRESTORE_BACKUP_OUTPUT_PREFIX_PATTERN =
  'gs://care-taxi-meter-fs-backup-ane1/daily/{YYYY-MM-DD}'
export const FIRESTORE_BACKUP_RETENTION_DAYS = LIGHTWEIGHT_BACKUP_RETENTION_DAYS
export const FIRESTORE_BACKUP_STATUS_DOC = 'lightweightBackupStatus/latest'

/** Accounting integrity guard (must not change during restore dry-run). */
export const ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT = 26
export const ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN = 136_578

export const AUTH_V2_BACKUP_DIR = '.auth-v2-backup'
export const AUTH_V2_BACKUP_FILES = [
  'staffMembers.json',
  'companies.json',
  'staffCredentials.json',
  'firebaseAuthUsers.json',
  'manifest.json',
] as const

/** reservation-v4 Worker that owns D1 reservation state (external to this repo). */
export const RESERVATION_V4_WORKER = 'throbbing-bush-8f59'
export const RESERVATION_V4_ORIGIN =
  'https://throbbing-bush-8f59.info-chibafukushi.workers.dev'

export type RestoreIncidentKind =
  | 'single_expense_soft_deleted'
  | 'firestore_corruption'
  | 'reservation_d1_corruption'
  | 'staff_auth_corruption'
  | 'receipt_image_display_failure'

export type RestoreIncidentPlan = {
  kind: RestoreIncidentKind
  titleJa: string
  primarySource: string
  canAutoRestoreFromBackup: boolean
  notes: string[]
  requiredGates: string[]
}

export const RESTORE_GATES = [
  '事前バックアップ取得（または既存バックアップの存在確認）',
  '対象件数・金額の確認（変更前後の差分を記録）',
  '承認者の明示的承認（氏名・日時・チケット/チャットURL）',
  '本番書き込みは dry-run 完了後に別作業として実施（本スクリプトでは実行しない）',
] as const

export const PRE_RESTORE_CHECKLIST = [
  '基準コミット BACKUP_RESTORE_BASELINE_COMMIT を確認した',
  '障害種別と影響範囲（コレクション / D1 / Auth / Storage）を特定した',
  '本番復元を実行しない方針を関係者に共有した（または承認済み本番作業であること）',
  '事前バックアップを取得、または利用可能なバックアップ URI / ディレクトリを記録した',
  '対象件数を確認した（経理: 有効経費件数・税込合計）',
  '経理ガード値（26件 / 136,578円）を変更しないことを確認した',
  '画像/PDF はバックアップに複製されていないことを関係者が理解した',
  '削除済み Storage オブジェクトは復元不可であることを関係者が理解した',
  'Auth 平文パスワードはバックアップから復元不可（再設定が必要）であることを理解した',
  '承認者・作業者・監視者を決め、作業開始時刻を記録した',
  'npm run backup:restore:dry-run を実行し、FAIL がないことを確認した',
] as const

export const POST_RESTORE_CHECKLIST = [
  '対象データの件数が想定どおりである',
  '経理: 有効経費が 26件・税込合計 136,578円のまま（意図的変更がない限り）',
  'スタッフログイン（Auth V2）が代表アカウントで成功する',
  '予約画面（reservation-v4 / D1）の主要一覧が開ける',
  '証憑画像: 既存オブジェクトの表示のみ確認（削除済みは復元不可）',
  'lightweightBackupStatus/latest の最終成功時刻を確認した（Firestore復元後）',
  '作業ログ（対象・件数・承認・結果）をチケットに残した',
  '追加の破壊的操作（再削除・再import）を行っていない',
] as const

export const CRITICAL_WARNINGS = [
  '画像・PDF・Firebase Storage オブジェクトは週次 Firestore バックアップに複製されない。',
  'accountingReceipts コレクションは週次バックアップ allowlist 外である。',
  '削除済みの証憑画像は本リポジトリのバックアップからは復元できない。',
  'Auth V2 バックアップのパスワードは [redacted-present] であり、平文パスワードは復元できない。パスワード再設定で対応する。',
  '本番復元コマンド（firestore import / D1 restore / Auth 書き込み）は本 dry-run では絶対に実行しない。',
] as const

export function buildRestoreIncidentPlans(): RestoreIncidentPlan[] {
  return [
    {
      kind: 'single_expense_soft_deleted',
      titleJa: '経費1件を誤削除（論理削除）',
      primarySource: 'Firestore accountingExpenses（isDeleted / deletedAt）',
      canAutoRestoreFromBackup: false,
      notes: [
        '通常は論理削除のため、承認後に isDeleted=false と削除メタデータ解除で復旧する（本番書き込みは手動）。',
        '週次バックアップから当該ドキュメントのみを抽出して比較してもよいが、import 全体は過剰。',
        '紐付証憑 Storage は別系統。画像が既に削除されていれば復元不可。',
        '復元後も経理ガード（26件 / 136,578円）を再集計して確認する。',
      ],
      requiredGates: [...RESTORE_GATES],
    },
    {
      kind: 'firestore_corruption',
      titleJa: 'Firestore全体の破損',
      primarySource: `GCS ${FIRESTORE_BACKUP_BUCKET}（週次 export）`,
      canAutoRestoreFromBackup: true,
      notes: [
        `バックアップ URI 例: ${FIRESTORE_BACKUP_OUTPUT_PREFIX_PATTERN}`,
        `保持期間: ${FIRESTORE_BACKUP_RETENTION_DAYS}日。期限切れオブジェクトは利用不可。`,
        '復元は gcloud firestore import（または同等）を承認後に手動実行。本スクリプトでは実行しない。',
        'allowlist 外（staffMembers / staffCredentials / accountingReceipts / ログ系）は週次バックアップに含まれない。',
        'Auth と証憑メタデータは別手順が必要。',
      ],
      requiredGates: [...RESTORE_GATES],
    },
    {
      kind: 'reservation_d1_corruption',
      titleJa: '予約 D1 の破損',
      primarySource: `Cloudflare D1 Time Travel（reservation-v4 / ${RESERVATION_V4_WORKER}）`,
      canAutoRestoreFromBackup: true,
      notes: [
        '本リポジトリに D1 バインディングはない。復元は reservation-v4 側プロジェクトで実施する。',
        '手順概要: wrangler d1 time-travel info → bookmark/timestamp 選定 → restore（承認後）。',
        'meter_fixed_fare_runs 等の予約状態が対象。Firestore caseRecords との整合を復元後に確認する。',
        'Time Travel の保持ウィンドウは Cloudflare / アカウント設定に依存する。期限外は復元不可。',
      ],
      requiredGates: [...RESTORE_GATES],
    },
    {
      kind: 'staff_auth_corruption',
      titleJa: 'スタッフ認証の破損',
      primarySource: `${AUTH_V2_BACKUP_DIR}/<stamp>/（staffCredentials + Firebase Auth）`,
      canAutoRestoreFromBackup: false,
      notes: [
        'バックアップから claims・uid・ハッシュ有無は復旧方針の材料になるが、平文パスワードは含まれない。',
        'Firebase Auth ユーザー欠落時は Auth ユーザー再作成 + upsertStaffCredential によるパスワード再設定。',
        'staffCredentials の passwordHash/salt をバックアップ JSON から機械復元する自動化は提供しない（redact 済み）。',
        '週次 Firestore バックアップは staffMembers / staffCredentials を含まない。',
      ],
      requiredGates: [...RESTORE_GATES],
    },
    {
      kind: 'receipt_image_display_failure',
      titleJa: '証憑画像の表示障害',
      primarySource: 'Firebase Storage accounting/… + accountingReceipts メタデータ',
      canAutoRestoreFromBackup: false,
      notes: [
        '画像バイナリはバックアップ複製されていない。',
        '表示障害が URL/権限/メタデータの問題なら Storage オブジェクト存在確認とルール・署名付きURL経路を点検する。',
        'オブジェクトが削除済みなら復元不可。再アップロードが唯一の復旧手段。',
        '経費ドキュメント（accountingExpenses）自体は週次バックアップ対象だが、画像は含まれない。',
      ],
      requiredGates: [...RESTORE_GATES],
    },
  ]
}

export type DryRunCheckResult = {
  id: string
  ok: boolean
  detail: string
}

export function runLocalPolicyDryRunChecks(input?: {
  baselineCommit?: string
  retentionDays?: number
  bucket?: string
  scheduleCron?: string
  accountingActiveCount?: number
  accountingSumYen?: number
}): DryRunCheckResult[] {
  const baseline = input?.baselineCommit ?? BACKUP_RESTORE_BASELINE_COMMIT
  const retention = input?.retentionDays ?? FIRESTORE_BACKUP_RETENTION_DAYS
  const bucket = input?.bucket ?? FIRESTORE_BACKUP_BUCKET
  const cron = input?.scheduleCron ?? FIRESTORE_BACKUP_SCHEDULE_CRON
  const active = input?.accountingActiveCount ?? ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_COUNT
  const sum = input?.accountingSumYen ?? ACCOUNTING_INTEGRITY_ACTIVE_EXPENSE_SUM_YEN

  const checks: DryRunCheckResult[] = [
    {
      id: 'baseline_commit',
      ok: baseline === BACKUP_RESTORE_BASELINE_COMMIT,
      detail: `baseline=${baseline}`,
    },
    {
      id: 'firestore_bucket',
      ok: bucket === 'care-taxi-meter-fs-backup-ane1',
      detail: `bucket=${bucket}`,
    },
    {
      id: 'firestore_schedule_weekly_sunday',
      ok: cron === '30 3 * * 0',
      detail: `cron=${cron} (${FIRESTORE_BACKUP_SCHEDULE_LABEL})`,
    },
    {
      id: 'firestore_retention_30_days',
      ok: retention === 30,
      detail: `retentionDays=${retention}`,
    },
    {
      id: 'accounting_integrity_guard',
      ok: active === 26 && sum === 136_578,
      detail: `activeExpenses=${active}, sumYen=${sum}`,
    },
    {
      id: 'images_not_in_weekly_backup',
      ok:
        (LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST as readonly string[]).includes(
          'accountingReceipts',
        ) &&
        !(LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST as readonly string[]).includes(
          'accountingReceipts',
        ),
      detail: 'accountingReceipts is denylisted; Storage binaries are not exported',
    },
    {
      id: 'auth_collections_excluded_from_weekly_backup',
      ok:
        (LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST as readonly string[]).includes(
          'staffMembers',
        ) &&
        (LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST as readonly string[]).includes(
          'staffCredentials',
        ),
      detail: 'staffMembers and staffCredentials are excluded from weekly export',
    },
    {
      id: 'allowlist_includes_accounting_expenses',
      ok: (LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST as readonly string[]).includes(
        'accountingExpenses',
      ),
      detail: 'accountingExpenses is in weekly allowlist',
    },
  ]

  return checks
}

export function summarizeDryRunChecks(checks: DryRunCheckResult[]): {
  ok: boolean
  passed: number
  failed: number
} {
  const failed = checks.filter((c) => !c.ok).length
  return {
    ok: failed === 0,
    passed: checks.length - failed,
    failed,
  }
}

export function formatIncidentPlanForDryRun(plan: RestoreIncidentPlan): string {
  const lines = [
    `## ${plan.titleJa} (${plan.kind})`,
    `- primarySource: ${plan.primarySource}`,
    `- canAutoRestoreFromBackup: ${plan.canAutoRestoreFromBackup}`,
    ...plan.notes.map((n) => `- note: ${n}`),
    ...plan.requiredGates.map((g) => `- gate: ${g}`),
  ]
  return lines.join('\n')
}
