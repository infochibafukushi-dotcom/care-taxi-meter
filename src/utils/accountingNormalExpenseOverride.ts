import { detectFixedAssetRegistrationWarning } from './accountingAssetDetection'
import {
  buildEmptyExpenseAssetDraft,
  type ExpenseAssetRegistrationDraft,
  type StoredAccountingFixedAsset,
} from '../types/accountingFixedAssets'
import { buildAssetDraftFromLinkedFixedAsset } from './accountingExpenseFixedAssetSync'

export const NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID = 'normal-expense-override-confirm'
export const NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID = 'normal-expense-override-reason'
export const NORMAL_EXPENSE_OVERRIDE_SECTION_ID = 'normal-expense-override-section'
export const ACCOUNTING_EXPENSE_LIST_SECTION_ID = 'accounting-expense-list'

export const NORMAL_EXPENSE_OVERRIDE_CREATE_ERROR =
  '固定資産候補を通常経費として登録するには、確認チェックと理由入力が必要です。'

export const NORMAL_EXPENSE_OVERRIDE_UPDATE_ERROR =
  '固定資産候補を通常経費として更新するには、確認チェックと理由入力が必要です。'

export const NORMAL_EXPENSE_OVERRIDE_REASON_REQUIRED_ERROR =
  '通常経費で登録する理由を入力してください。'

export type NormalExpenseOverrideJudgment = {
  shouldWarn: boolean
  amountMatch: boolean
  keywordMatch: boolean
}

export type NormalExpenseOverrideFields = {
  normalExpenseOverrideConfirmed?: boolean
  normalExpenseOverrideReason?: string
}

export type ExpenseEditSummary = {
  vendorName: string
  description: string
  taxIncludedAmount: number
  receiptDate: string
}

export const buildNormalExpenseOverrideJudgmentKey = (
  judgment: Pick<NormalExpenseOverrideJudgment, 'shouldWarn' | 'amountMatch' | 'keywordMatch'>,
) => `${judgment.shouldWarn ? 1 : 0}:${judgment.amountMatch ? 1 : 0}:${judgment.keywordMatch ? 1 : 0}`

export const detectNormalExpenseOverrideJudgment = (params: {
  amountYen: number
  description?: string
  vendorName?: string
  suggestedCategory?: string
  assetCategory?: string
}): NormalExpenseOverrideJudgment => detectFixedAssetRegistrationWarning(params)

export const resolveStoredNormalExpenseOverride = (
  expense: NormalExpenseOverrideFields,
): { confirmed: boolean; reason: string } => {
  const reason = expense.normalExpenseOverrideReason?.trim() ?? ''
  const confirmed =
    expense.normalExpenseOverrideConfirmed === true ||
    (expense.normalExpenseOverrideConfirmed !== false && reason.length > 0)

  return {
    confirmed: Boolean(confirmed && reason.length > 0),
    reason,
  }
}

export const buildAssetDraftForExpenseEdit = ({
  expense,
  amountYen,
  description = '',
  vendorName = '',
  suggestedCategory = '',
  linkedAsset,
}: {
  expense: NormalExpenseOverrideFields
  amountYen: number
  description?: string
  vendorName?: string
  suggestedCategory?: string
  linkedAsset?: StoredAccountingFixedAsset | null
}): ExpenseAssetRegistrationDraft => {
  if (linkedAsset && linkedAsset.isDeleted !== true) {
    return buildAssetDraftFromLinkedFixedAsset(linkedAsset, {
      acquisitionCost: amountYen,
    })
  }

  const { confirmed, reason } = resolveStoredNormalExpenseOverride(expense)
  const judgment = detectNormalExpenseOverrideJudgment({
    amountYen,
    description,
    vendorName,
    suggestedCategory,
  })

  return {
    ...buildEmptyExpenseAssetDraft(),
    registrationType: 'normal',
    acquisitionCost: amountYen,
    normalExpenseOverrideConfirmed: confirmed,
    normalExpenseOverrideReason: reason,
    normalExpenseOverrideJudgmentKey:
      confirmed && judgment.shouldWarn ? buildNormalExpenseOverrideJudgmentKey(judgment) : '',
  }
}

export const shouldClearNormalExpenseOverrideConfirmation = ({
  confirmed,
  confirmedJudgmentKey,
  currentJudgment,
}: {
  confirmed: boolean
  confirmedJudgmentKey: string
  currentJudgment: NormalExpenseOverrideJudgment
}) => {
  if (!confirmed) {
    return false
  }

  if (!currentJudgment.shouldWarn) {
    return true
  }

  if (!confirmedJudgmentKey) {
    return true
  }

  return buildNormalExpenseOverrideJudgmentKey(currentJudgment) !== confirmedJudgmentKey
}

export const validateNormalExpenseOverrideForSave = ({
  registrationType,
  confirmed,
  reason,
  confirmedJudgmentKey,
  judgment,
  isEditing,
}: {
  registrationType: ExpenseAssetRegistrationDraft['registrationType']
  confirmed: boolean
  reason: string
  confirmedJudgmentKey: string
  judgment: NormalExpenseOverrideJudgment
  isEditing: boolean
}): { ok: true } | { ok: false; message: string; focusTarget: 'checkbox' | 'reason' } => {
  if (registrationType !== 'normal' || !judgment.shouldWarn) {
    return { ok: true }
  }

  const judgmentStillValid =
    confirmed &&
    confirmedJudgmentKey.length > 0 &&
    buildNormalExpenseOverrideJudgmentKey(judgment) === confirmedJudgmentKey

  if (!confirmed || !judgmentStillValid) {
    return {
      ok: false,
      message: isEditing ? NORMAL_EXPENSE_OVERRIDE_UPDATE_ERROR : NORMAL_EXPENSE_OVERRIDE_CREATE_ERROR,
      focusTarget: 'checkbox',
    }
  }

  if (!reason.trim()) {
    return {
      ok: false,
      message: NORMAL_EXPENSE_OVERRIDE_REASON_REQUIRED_ERROR,
      focusTarget: 'reason',
    }
  }

  return { ok: true }
}

export const buildNormalExpenseOverridePersistFields = ({
  registrationType,
  confirmed,
  reason,
  judgment,
}: {
  registrationType: ExpenseAssetRegistrationDraft['registrationType']
  confirmed: boolean
  reason: string
  judgment: NormalExpenseOverrideJudgment
}): Required<NormalExpenseOverrideFields> => {
  const shouldPersist =
    registrationType === 'normal' && confirmed && judgment.shouldWarn && reason.trim().length > 0

  return {
    normalExpenseOverrideConfirmed: shouldPersist,
    normalExpenseOverrideReason: shouldPersist ? reason.trim() : '',
  }
}

export const buildExpenseEditSummary = (expense: {
  vendorName?: string
  description?: string
  taxIncludedAmount?: number
  receiptDate?: string
}): ExpenseEditSummary => ({
  vendorName: expense.vendorName?.trim() || '（仕入先未入力）',
  description: expense.description?.trim() || '（内容未入力）',
  taxIncludedAmount: expense.taxIncludedAmount ?? 0,
  receiptDate: expense.receiptDate?.trim() || '（証憑日未入力）',
})

export const hasUnsavedExpenseEditChanges = ({
  originalForm,
  currentForm,
  originalDraft,
  currentDraft,
}: {
  originalForm: Record<string, unknown>
  currentForm: Record<string, unknown>
  originalDraft: ExpenseAssetRegistrationDraft
  currentDraft: ExpenseAssetRegistrationDraft
}) =>
  JSON.stringify(originalForm) !== JSON.stringify(currentForm) ||
  JSON.stringify(originalDraft) !== JSON.stringify(currentDraft)

export const focusNormalExpenseOverrideField = (focusTarget: 'checkbox' | 'reason') => {
  if (typeof document === 'undefined') {
    return
  }

  const section = document.getElementById(NORMAL_EXPENSE_OVERRIDE_SECTION_ID)
  section?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const fieldId =
    focusTarget === 'reason'
      ? NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID
      : NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID
  const field = document.getElementById(fieldId) as HTMLElement | null
  field?.focus?.()
}
