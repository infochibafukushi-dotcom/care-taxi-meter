import type { AccountingTenantFields } from './accounting'

export const EXPENSE_REPORT_TARGET_TYPES = ['expense', 'expense_group'] as const

export type ExpenseReportTargetType = (typeof EXPENSE_REPORT_TARGET_TYPES)[number]

export const EXPENSE_REPORT_DATE_MODES = ['auto', 'manual'] as const

export type ExpenseReportDateMode = (typeof EXPENSE_REPORT_DATE_MODES)[number]

/** レポート本文の保存上限（文字数） */
export const EXPENSE_REPORT_BODY_MAX_LENGTH = 20_000

export type AccountingExpenseReportImageInput = {
  /** Storage パス（永続 URL は保存しない） */
  storagePath: string
  originalFileName: string
  mimeType: string
  caption: string | null
  displayOrder: number
  fileSizeBytes?: number
}

export type StoredAccountingExpenseReportImage = AccountingExpenseReportImageInput & {
  id: string
  createdAt: string
}

export type AccountingExpenseReportInput = AccountingTenantFields & {
  targetType: ExpenseReportTargetType
  targetId: string
  title: string
  startDate: string | null
  endDate: string | null
  dateMode: ExpenseReportDateMode
  body: string
  images: StoredAccountingExpenseReportImage[]
  createdBy: string
  createdByName: string
  updatedBy: string
  updatedByName: string
  isDeleted?: boolean
  deletedAt?: string
  deletedBy?: string
}

export type StoredAccountingExpenseReport = AccountingExpenseReportInput & {
  id: string
  createdAt?: string
  updatedAt?: string
}

export const normalizeExpenseReportTargetType = (value: unknown): ExpenseReportTargetType => {
  if (value === 'expense' || value === 'expense_group') {
    return value
  }
  return 'expense'
}

export const normalizeExpenseReportDateMode = (value: unknown): ExpenseReportDateMode => {
  if (value === 'manual' || value === 'auto') {
    return value
  }
  return 'auto'
}
