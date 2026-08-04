import type { AccountingTenantFields } from './accounting'

/** まとめ経費の管理区分（勘定科目ではない） */
export const EXPENSE_GROUP_TYPES = [
  'training',
  'business_trip',
  'vehicle_maintenance',
  'advertising',
  'event',
  'startup',
  'equipment',
  'other',
] as const

export type ExpenseGroupType = (typeof EXPENSE_GROUP_TYPES)[number]

export const EXPENSE_GROUP_TYPE_LABELS: Record<ExpenseGroupType, string> = {
  training: '研修・視察',
  business_trip: '出張',
  vehicle_maintenance: '車両修理・整備',
  advertising: '広告・販促',
  event: '展示会・イベント',
  startup: '開業準備',
  equipment: '設備導入',
  other: 'その他',
}

export type AccountingExpenseGroupInput = AccountingTenantFields & {
  groupType: ExpenseGroupType
  title: string
  /** YYYY-MM-DD。明細の最古領収書日付 */
  startDate: string | null
  /** YYYY-MM-DD。明細の最新領収書日付 */
  endDate: string | null
  /** 明細税込金額の合計（保存時に再計算） */
  totalAmount: number
  /** 関連経費明細 ID */
  expenseIds: string[]
  /** 関連レポート ID（任意） */
  reportId?: string | null
  confirmationStatus: '未確認' | '確認済み' | '無効'
  memo?: string
  createdBy: string
  createdByName: string
  updatedBy: string
  updatedByName: string
  isDeleted?: boolean
  deletedAt?: string
  deletedBy?: string
  deleteReason?: string
}

export type StoredAccountingExpenseGroup = AccountingExpenseGroupInput & {
  id: string
  createdAt?: string
  updatedAt?: string
}

export const normalizeExpenseGroupType = (value: unknown): ExpenseGroupType => {
  if (
    value === 'training' ||
    value === 'business_trip' ||
    value === 'vehicle_maintenance' ||
    value === 'advertising' ||
    value === 'event' ||
    value === 'startup' ||
    value === 'equipment' ||
    value === 'other'
  ) {
    return value
  }
  return 'other'
}

export const getExpenseGroupTypeLabel = (groupType: ExpenseGroupType | undefined) =>
  EXPENSE_GROUP_TYPE_LABELS[normalizeExpenseGroupType(groupType)]
