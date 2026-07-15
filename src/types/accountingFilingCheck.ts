export type FilingCheckStatus =
  | 'complete'
  | 'warning'
  | 'blocking'
  | 'notApplicable'
  | 'planned'

export type FilingCheckCategory =
  | 'period'
  | 'receipts'
  | 'expenses'
  | 'tax'
  | 'fixedAssets'
  | 'cashAndBank'
  | 'liabilities'
  | 'capital'
  | 'settlement'
  | 'system'

export type FilingCheckActionTarget =
  | 'settlement-auxiliary'
  | 'expenses'
  | 'unorganized-receipts'
  | 'fixed-assets'
  | 'etax'
  | 'tax-advisor'

export type FilingCheckItem = {
  id: string
  category: FilingCheckCategory
  label: string
  status: FilingCheckStatus
  summary: string
  detail?: string
  affectedCount?: number
  expectedAmountYen?: number
  actualAmountYen?: number
  differenceYen?: number
  sourceIds?: string[]
  actionTarget?: FilingCheckActionTarget
}

export type FilingCheckSummary = {
  items: FilingCheckItem[]
  blockingCount: number
  warningCount: number
  plannedCount: number
  completeCount: number
  notApplicableCount: number
  /** blockingCount === 0 */
  isFilingReady: boolean
}

export const FILING_CHECK_STATUS_LABELS: Record<FilingCheckStatus, string> = {
  complete: '確認済み',
  warning: '要確認',
  blocking: '要修正',
  notApplicable: '該当なし',
  planned: '対応予定',
}

export type FilingCheckFilter = 'all' | 'blocking' | 'warning' | 'planned' | 'actionable'

export const FILING_EXPORT_CAUTION =
  '要修正項目があります。この資料は確認用として出力できますが、申告用の確定資料としては使用しないでください。'
