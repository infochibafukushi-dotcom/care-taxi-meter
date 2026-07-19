import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import './AccountingPage.css'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import {
  buildEmptyExpenseInput,
  createAccountingExpense,
  fetchAccountingExpenses,
  invalidateAccountingExpense,
  softDeleteAccountingExpense,
} from '../services/accountingExpenses'
import {
  createAccountingAdjustment,
  fetchAccountingAdjustments,
  invalidateAccountingAdjustment,
} from '../services/accountingAdjustments'
import { fetchAccountingFixedCosts } from '../services/accountingFixedCosts'
import { fetchAccountingSettlementAuxiliary } from '../services/accountingSettlementAuxiliary'
import {
  applyOcrCandidatesToAccountingReceipt,
  deleteAccountingReceipt,
  discardUnorganizedAccountingReceipt,
  fetchAccountingReceipts,
  fetchUnorganizedAccountingReceipts,
  getAccountingReceiptOriginalFileUrl,
  getAccountingReceiptPreviewImageUrl,
  invalidateAccountingReceipt,
  loadAccountingReceiptOcrImageBlob,
  OCR_IMAGE_UNAVAILABLE_MESSAGE,
  rejectAccountingReceiptWorkflow,
  relinkAccountingReceiptToExpense,
  resolveAccountingReceiptDownloadUrl,
  saveConfirmedAccountingReceipt,
  replaceAccountingReceiptOcrImage,
  saveReceiptOnly,
  softHideAccountingReceipt,
  unlinkAccountingReceiptFromExpense,
  uploadAccountingReceiptFile,
  type StoredAccountingReceipt,
} from '../services/accountingReceipts'
import { fetchAccountingReceiptAccessUrl } from '../services/accountingReceiptAccess'
import { runAccountingReceiptOcr } from '../services/accountingReceiptOcr'
import { lookupInvoiceRegistrant } from '../services/invoiceRegistrantLookup'
import { INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE } from '../services/accountingInvoiceLookupHistory'
import type { InvoiceLookupAuditContext } from '../services/accountingInvoiceLookupHistory'
import {
  ACCOUNTING_RECEIPT_FILE_ACCEPT,
  isAccountingReceiptPdfMime,
  validateAccountingReceiptUploadFile,
} from '../utils/accountingReceiptFile'
import {
  ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_ACTIVE_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_ARIA_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_HINT,
  ACCOUNTING_RECEIPT_DROP_ZONE_TITLE,
  ACCOUNTING_RECEIPT_READ_FAILED_MESSAGE,
  ACCOUNTING_RECEIPT_REPLACE_CONFIRM_MESSAGE,
  advanceDropZoneDragDepth,
  formatAccountingReceiptFileTypeLabel,
  formatAccountingReceiptSelectionSummary,
  hasExistingAccountingReceiptAttachment,
  isDropZoneDragActive,
  preventBrowserFileNavigation,
  resolveAccountingReceiptAttachmentStatus,
  resolvePendingUnorganizedReceiptIdsToDiscard,
  resolveReplacedUnorganizedReceiptIdToDiscard,
  resolveSelectedAccountingReceiptFiles,
  shouldOpenFilePickerFromDropZoneTarget,
  shouldOpenFilePickerFromKeyboard,
  shouldPromptReceiptReplacement,
} from '../utils/accountingReceiptDropZone'
import { normalizeAccountingReceiptImage } from '../utils/accountingReceiptImage'
import { createAccountingPdfPreview } from '../utils/accountingReceiptPdf'
import {
  RECEIPT_ROTATION_ERROR_MESSAGE,
  RECEIPT_ROTATION_OCR_RERUN_MESSAGE,
  hasAccountingReceiptOcrResult,
  resolveNextReceiptRotationDegrees,
  rotateAccountingReceiptImage,
  shouldFlagOcrRerunAfterRotation,
  type ReceiptRotationDegrees,
} from '../utils/accountingReceiptRotation'
import { fetchAccountingExports, recordAccountingExport } from '../services/accountingExports'
import { clearAuthStaffSession, loadAuthStaffSession } from '../services/authSession'
import { signOutFirebaseAuth } from '../services/firebaseAuth'
import { formatFareYen } from '../services/fare'
import {
  ACCOUNTING_AUTH_REQUIRED_MESSAGE,
  ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT,
  collectAccountingSessionDiagnostics,
  formatAccountingQueryErrorMessage,
  isAccountingDebugEnabled,
  logAccountingQueryFailure,
  resolveAccountingSessionContext,
  validateAccountingFirebaseAuth,
  type AccountingSessionDiagnostics,
} from '../services/accountingTenant'
import { useWorkSession } from '../hooks/useWorkSession'
import type { StaffRole } from '../types/work'
import {
  EXPENSE_CATEGORIES,
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PL_TREATMENTS,
  PL_TREATMENT_LABELS,
  SALES_CATEGORIES,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  VARIABLE_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  getExpenseReceiptDate,
  getPlTreatmentLabel,
  isExpenseDeleted,
  isExpenseEligibleForReporting,
  normalizePlTreatment,
  type AccountingAdjustmentInput,
  type AccountingExpenseInput,
  type ExpenseCategory,
  type ExpenseConfirmationStatus,
  type InvoiceStatus,
  type MonthlyProfitLoss,
  type PlTreatment,
  type SalesCategory,
  type TaxCategory,
  ACCOUNTING_EXPORT_SCHEMA_VERSION,
  formatAccountingExportTypeLabel,
  type AccountingExportPackageRecordPayload,
  type StoredAccountingExport,
} from '../types/accounting'
import { canAccessAccounting } from '../types/permissions'
import { ExpenseCategoryHelpDialog } from '../components/accounting/ExpenseCategoryHelpDialog'
import { ExpenseListFilterPanel } from '../components/accounting/ExpenseListFilterPanel'
import { FixedCostManagementPanel } from '../components/accounting/FixedCostManagementPanel'
import { ExpenseAssetBranchPanel } from '../components/accounting/ExpenseAssetBranchPanel'
import { FixedAssetLedgerPanel } from '../components/accounting/FixedAssetLedgerPanel'
import { AuditMaterialsPanel } from '../components/accounting/AuditMaterialsPanel'
import { ETaxSettlementPanel } from '../components/accounting/ETaxSettlementPanel'
import { TaxAdvisorPackagePanel } from '../components/accounting/TaxAdvisorPackagePanel'
import { SubmissionPackagePanel } from '../components/accounting/SubmissionPackagePanel'
import { UnorganizedReceiptsPanel } from '../components/accounting/UnorganizedReceiptsPanel'
import {
  selectAccountingReceiptInbox,
} from '../utils/accountingReceiptLink'
import {
  IMAGE_HARD_DELETE_CONFIRM_MESSAGE,
  IMAGE_SOFT_HIDE_DELETE_REASON,
  IMAGE_SOFT_HIDE_MESSAGE,
  resolveAccountingImageDeleteAction,
} from '../utils/accountingImageDeletePolicy'
import {
  fetchAccountingFixedAssets,
} from '../services/accountingFixedAssets'
import { saveExpenseWithFixedAssetSync } from '../services/accountingExpenseFixedAssetSave'
import {
  isValidChassisNumberFormat,
  normalizeChassisNumber,
  parseModelYearInput,
  validateModelYearValue,
} from '../utils/accountingVehicleAssetFields'
import {
  buildEmptyExpenseAssetDraft,
  type ExpenseAssetRegistrationDraft,
  type ExpenseRegistrationType,
  type StoredAccountingFixedAsset,
} from '../types/accountingFixedAssets'
import type { StoredAccountingSettlementAuxiliary } from '../types/accountingSettlementAuxiliary'
import {
  buildExpensesCsv,
  buildMonthlyPlCsv,
  buildSalesCsv,
  buildYearlyPlCsv,
  buildYearlyPlCsvFileName,
  downloadCsvFile,
  formatPlAmount,
} from '../utils/accountingCsv'
import { computeFileSha256 } from '../utils/imageHash'
import {
  recordAccountingExportOperation,
  shortFingerprint,
} from '../utils/accountingExportHistory'
import {
  ACCOUNTING_EXPENSE_LIST_SECTION_ID,
  buildAssetDraftForExpenseEdit,
  buildExpenseEditSummary,
  buildNormalExpenseOverridePersistFields,
  detectNormalExpenseOverrideJudgment,
  focusNormalExpenseOverrideField,
  hasUnsavedExpenseEditChanges,
  shouldClearNormalExpenseOverrideConfirmation,
  validateNormalExpenseOverrideForSave,
  type ExpenseEditSummary,
} from '../utils/accountingNormalExpenseOverride'
import {
  EXPENSE_LIST_CONFIRMATION_STATUS_HEADER,
  EXPENSE_LIST_RECEIPT_PENDING_LABEL,
  formatExpenseListBillingInvoiceNumber,
  formatExpenseListConfirmationStatus,
  formatExpenseListInvoiceNumber,
  formatExpenseListInvoiceStatus,
  getExpenseListActionStatusLabel,
} from '../utils/accountingExpenseListDisplay'
import {
  DEFAULT_EXPENSE_LIST_FILTERS,
  queryExpenseList,
  selectExpensesForFilteredCsv,
  type ExpenseListFilters,
} from '../utils/accountingExpenseListQuery'
import { buildAccountingSalesRows, calculateSalesIntegrityCheck, EXPENSE_FARE_SALES_WARNING, filterCaseRecordsByYearMonth, SALES_INTEGRITY_WARNING, sumExpenseFareYenFromCaseRecords } from '../utils/accountingSalesMapping'
import {
  aggregateExpensesByInvoiceStatus,
  aggregateExpensesByTaxCategory,
  buildCalendarYearOptions,
  buildYearMonthOptions,
  calculateMonthlyProfitLoss,
  calculateYearlyProfitLoss,
  formatInvoiceStatusAggregationLabel,
  formatTaxCategoryAggregationLabel,
  formatYearMonthLabel,
  formatFiscalYearLabel,
  getCurrentCalendarYearInJapan,
  getCurrentYearMonthInJapan,
  getYearlyProfitLossColumnOrder,
  SALES_CATEGORIES as PL_SALES_CATEGORIES,
} from '../utils/accountingPl'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from '../utils/accountingFiscalPeriod'
import {
  calculateConsumptionTaxFromIncluded,
  calculateTaxExcludedAmount,
  isPresetTaxRate,
  TAX_RATE_PRESETS,
  type TaxCalculationMode,
} from '../utils/accountingTax'
import {
  type ExpenseDuplicateCandidate,
  type ExpenseDuplicateMatch,
  findExpenseDuplicatesIncludingBilling,
  formatExpenseDuplicateLabel,
  hasBlockingExpenseDuplicate,
} from '../utils/accountingExpenseDuplicate'
import {
  buildAssetCategoryChangeConfirmMessage,
  buildExpenseDeleteWithLinkedAssetConfirmMessage,
  resolveLinkedFixedAssetsForExpense,
} from '../utils/accountingExpenseFixedAssetSync'
import { formatCaseDateTime } from '../utils/caseRecords'
import {
  applyAccountingReceiptOcrToExpense,
  buildExpenseFormFromReceipt,
  buildReceiptCandidateFieldsFromExpense,
  formatOcrProcessedAt,
  formatYenInputDisplay,
  hasAccountingFormReceiptImage,
  hasStoredAccountingReceiptOcrImage,
  isPostingDateInPastMonth,
  OCR_AUTO_APPLY_CONFIDENCE_THRESHOLD,
  OCR_NOT_CONFIGURED_MESSAGE,
  parseYenInput,
  PAST_MONTH_POSTING_DATE_NOTICE,
  POSTING_DATE_FIELD_LABEL,
  POSTING_DATE_HELP_TEXT,
  RECEIPT_IMAGE_REQUIRED_MESSAGE,
  shouldAutoApplyOcrCandidates,
  validateInvoiceNumberCandidate,
} from '../utils/accountingExpenseForm'
import type { SalesIntegrityCheck } from '../utils/accountingSalesMapping'

type AccountingTab =
  | 'expenses'
  | 'unorganized-receipts'
  | 'pl-monthly'
  | 'pl-yearly'
  | 'fixed-costs'
  | 'fixed-assets'
  | 'audit'
  | 'etax'
  | 'tax-advisor'
  | 'submission'
  | 'export'
  | 'sales'

const ACCOUNTING_MAIN_MENU: Array<{ tab: AccountingTab; label: string }> = [
  { tab: 'expenses', label: '経費登録' },
  { tab: 'unorganized-receipts', label: '未整理の領収書' },
  { tab: 'pl-monthly', label: '月次PL' },
  { tab: 'pl-yearly', label: '年次PL（暦年・管理会計）' },
  { tab: 'fixed-costs', label: '固定費管理' },
  { tab: 'fixed-assets', label: '固定資産台帳' },
  { tab: 'audit', label: '監査資料' },
  { tab: 'export', label: 'CSV・PDF出力' },
  { tab: 'etax', label: 'e-Tax入力用決算資料' },
  { tab: 'tax-advisor', label: '税理士相談用 一式資料' },
  { tab: 'submission', label: '税務確認・提出資料' },
]

const confirmationStatusOptions: ExpenseConfirmationStatus[] = ['未確認', '確認済み', '無効']

function PlCategoryRows({
  categories,
  amounts,
  emptyLabel = '該当なし',
}: {
  categories: readonly ExpenseCategory[]
  amounts: Record<ExpenseCategory, number>
  emptyLabel?: string
}) {
  const visible = categories.filter((category) => amounts[category] > 0)
  if (visible.length === 0) {
    return (
      <li>
        <span>{emptyLabel}</span>
        <strong>{formatPlAmount(0)}</strong>
      </li>
    )
  }

  return (
    <>
      {visible.map((category) => (
        <li key={category}>
          <span>{category}</span>
          <strong>{formatPlAmount(amounts[category])}</strong>
        </li>
      ))}
    </>
  )
}

function MonthlyManagementPlSections({
  profitLoss,
  showExpenseFareSalesWarning,
}: {
  profitLoss: MonthlyProfitLoss
  showExpenseFareSalesWarning: boolean
}) {
  return (
    <div className="accounting-pl-grid">
      <section>
        <h3>売上</h3>
        <ul className="accounting-pl-list">
          {PL_SALES_CATEGORIES.map((category) => (
            <li key={category}>
              <span>{category}</span>
              <strong>{formatPlAmount(profitLoss.sales[category])}</strong>
            </li>
          ))}
          <ExpenseFareSalesWarning visible={showExpenseFareSalesWarning} />
          <li className="accounting-pl-total">
            <span>売上小計</span>
            <strong>{formatPlAmount(profitLoss.salesTotalYen)}</strong>
          </li>
        </ul>
      </section>
      <section>
        <h3>売上原価</h3>
        <ul className="accounting-pl-list">
          <PlCategoryRows categories={COST_OF_SALES_CATEGORIES} amounts={profitLoss.costOfSales} />
          <li className="accounting-pl-total">
            <span>売上原価小計</span>
            <strong>{formatPlAmount(profitLoss.costOfSalesTotalYen)}</strong>
          </li>
        </ul>
      </section>
      <section className="accounting-pl-profit accounting-pl-gross">
        <h3>粗利益</h3>
        <p>
          <span>粗利益（売上小計 − 売上原価小計）</span>
          <strong>{formatPlAmount(profitLoss.grossProfitYen)}</strong>
        </p>
      </section>
      <section>
        <h3>固定費</h3>
        <ul className="accounting-pl-list">
          <PlCategoryRows categories={FIXED_EXPENSE_CATEGORIES} amounts={profitLoss.fixedCosts} />
          <li className="accounting-pl-total">
            <span>固定費小計</span>
            <strong>{formatPlAmount(profitLoss.fixedCostsTotalYen)}</strong>
          </li>
        </ul>
      </section>
      <section>
        <h3>変動費</h3>
        <ul className="accounting-pl-list">
          <PlCategoryRows categories={VARIABLE_EXPENSE_CATEGORIES} amounts={profitLoss.variableExpenses} />
          <li className="accounting-pl-total">
            <span>変動費小計</span>
            <strong>{formatPlAmount(profitLoss.variableExpensesTotalYen)}</strong>
          </li>
        </ul>
      </section>
      <section className="accounting-pl-deferred">
        <h3>繰延資産候補</h3>
        <p className="accounting-note">
          PL反映区分が「繰延資産候補」の確認済み経費です。固定費・変動費・営業利益には含めません。
        </p>
        <ul className="accounting-pl-list">
          <PlCategoryRows categories={EXPENSE_CATEGORIES} amounts={profitLoss.deferredCandidate} />
          <li className="accounting-pl-total">
            <span>繰延資産候補合計</span>
            <strong>{formatPlAmount(profitLoss.deferredCandidateTotalYen)}</strong>
          </li>
        </ul>
      </section>
      <section className="accounting-pl-profit">
        <h3>最終利益</h3>
        <p>
          <span>営業利益（純利益）</span>
          <strong>{formatPlAmount(profitLoss.operatingProfitYen)}</strong>
        </p>
        <p className="accounting-note">粗利益 − 固定費小計 − 変動費小計</p>
      </section>
    </div>
  )
}

function SalesIntegrityCheckPanel({ check }: { check: SalesIntegrityCheck }) {
  return (
    <section className="accounting-integrity-check" aria-label="売上整合性チェック">
      <h3>売上整合性チェック</h3>
      <ul className="accounting-integrity-list">
        <li>
          <span>メーター請求額合計（actualFareYen）</span>
          <strong>{formatPlAmount(check.meterBillingTotalYen)}</strong>
        </li>
        <li>
          <span>PL反映売上合計</span>
          <strong>{formatPlAmount(check.plSalesTotalYen)}</strong>
        </li>
        <li>
          <span>差額</span>
          <strong>{formatPlAmount(check.differenceYen)}</strong>
        </li>
      </ul>
      {check.differenceYen !== 0 ? (
        <p className="accounting-warning" role="alert">
          {SALES_INTEGRITY_WARNING}
        </p>
      ) : null}
    </section>
  )
}

function ExpenseFareSalesWarning({ visible }: { visible: boolean }) {
  if (!visible) {
    return null
  }

  return (
    <li className="accounting-pl-other-note">
      <p className="accounting-warning accounting-warning--info" role="note">
        {EXPENSE_FARE_SALES_WARNING}
      </p>
    </li>
  )
}

function DuplicateExpensePromptDialog({
  matches,
  severity,
  onReviewExisting,
  onContinue,
  onCancel,
}: {
  matches: ExpenseDuplicateMatch[]
  severity: 'warning' | 'strong' | 'blocking'
  onReviewExisting: (expenseId: string) => void
  onContinue: () => void
  onCancel: () => void
}) {
  const primaryMatch = matches[0]
  if (!primaryMatch) {
    return null
  }

  const title =
    severity === 'blocking'
      ? '同一仕入先・同一請求書番号の経費が既に登録されています。保存できません。'
      : severity === 'strong'
        ? '同じ領収書画像が既に登録されています。二重計上の可能性が高いです。'
        : '同じ日付・同じ金額の経費が既に登録されています。二重計上の可能性があります。'

  return (
    <div className="accounting-duplicate-dialog-backdrop" role="presentation">
      <section
        className="accounting-duplicate-dialog"
        role="alertdialog"
        aria-labelledby="accounting-duplicate-dialog-title"
        aria-describedby="accounting-duplicate-dialog-body"
      >
        <h3 id="accounting-duplicate-dialog-title">{title}</h3>
        <div id="accounting-duplicate-dialog-body" className="accounting-duplicate-dialog-body">
          <p>既存登録：</p>
          <ul>
            {matches.map((match) => (
              <li key={match.expense.id}>
                {formatExpenseDuplicateLabel(match.expense)}
                <br />
                <span className="accounting-note">
                  証憑日 {getExpenseReceiptDate(match.expense)} / 仕入先{' '}
                  {match.expense.vendorName || '－'} / 内容{' '}
                  {match.expense.description || '－'} / 金額{' '}
                  {formatFareYen(match.expense.taxIncludedAmount)} / 確認状態{' '}
                  {match.expense.confirmationStatus}
                </span>
              </li>
            ))}
          </ul>
          {severity === 'blocking' ? (
            <p>請求書番号が一致するため、このまま登録することはできません。</p>
          ) : (
            <p>このまま登録しますか？</p>
          )}
        </div>
        <div className="accounting-duplicate-dialog-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => onReviewExisting(primaryMatch.expense.id)}
          >
            既存を確認
          </button>
          {severity !== 'blocking' ? (
            <button className="primary-action" type="button" onClick={onContinue}>
              登録を続ける
            </button>
          ) : null}
          <button className="secondary-action" type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </section>
    </div>
  )
}

function ImageDeleteConfirmDialog({
  mode,
  busy,
  onCancel,
  onConfirm,
}: {
  mode: 'hard_delete' | 'soft_hide'
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const title =
    mode === 'hard_delete' ? IMAGE_HARD_DELETE_CONFIRM_MESSAGE : IMAGE_SOFT_HIDE_MESSAGE

  return (
    <div className="accounting-duplicate-dialog-backdrop" role="presentation">
      <section
        className="accounting-duplicate-dialog"
        role="alertdialog"
        aria-labelledby="accounting-image-delete-dialog-title"
        aria-busy={busy}
      >
        <h3 id="accounting-image-delete-dialog-title">{title}</h3>
        <div className="accounting-duplicate-dialog-actions">
          <button className="secondary-action" type="button" disabled={busy} onClick={onCancel}>
            キャンセル
          </button>
          {mode === 'hard_delete' ? (
            <button
              className="accounting-image-delete-confirm-button"
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? '削除中…' : '完全に削除'}
            </button>
          ) : (
            <button className="primary-action" type="button" disabled={busy} onClick={onConfirm}>
              {busy ? '処理中…' : '非表示にする'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

export function AccountingPage() {
  const [searchParams] = useSearchParams()
  const showAccountingDiagnostics = useMemo(() => isAccountingDebugEnabled(searchParams), [searchParams])
  const workSession = useWorkSession()
  const authSession = useMemo(() => loadAuthStaffSession(), [])
  const { tenant: tenantScope, accessScope } = useMemo(
    () =>
      resolveAccountingSessionContext({
        authSession,
        workSession: workSession.currentSession,
      }),
    [authSession, workSession.currentSession],
  )
  const role = (accessScope.role ?? '') as StaffRole | ''
  const accessScopeKey = `${accessScope.role ?? ''}|${accessScope.franchiseeId ?? ''}|${accessScope.storeId ?? ''}|${accessScope.staffId ?? ''}`
  const staffId = accessScope.staffId ?? authSession?.id ?? workSession.currentSession?.staffId ?? ''
  const staffName =
    workSession.currentSession?.staffName ?? authSession?.name ?? '経理担当'
  const storeName = workSession.currentSession?.storeName ?? ''

  const [activeTab, setActiveTab] = useState<AccountingTab>('expenses')
  const [targetYearMonth, setTargetYearMonth] = useState(getCurrentYearMonthInJapan())
  const [targetYear, setTargetYear] = useState(getCurrentCalendarYearInJapan())
  const [expenseListFilters, setExpenseListFilters] = useState<ExpenseListFilters>(
    DEFAULT_EXPENSE_LIST_FILTERS,
  )
  const [expenseSearchInput, setExpenseSearchInput] = useState('')
  const [expenseFiltersExpanded, setExpenseFiltersExpanded] = useState(false)
  const [expenseCsvScope, setExpenseCsvScope] = useState<'filtered' | 'all'>('all')
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [expenses, setExpenses] = useState<Awaited<ReturnType<typeof fetchAccountingExpenses>>>([])
  const [adjustments, setAdjustments] = useState<Awaited<ReturnType<typeof fetchAccountingAdjustments>>>([])
  const [fixedCosts, setFixedCosts] = useState<Awaited<ReturnType<typeof fetchAccountingFixedCosts>>>([])
  const [fixedAssets, setFixedAssets] = useState<StoredAccountingFixedAsset[]>([])
  const [settlementAuxiliary, setSettlementAuxiliary] = useState<StoredAccountingSettlementAuxiliary | null>(null)
  const [settlementAuxiliaryLoadError, setSettlementAuxiliaryLoadError] = useState('')
  /** Firebase Auth 無効時は空一覧を「0件」と見せず、再ログインを促す */
  const [authBlockedMessage, setAuthBlockedMessage] = useState('')
  const [expensesLoadFailed, setExpensesLoadFailed] = useState(false)
  const [assetDraft, setAssetDraft] = useState<ExpenseAssetRegistrationDraft>(buildEmptyExpenseAssetDraft)
  const [editingExpenseBaseline, setEditingExpenseBaseline] = useState<{
    form: AccountingExpenseInput
    draft: ExpenseAssetRegistrationDraft
  } | null>(null)
  const [editingExpenseSummary, setEditingExpenseSummary] = useState<ExpenseEditSummary | null>(null)
  const [expenseFormActionError, setExpenseFormActionError] = useState('')
  const [sessionDiagnostics, setSessionDiagnostics] = useState<AccountingSessionDiagnostics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [exportHistory, setExportHistory] = useState<StoredAccountingExport[]>([])
  const [exportHistoryLoading, setExportHistoryLoading] = useState(false)
  const [exportHistoryError, setExportHistoryError] = useState('')
  const [expandedExportHistoryId, setExpandedExportHistoryId] = useState('')
  const [expenseForm, setExpenseForm] = useState<AccountingExpenseInput | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const isSavingExpenseRef = useRef(false)
  const [isDeletingReceipt, setIsDeletingReceipt] = useState(false)
  const isDeletingReceiptRef = useRef(false)
  const [imageDeletePrompt, setImageDeletePrompt] = useState<{
    receipt: StoredAccountingReceipt
    mode: 'hard_delete' | 'soft_hide'
  } | null>(null)
  const clientExpenseIdRef = useRef<string>('')
  const baselineRegistrationTypeRef = useRef<ExpenseRegistrationType>('normal')
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false)
  const [isRunningOcr, setIsRunningOcr] = useState(false)
  const [ocrRunningReceiptId, setOcrRunningReceiptId] = useState('')
  const [isConsumptionTaxManual, setIsConsumptionTaxManual] = useState(false)
  const [ocrCandidateNotice, setOcrCandidateNotice] = useState('')
  const [invoiceNumberWarning, setInvoiceNumberWarning] = useState('')
  const [unorganizedReceipts, setUnorganizedReceipts] = useState<StoredAccountingReceipt[]>([])
  const [focusReceiptId, setFocusReceiptId] = useState('')
  const [allReceipts, setAllReceipts] = useState<StoredAccountingReceipt[]>([])
  const [isSavingReceiptOnly, setIsSavingReceiptOnly] = useState(false)
  const [recentReceiptBlobs, setRecentReceiptBlobs] = useState<Record<string, Blob>>({})
  const [ocrStatusByReceiptId, setOcrStatusByReceiptId] = useState<Record<string, string>>({})
  const [ocrProgressMessage, setOcrProgressMessage] = useState('')
  const [receiptPreviewObjectUrl, setReceiptPreviewObjectUrl] = useState('')
  /** receiptId をキーにした短期署名プレビューURL（expenseForm には保存しない） */
  const [receiptAccessPreviewUrl, setReceiptAccessPreviewUrl] = useState<{
    receiptId: string
    url: string
  } | null>(null)
  const [isOpeningReceiptOriginal, setIsOpeningReceiptOriginal] = useState(false)
  const [receiptDropDepth, setReceiptDropDepth] = useState(0)
  const [receiptLocalSelectionActive, setReceiptLocalSelectionActive] = useState(false)
  const [receiptSelectionError, setReceiptSelectionError] = useState(false)
  const [receiptSelectedFileMeta, setReceiptSelectedFileMeta] = useState<{
    name: string
    summary: string
  } | null>(null)
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null)
  const receiptUploadInFlightRef = useRef(false)
  const pendingUnorganizedReceiptIdsRef = useRef<string[]>([])
  const [adjustmentForm, setAdjustmentForm] = useState<AccountingAdjustmentInput | null>(null)
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false)
  const [isExpenseCategoryHelpOpen, setIsExpenseCategoryHelpOpen] = useState(false)
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    matches: ExpenseDuplicateMatch[]
    severity: 'warning' | 'strong' | 'blocking'
    onContinue: () => void
  } | null>(null)
  const [receiptImageZoom, setReceiptImageZoom] = useState(1)
  const [receiptRotationDegrees, setReceiptRotationDegrees] = useState<ReceiptRotationDegrees>(0)
  const [receiptRotationBaseFile, setReceiptRotationBaseFile] = useState<File | null>(null)
  const [receiptRotationBaseReceiptId, setReceiptRotationBaseReceiptId] = useState('')
  const [needsOcrRerunAfterRotation, setNeedsOcrRerunAfterRotation] = useState(false)
  const [isRotatingReceipt, setIsRotatingReceipt] = useState(false)
  const receiptRotateInFlightRef = useRef(false)
  const [isLookingUpInvoice, setIsLookingUpInvoice] = useState(false)
  const [isAuditMenuOpen, setIsAuditMenuOpen] = useState(false)
  const [invoiceQuoteMessage, setInvoiceQuoteMessage] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)
  const [invoiceLookupHistoryWarning, setInvoiceLookupHistoryWarning] = useState('')

  const yearMonthOptions = useMemo(() => buildYearMonthOptions(18), [])
  const calendarYearOptions = useMemo(() => buildCalendarYearOptions(5), [])

  const canAccess = canAccessAccounting(role)

  const reloadExportHistory = async () => {
    setExportHistoryLoading(true)
    setExportHistoryError('')
    try {
      const rows = await fetchAccountingExports(accessScope)
      setExportHistory(rows)
    } catch (error) {
      setExportHistoryError(
        error instanceof Error ? error.message : '出力操作履歴の取得に失敗しました。',
      )
    } finally {
      setExportHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'export' || !canAccess) {
      return
    }
    void reloadExportHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when tab becomes export
  }, [activeTab, canAccess, accessScopeKey])

  useEffect(() => {
    return () => {
      if (receiptPreviewObjectUrl) {
        URL.revokeObjectURL(receiptPreviewObjectUrl)
      }
    }
  }, [receiptPreviewObjectUrl])

  useEffect(() => {
    if (assetDraft.registrationType !== 'normal') {
      return
    }

    if (!assetDraft.normalExpenseOverrideConfirmed) {
      return
    }

    const currentJudgment = detectNormalExpenseOverrideJudgment({
      amountYen: assetDraft.acquisitionCost || expenseForm?.taxIncludedAmount || 0,
      description: expenseForm?.description ?? '',
      vendorName: expenseForm?.vendorName ?? '',
      suggestedCategory: expenseForm?.suggestedExpenseCategory ?? '',
    })

    if (
      !shouldClearNormalExpenseOverrideConfirmation({
        confirmed: assetDraft.normalExpenseOverrideConfirmed,
        confirmedJudgmentKey: assetDraft.normalExpenseOverrideJudgmentKey,
        currentJudgment,
      })
    ) {
      return
    }

    setAssetDraft((current) => {
      if (
        !shouldClearNormalExpenseOverrideConfirmation({
          confirmed: current.normalExpenseOverrideConfirmed,
          confirmedJudgmentKey: current.normalExpenseOverrideJudgmentKey,
          currentJudgment,
        })
      ) {
        return current
      }

      return {
        ...current,
        normalExpenseOverrideConfirmed: false,
        normalExpenseOverrideJudgmentKey: '',
      }
    })
  }, [
    assetDraft.acquisitionCost,
    assetDraft.normalExpenseOverrideConfirmed,
    assetDraft.normalExpenseOverrideJudgmentKey,
    assetDraft.registrationType,
    expenseForm?.description,
    expenseForm?.suggestedExpenseCategory,
    expenseForm?.taxIncludedAmount,
    expenseForm?.vendorName,
  ])

  const clearReceiptPreviewObjectUrl = () => {
    setReceiptPreviewObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }

      return ''
    })
  }

  const clearReceiptRotationState = () => {
    setReceiptRotationDegrees(0)
    setReceiptRotationBaseFile(null)
    setReceiptRotationBaseReceiptId('')
    setNeedsOcrRerunAfterRotation(false)
    setIsRotatingReceipt(false)
    receiptRotateInFlightRef.current = false
  }

  const setReceiptPreviewFromFile = (file: File) => {
    const previewUrl = URL.createObjectURL(file)
    setReceiptPreviewObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }

      return previewUrl
    })
  }

  useEffect(() => {
    if (!canAccess) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    const loadData = async () => {
      setIsLoading(true)
      setErrorMessage('')
      setAuthBlockedMessage('')
      setExpensesLoadFailed(false)

      const diagnostics = showAccountingDiagnostics
        ? await collectAccountingSessionDiagnostics({
            authSession,
            workSession: workSession.currentSession,
            logToConsole: true,
          })
        : null
      const authValidationError = await validateAccountingFirebaseAuth({ authSession })

      const loadErrors: string[] = []

      if (authValidationError) {
        if (cancelled) {
          return
        }
        // ローカルセッションだけ残っている場合は破棄し、空の経費一覧を出さない
        clearAuthStaffSession()
        void signOutFirebaseAuth()
        setAuthBlockedMessage(authValidationError || ACCOUNTING_AUTH_REQUIRED_MESSAGE)
        setErrorMessage(authValidationError || ACCOUNTING_AUTH_REQUIRED_MESSAGE)
        setSessionDiagnostics(showAccountingDiagnostics ? diagnostics : null)
        setIsLoading(false)
        return
      }

      let records: StoredCaseRecord[] | null = null
      let expenseRows: Awaited<ReturnType<typeof fetchAccountingExpenses>> | null = null
      let adjustmentRows: Awaited<ReturnType<typeof fetchAccountingAdjustments>> | null = null
      let fixedCostRows: Awaited<ReturnType<typeof fetchAccountingFixedCosts>> | null = null
      let fixedAssetRows: StoredAccountingFixedAsset[] | null = null
      let unorganizedRows: StoredAccountingReceipt[] | null = null
      let allReceiptRows: StoredAccountingReceipt[] | null = null

      try {
        records = await fetchCaseRecords(accessScope)
      } catch (error) {
        logAccountingQueryFailure('caseRecords', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('caseRecords', error))
      }

      try {
        expenseRows = await fetchAccountingExpenses(accessScope)
      } catch (error) {
        logAccountingQueryFailure('accountingExpenses', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingExpenses', error))
        if (!cancelled) {
          setExpensesLoadFailed(true)
        }
      }

      try {
        adjustmentRows = await fetchAccountingAdjustments(accessScope)
      } catch (error) {
        logAccountingQueryFailure('accountingAdjustments', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingAdjustments', error))
      }

      try {
        fixedCostRows = await fetchAccountingFixedCosts(accessScope)
      } catch (error) {
        logAccountingQueryFailure('accountingFixedCosts', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingFixedCosts', error))
      }

      try {
        fixedAssetRows = await fetchAccountingFixedAssets(accessScope)
      } catch (error) {
        logAccountingQueryFailure('accountingFixedAssets', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingFixedAssets', error))
      }

      try {
        unorganizedRows = await fetchUnorganizedAccountingReceipts(
          accessScope,
          expenseRows ?? [],
        )
      } catch (error) {
        logAccountingQueryFailure('accountingReceipts', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingReceipts', error))
      }

      try {
        allReceiptRows = await fetchAccountingReceipts(accessScope)
      } catch (error) {
        logAccountingQueryFailure('accountingReceipts (all)', accessScope, error)
        loadErrors.push(formatAccountingQueryErrorMessage('accountingReceipts (all)', error))
      }

      if (cancelled) {
        return
      }

      setSessionDiagnostics(showAccountingDiagnostics ? diagnostics : null)
      // 成功したソースだけ反映。失敗時に既存 state を [] で上書きしない
      if (records) {
        setCaseRecords(records)
      }
      if (expenseRows) {
        setExpenses(expenseRows)
        setExpensesLoadFailed(false)
      }
      if (adjustmentRows) {
        setAdjustments(adjustmentRows)
      }
      if (fixedCostRows) {
        setFixedCosts(fixedCostRows)
      }
      if (fixedAssetRows) {
        setFixedAssets(fixedAssetRows)
      }
      if (unorganizedRows) {
        setUnorganizedReceipts(unorganizedRows)
      }
      if (allReceiptRows) {
        setAllReceipts(allReceiptRows)
      }
      setErrorMessage(loadErrors.join(' / '))
      setIsLoading(false)
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [accessScopeKey, authSession, canAccess, showAccountingDiagnostics, targetYearMonth, workSession.currentSession])

  useEffect(() => {
    if (!canAccess) {
      setSettlementAuxiliary(null)
      setSettlementAuxiliaryLoadError('')
      return
    }

    let cancelled = false

    const loadSettlement = async () => {
      // Firebase Auth 準備前の get による permission-denied を避ける
      const authValidationError = await validateAccountingFirebaseAuth({ authSession })
      if (authValidationError) {
        if (!cancelled) {
          setSettlementAuxiliary(null)
          setSettlementAuxiliaryLoadError(authValidationError)
        }
        return
      }

      try {
        const row = await fetchAccountingSettlementAuxiliary(accessScope, targetYear)
        if (!cancelled) {
          setSettlementAuxiliary(row)
          setSettlementAuxiliaryLoadError('')
        }
      } catch (error) {
        if (!cancelled) {
          setSettlementAuxiliary(null)
          const message = formatAccountingQueryErrorMessage('accountingSettlementAuxiliary', error)
          setSettlementAuxiliaryLoadError(`${message} / ${ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT}`)
          // 経費一覧の errorMessage は上書きしない（補助資料単独失敗として扱う）
          console.error('[accounting] accountingSettlementAuxiliary isolated failure', {
            collection: 'accountingSettlementAuxiliary',
            errorCode:
              error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code ?? '')
                : '',
          })
        }
      }
    }

    void loadSettlement()

    return () => {
      cancelled = true
    }
  }, [accessScopeKey, authSession, canAccess, targetYear])

  useEffect(() => {
    if (!canAccess || authBlockedMessage || expenseForm) {
      return
    }

    setExpenseForm(
      buildEmptyExpenseInput({
        franchiseeId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        staffId,
        staffName,
      }),
    )
  }, [authBlockedMessage, canAccess, expenseForm, staffId, staffName, tenantScope.franchiseeId, tenantScope.storeId])

  useEffect(() => {
    if (!canAccess || adjustmentForm) {
      return
    }

    setAdjustmentForm({
      franchiseeId: tenantScope.franchiseeId,
      companyId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      adjustmentType: 'sales',
      targetYearMonth,
      salesCategory: 'その他売上',
      expenseCategory: '',
      amountYen: 0,
      description: '',
      confirmationStatus: '未確認',
      createdBy: staffId,
      createdByName: staffName,
      updatedBy: staffId,
      updatedByName: staffName,
    })
  }, [adjustmentForm, canAccess, staffId, staffName, targetYearMonth, tenantScope.franchiseeId, tenantScope.storeId])

  const monthCaseRecords = useMemo(
    () => filterCaseRecordsByYearMonth(caseRecords, targetYearMonth),
    [caseRecords, targetYearMonth],
  )
  const salesRows = useMemo(() => buildAccountingSalesRows(monthCaseRecords), [monthCaseRecords])
  const profitLoss = useMemo(
    () =>
      calculateMonthlyProfitLoss({
        caseRecords,
        expenses,
        adjustments,
        fixedCosts,
        fixedAssets,
        targetYearMonth,
      }),
    [adjustments, caseRecords, expenses, fixedAssets, fixedCosts, targetYearMonth],
  )
  const yearlyProfitLoss = useMemo(
    () =>
      calculateYearlyProfitLoss({
        caseRecords,
        expenses,
        adjustments,
        fixedCosts,
        fixedAssets,
        targetYear,
      }),
    [adjustments, caseRecords, expenses, fixedAssets, fixedCosts, targetYear],
  )
  const yearlyColumnOrder = useMemo(() => getYearlyProfitLossColumnOrder(), [])
  const monthExpenses = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          getExpensePostingDate(expense).startsWith(targetYearMonth) && !isExpenseDeleted(expense),
      ),
    [expenses, targetYearMonth],
  )
  const reportingMonthExpenses = useMemo(
    () => monthExpenses.filter((expense) => isExpenseEligibleForReporting(expense)),
    [monthExpenses],
  )
  const expenseListQuery = useMemo(
    () => queryExpenseList(expenses, targetYearMonth, expenseListFilters),
    [expenseListFilters, expenses, targetYearMonth],
  )
  const filteredMonthExpenses = expenseListQuery.items
  const filteredReportingExpenses = useMemo(
    () => selectExpensesForFilteredCsv(filteredMonthExpenses),
    [filteredMonthExpenses],
  )

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setExpenseListFilters((current) => {
        if (current.searchQuery === expenseSearchInput) {
          return current
        }
        return { ...current, searchQuery: expenseSearchInput }
      })
    }, 300)
    return () => window.clearTimeout(timerId)
  }, [expenseSearchInput])
  const taxCategorySummary = useMemo(
    () => aggregateExpensesByTaxCategory(expenses, targetYearMonth),
    [expenses, targetYearMonth],
  )
  const invoiceStatusSummary = useMemo(
    () => aggregateExpensesByInvoiceStatus(expenses, targetYearMonth),
    [expenses, targetYearMonth],
  )
  const monthAdjustments = useMemo(
    () => adjustments.filter((adjustment) => adjustment.targetYearMonth === targetYearMonth),
    [adjustments, targetYearMonth],
  )
  const salesIntegrityCheck = useMemo(
    () =>
      calculateSalesIntegrityCheck({
        caseRecords: monthCaseRecords,
        plSalesTotalYen: profitLoss.salesTotalYen,
      }),
    [monthCaseRecords, profitLoss.salesTotalYen],
  )
  const monthExpenseFareTotalYen = useMemo(
    () => sumExpenseFareYenFromCaseRecords(monthCaseRecords),
    [monthCaseRecords],
  )
  const showExpenseFareSalesWarning = monthExpenseFareTotalYen > 0 || profitLoss.sales['その他売上'] > 0

  const hasFormReceiptImage = Boolean(expenseForm && hasAccountingFormReceiptImage(expenseForm))
  const linkedReceiptForForm = useMemo(() => {
    const receiptId = expenseForm?.receiptId?.trim()
    if (!receiptId) {
      return undefined
    }
    return allReceipts.find((row) => row.id === receiptId) ?? unorganizedReceipts.find((row) => row.id === receiptId)
  }, [allReceipts, expenseForm?.receiptId, unorganizedReceipts])
  const expenseReceiptPreviewReceiptId = expenseForm?.receiptId?.trim() || ''
  const expenseReceiptLegacyPreviewUrl =
    expenseForm?.receiptPreviewImageUrl ||
    expenseForm?.receiptImageUrl ||
    (linkedReceiptForForm ? getAccountingReceiptPreviewImageUrl(linkedReceiptForForm) : '') ||
    ''
  const expenseReceiptPreviewStoragePath =
    expenseForm?.receiptPreviewStoragePath ||
    expenseForm?.receiptStoragePath ||
    linkedReceiptForForm?.ocrImageStoragePath ||
    linkedReceiptForForm?.storagePath ||
    ''
  const receiptAccessPreviewUrlForForm =
    receiptAccessPreviewUrl && receiptAccessPreviewUrl.receiptId === expenseReceiptPreviewReceiptId
      ? receiptAccessPreviewUrl.url
      : ''
  const expenseReceiptPreviewUrl =
    receiptPreviewObjectUrl ||
    expenseReceiptLegacyPreviewUrl ||
    receiptAccessPreviewUrlForForm ||
    ''
  const expenseReceiptIsPdf = Boolean(
    isAccountingReceiptPdfMime(expenseForm?.receiptFileMimeType) ||
      isAccountingReceiptPdfMime(linkedReceiptForForm?.mimeType) ||
      isAccountingReceiptPdfMime(linkedReceiptForForm?.originalMimeType) ||
      linkedReceiptForForm?.documentType === 'pdf',
  )
  const expenseReceiptOriginalUrl =
    expenseForm?.receiptFileUrl ||
    (linkedReceiptForForm ? getAccountingReceiptOriginalFileUrl(linkedReceiptForForm) : '') ||
    ''
  const expenseReceiptOriginalStoragePath =
    expenseForm?.receiptFileStoragePath ||
    expenseForm?.receiptStoragePath ||
    linkedReceiptForForm?.originalStoragePath ||
    linkedReceiptForForm?.storagePath ||
    ''
  const expenseReceiptFileName =
    expenseForm?.receiptFileName ||
    linkedReceiptForForm?.originalFileName ||
    linkedReceiptForForm?.fileName ||
    ''
  const expenseReceiptPageCount = linkedReceiptForForm?.pdfPageCount
  const isReceiptDropActive = isDropZoneDragActive(receiptDropDepth)

  // 画像URLを永続化しないため、ローカル選択も旧URLも無い場合のみ receiptId 経由の
  // 短期署名 URL を取得する。expenseForm には保存しない（メモリ内 state のみ）。
  useEffect(() => {
    if (
      receiptPreviewObjectUrl ||
      expenseReceiptLegacyPreviewUrl ||
      !expenseReceiptPreviewReceiptId ||
      !expenseReceiptPreviewStoragePath
    ) {
      return
    }
    if (receiptAccessPreviewUrl?.receiptId === expenseReceiptPreviewReceiptId) {
      return
    }

    let cancelled = false
    fetchAccountingReceiptAccessUrl({ receiptId: expenseReceiptPreviewReceiptId, variant: 'preview' })
      .then((result) => {
        if (!cancelled && result.url) {
          setReceiptAccessPreviewUrl({ receiptId: expenseReceiptPreviewReceiptId, url: result.url })
        }
      })
      .catch(() => {
        // 取得失敗時はプレビュー非表示のまま（永続URLは発行しない）
      })

    return () => {
      cancelled = true
    }
  }, [
    receiptPreviewObjectUrl,
    expenseReceiptLegacyPreviewUrl,
    expenseReceiptPreviewReceiptId,
    expenseReceiptPreviewStoragePath,
    receiptAccessPreviewUrl,
  ])
  const expenseHasPersistedReceipt =
    Boolean(editingExpenseId) &&
    hasExistingAccountingReceiptAttachment(expenseForm) &&
    !receiptLocalSelectionActive
  const receiptAttachmentStatus = resolveAccountingReceiptAttachmentStatus({
    isProcessing: isUploadingReceipt,
    hasError: receiptSelectionError,
    hasLocalSelection: receiptLocalSelectionActive,
    hasPersistedOnExpense: expenseHasPersistedReceipt,
  })
  const receiptAttachmentStatusLabel =
    ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL[receiptAttachmentStatus]
  const receiptMetaName = receiptSelectedFileMeta?.name || expenseReceiptFileName
  const receiptMetaSummary =
    receiptSelectedFileMeta?.summary ||
    (expenseReceiptFileName
      ? formatAccountingReceiptFileTypeLabel({
          name: expenseReceiptFileName,
          type: expenseForm?.receiptFileMimeType || '',
        })
      : '')

  const buildFreshExpenseForm = () =>
    buildEmptyExpenseInput({
      franchiseeId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      staffId,
      staffName,
    })

  const rememberPendingUnorganizedReceipt = (receiptId: string) => {
    const id = receiptId.trim()
    if (!id) {
      return
    }
    if (!pendingUnorganizedReceiptIdsRef.current.includes(id)) {
      pendingUnorganizedReceiptIdsRef.current = [...pendingUnorganizedReceiptIdsRef.current, id]
    }
  }

  const retainPendingUnorganizedUploads = () => {
    pendingUnorganizedReceiptIdsRef.current = []
  }

  const discardPendingUnorganizedReceipts = async () => {
    const toDiscard = resolvePendingUnorganizedReceiptIdsToDiscard({
      pendingReceiptIds: pendingUnorganizedReceiptIdsRef.current,
      protectedReceiptIds: [editingExpenseBaseline?.form.receiptId],
    })
    pendingUnorganizedReceiptIdsRef.current = []
    if (toDiscard.length === 0) {
      return
    }

    await Promise.all(
      toDiscard.map(async (receiptId) => {
        try {
          await discardUnorganizedAccountingReceipt(receiptId)
        } catch {
          // linked / 権限エラー等は既存証憑を壊さないよう握りつぶす
        }
      }),
    )

    try {
      await reloadUnorganizedReceipts()
    } catch {
      // ignore reload failure after best-effort cleanup
    }
  }

  const resetExpenseFormToNew = async (options?: { retainPendingUploads?: boolean }) => {
    if (options?.retainPendingUploads) {
      retainPendingUnorganizedUploads()
    } else {
      await discardPendingUnorganizedReceipts()
    }

    const clearingReceiptId = expenseForm?.receiptId
    setEditingExpenseId('')
    setEditingExpenseBaseline(null)
    setEditingExpenseSummary(null)
    setExpenseFormActionError('')
    setIsConsumptionTaxManual(false)
    setOcrCandidateNotice('')
    setInvoiceNumberWarning('')
    setInvoiceQuoteMessage(null)
    setReceiptImageZoom(1)
    clearReceiptRotationState()
    setIsLookingUpInvoice(false)
    setIsAuditMenuOpen(false)
    setOcrProgressMessage('')
    setReceiptLocalSelectionActive(false)
    setReceiptSelectionError(false)
    setReceiptSelectedFileMeta(null)
    setReceiptDropDepth(0)
    clearReceiptPreviewObjectUrl()
    if (clearingReceiptId) {
      setRecentReceiptBlobs((current) => {
        if (!(clearingReceiptId in current)) {
          return current
        }
        const next = { ...current }
        delete next[clearingReceiptId]
        return next
      })
      setOcrStatusByReceiptId((current) => {
        if (!(clearingReceiptId in current)) {
          return current
        }
        const next = { ...current }
        delete next[clearingReceiptId]
        return next
      })
    }
    setExpenseForm(buildFreshExpenseForm())
    setAssetDraft(buildEmptyExpenseAssetDraft())
    setStatusMessage(
      options?.retainPendingUploads
        ? '入力フォームとプレビューを初期化しました（保存済み領収書は削除していません）。'
        : '入力フォームとプレビューを初期化しました（未確定の一時アップロードは削除しました。経費に保存済みの証憑は残しています）。',
    )
    setErrorMessage('')
  }

  const resetReceiptImageZoomOnly = () => {
    setReceiptImageZoom(1)
  }

  const reloadUnorganizedReceipts = async () => {
    const [expenseRows, receiptRows] = await Promise.all([
      expenses.length > 0 ? Promise.resolve(expenses) : fetchAccountingExpenses(accessScope),
      fetchAccountingReceipts(accessScope),
    ])
    setAllReceipts(receiptRows)
    setUnorganizedReceipts(
      selectAccountingReceiptInbox(receiptRows, expenseRows).map((entry) => entry.receipt),
    )
  }

  const reloadExpensesAdjustmentsAndReceipts = async () => {
    const [expenseRows, adjustmentRows, receiptRows] = await Promise.all([
      fetchAccountingExpenses(accessScope),
      fetchAccountingAdjustments(accessScope),
      fetchAccountingReceipts(accessScope),
    ])
    setExpenses(expenseRows)
    setAdjustments(adjustmentRows)
    setAllReceipts(receiptRows)
    setUnorganizedReceipts(
      selectAccountingReceiptInbox(receiptRows, expenseRows).map((entry) => entry.receipt),
    )
  }

  const receiptInboxEntries = useMemo(
    () => selectAccountingReceiptInbox(allReceipts, expenses),
    [allReceipts, expenses],
  )

  const plainUnorganizedReceipts = useMemo(
    () => receiptInboxEntries.filter((entry) => entry.kind === 'unorganized').map((entry) => entry.receipt),
    [receiptInboxEntries],
  )

  const navigateAccountingTab = (
    tab: AccountingTab,
    options?: { focusReceiptId?: string },
  ) => {
    setActiveTab(tab)
    if (tab === 'unorganized-receipts') {
      setFocusReceiptId(options?.focusReceiptId?.trim() ?? '')
    } else if (options?.focusReceiptId) {
      setFocusReceiptId(options.focusReceiptId.trim())
    }
  }

  const isNewExpenseEntry = !editingExpenseId

  const buildDuplicateCandidateFromForm = (
    form: AccountingExpenseInput,
    expenseId?: string,
  ): ExpenseDuplicateCandidate => ({
    expenseId,
    date: getExpenseReceiptDate(form),
    amount: form.taxIncludedAmount,
    vendorName: form.vendorName,
    description: form.description,
    invoiceNumber: form.invoiceNumber,
    billingInvoiceNumber: form.billingInvoiceNumber,
    imageHash: form.imageHash,
  })

  const promptDuplicateCheckBeforeConfirm = (
    candidate: ExpenseDuplicateCandidate,
    onContinue: () => Promise<void> | void,
  ) => {
    const matches = findExpenseDuplicatesIncludingBilling(expenses, candidate)
    if (matches.length === 0) {
      void onContinue()
      return
    }

    if (hasBlockingExpenseDuplicate(matches)) {
      setDuplicatePrompt({
        matches: matches.filter((match) => match.severity === 'blocking'),
        severity: 'blocking',
        onContinue: () => {
          setDuplicatePrompt(null)
        },
      })
      return
    }

    const severity = matches.some((match) => match.severity === 'strong') ? 'strong' : 'warning'
    setDuplicatePrompt({
      matches,
      severity,
      onContinue: () => {
        setDuplicatePrompt(null)
        void onContinue()
      },
    })
  }

  const currentFormDuplicateMatches = useMemo(() => {
    if (!expenseForm) {
      return []
    }
    return findExpenseDuplicatesIncludingBilling(
      expenses,
      buildDuplicateCandidateFromForm(expenseForm, editingExpenseId || undefined),
    )
  }, [editingExpenseId, expenseForm, expenses])

  const showPastMonthPostingNotice = useMemo(() => {
    if (!expenseForm) {
      return false
    }

    return isPostingDateInPastMonth(getExpensePostingDate(expenseForm))
  }, [expenseForm])

  const applyTaxFields = (
    current: AccountingExpenseInput,
    overrides: Partial<
      Pick<
        AccountingExpenseInput,
        'taxIncludedAmount' | 'taxRate' | 'taxAmount' | 'consumptionTaxAmount' | 'taxCalculationMode'
      >
    >,
  ): AccountingExpenseInput => {
    const taxIncludedAmount = overrides.taxIncludedAmount ?? current.taxIncludedAmount
    const taxRate = Object.prototype.hasOwnProperty.call(overrides, 'taxRate')
      ? (overrides.taxRate as number | null)
      : current.taxRate
    const taxCalculationMode =
      (overrides.taxCalculationMode as TaxCalculationMode | undefined) ??
      current.taxCalculationMode ??
      'auto'
    const shouldAuto =
      taxCalculationMode === 'auto' ||
      (!isConsumptionTaxManual && taxCalculationMode !== 'manual' && taxCalculationMode !== 'ocr')
    const taxAmount = shouldAuto
      ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate)
      : (overrides.taxAmount ??
        overrides.consumptionTaxAmount ??
        current.taxAmount ??
        current.consumptionTaxAmount)

    return {
      ...current,
      ...overrides,
      taxIncludedAmount,
      taxRate,
      taxAmount,
      consumptionTaxAmount: taxAmount ?? 0,
      taxExcludedAmount: calculateTaxExcludedAmount(taxIncludedAmount, taxAmount),
      taxCalculationMode,
      updatedBy: staffId,
      updatedByName: staffName,
    }
  }

  const handleExpenseFieldChange = <K extends keyof AccountingExpenseInput>(
    key: K,
    value: AccountingExpenseInput[K],
  ) => {
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      const next = { ...current, [key]: value, updatedBy: staffId, updatedByName: staffName }

      if (key === 'taxRate') {
        const rate = value as number | null
        if (!isConsumptionTaxManual) {
          return applyTaxFields(current, {
            taxRate: rate,
            taxCalculationMode: 'auto',
          })
        }
        return applyTaxFields(current, {
          taxRate: rate,
          taxCalculationMode: current.taxCalculationMode ?? 'manual',
          taxAmount: current.taxAmount ?? current.consumptionTaxAmount,
        })
      }

      if (key === 'postingDate') {
        next.postingDate = String(value)
        next.transactionDate = String(value)
      }

      if (key === 'receiptDate') {
        next.receiptDate = String(value)
      }

      if (key === 'taxCategory') {
        if (value === 'non_taxable' || value === 'out_of_scope') {
          return applyTaxFields(current, {
            taxRate: 0,
            taxCalculationMode: isConsumptionTaxManual ? 'manual' : 'auto',
            taxAmount: isConsumptionTaxManual
              ? (current.taxAmount ?? current.consumptionTaxAmount)
              : 0,
          })
        }
        if (current.taxRate === 0 || current.taxRate === null) {
          return applyTaxFields(current, {
            taxRate: 10,
            taxCalculationMode: isConsumptionTaxManual ? 'manual' : 'auto',
            taxAmount: isConsumptionTaxManual
              ? (current.taxAmount ?? current.consumptionTaxAmount)
              : undefined,
          })
        }
      }

      if (key === 'invoiceNumber') {
        const validation = validateInvoiceNumberCandidate(String(value))
        setInvoiceNumberWarning(validation.warning)
      }

      if (key === 'confirmationStatus' && value === '確認済み' && !next.expenseCategory) {
        setStatusMessage('経費科目を選択してから確認済みにしてください。')
        return { ...current, confirmationStatus: '未確認' }
      }

      return next
    })
  }

  const handleTaxIncludedAmountChange = (raw: string) => {
    const amount = parseYenInput(raw)
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      return applyTaxFields(current, {
        taxIncludedAmount: amount,
        taxCalculationMode: isConsumptionTaxManual
          ? (current.taxCalculationMode ?? 'manual')
          : 'auto',
        taxAmount: isConsumptionTaxManual
          ? (current.taxAmount ?? current.consumptionTaxAmount)
          : undefined,
      })
    })
  }

  const handleConsumptionTaxAmountChange = (raw: string) => {
    setIsConsumptionTaxManual(true)
    const taxAmount = parseYenInput(raw)
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      return applyTaxFields(current, {
        taxAmount,
        consumptionTaxAmount: taxAmount,
        taxCalculationMode: 'manual',
      })
    })
  }

  const handleTaxRatePresetSelect = (rate: number | null) => {
    if (rate === null) {
      setExpenseForm((current) => {
        if (!current) {
          return current
        }
        return applyTaxFields(current, {
          taxRate: null,
          taxCalculationMode: isConsumptionTaxManual ? 'manual' : 'auto',
          taxAmount: isConsumptionTaxManual
            ? (current.taxAmount ?? current.consumptionTaxAmount)
            : 0,
        })
      })
      return
    }

    handleExpenseFieldChange('taxRate', rate)
  }

  const handleCustomTaxRateChange = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      handleTaxRatePresetSelect(null)
      return
    }
    const parsed = Number(trimmed.replace(/%/g, ''))
    if (!Number.isFinite(parsed)) {
      return
    }
    handleExpenseFieldChange('taxRate', parsed)
  }

  const handleRecalculateConsumptionTax = () => {
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      return applyTaxFields(current, {
        taxCalculationMode: 'auto',
      })
    })
    setIsConsumptionTaxManual(false)
    setStatusMessage('消費税額を再計算しました。')
  }

  const buildInvoiceLookupAuditContext = (
    origin: InvoiceLookupAuditContext['origin'],
    options?: { expenseId?: string; receiptId?: string },
  ): InvoiceLookupAuditContext => ({
    actor: {
      userId: staffId,
      userName: staffName,
      role,
      franchiseeId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
    },
    franchiseeId: tenantScope.franchiseeId,
    storeId: tenantScope.storeId,
    origin,
    expenseId: options?.expenseId || editingExpenseId || undefined,
    receiptId: options?.receiptId || expenseForm?.receiptId || undefined,
    onHistoryPersistFailure: () => {
      setInvoiceLookupHistoryWarning(INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE)
    },
  })

  const handleQuoteInvoiceRegistrant = async () => {
    if (!expenseForm?.invoiceNumber?.trim()) {
      setInvoiceQuoteMessage({
        tone: 'error',
        text: 'インボイス番号を入力してから【引用】を押してください。',
      })
      setErrorMessage('インボイス番号を入力してから【引用】を押してください。')
      return
    }

    setIsLookingUpInvoice(true)
    setErrorMessage('')
    setStatusMessage('')
    setInvoiceQuoteMessage(null)
    setInvoiceLookupHistoryWarning('')
    try {
      const lookup = await lookupInvoiceRegistrant(
        expenseForm.invoiceNumber,
        buildInvoiceLookupAuditContext('manual', {
          expenseId: editingExpenseId || undefined,
          receiptId: expenseForm.receiptId || undefined,
        }),
      )
      if (lookup.status === 'success') {
        const registrant = lookup.registrant
        setExpenseForm((current) =>
          current
            ? {
                ...current,
                vendorName: registrant.registeredName || current.vendorName,
                invoiceNumber: registrant.invoiceNumber || current.invoiceNumber,
                invoiceRegisteredName: registrant.registeredName,
                invoiceRegisteredNameVerified: true,
                invoiceCorporateNumber: registrant.corporateNumber,
                invoiceAddress: registrant.address || '',
                invoiceRegistrationStatus: registrant.registrationStatus,
                invoiceRegistrationDate: registrant.registrationDate || '',
                invoiceTradeName: registrant.tradeName || '',
                invoiceLookupMethod: registrant.lookupMethod,
                invoiceRegistrant: registrant,
                invoiceCheckStatus: '確認済',
                invoiceStatus: 'verified',
                invoiceCheckedAt: registrant.lookedUpAt || new Date().toISOString(),
                updatedBy: staffId,
                updatedByName: staffName,
              }
            : current,
        )
        const successText = lookup.usedFallback
          ? `仕入先へ「${registrant.registeredName}」を反映しました（取得方法: fallback）。${lookup.fallbackReason ?? ''}`
          : `仕入先へ「${registrant.registeredName}」を反映しました（インボイスあり・確認済）。`
        setInvoiceQuoteMessage({ tone: 'success', text: successText })
        setStatusMessage(successText)
        return
      }

      setExpenseForm((current) =>
        current
          ? {
              ...current,
              invoiceRegisteredNameVerified: false,
              invoiceCheckStatus: lookup.invoiceCheckStatus,
              invoiceStatus: lookup.status === 'not_found' ? 'none' : current.invoiceStatus,
              updatedBy: staffId,
              updatedByName: staffName,
            }
          : current,
      )
      const failureText =
        lookup.message || '登録事業者名取得失敗：原因不明。手入力で仕入先を入力してください。'
      setInvoiceQuoteMessage({ tone: 'error', text: failureText })
      setErrorMessage(failureText)
    } catch (error) {
      const failureText =
        error instanceof Error
          ? `登録事業者名取得失敗：${error.message}`
          : 'インボイス引用に失敗しました。'
      setInvoiceQuoteMessage({ tone: 'error', text: failureText })
      setErrorMessage(failureText)
    } finally {
      setIsLookingUpInvoice(false)
    }
  }

  const adjustReceiptImageZoom = (delta: number) => {
    setReceiptImageZoom((current) => Math.min(3, Math.max(0.5, Number((current + delta).toFixed(2)))))
  }

  const openReceiptFilePicker = () => {
    if (isUploadingReceipt || isRunningOcr || receiptUploadInFlightRef.current || isRotatingReceipt) {
      return
    }
    receiptFileInputRef.current?.click()
  }

  /**
   * PDF原本を新規タブで開く。href に永続 URL を持たせず、クリック時に
   * receiptId 経由の短期署名 URL を取得してから window.open する。
   * 旧データで永続 URL しかない場合のみ互換的にそちらを使う。
   */
  const handleOpenReceiptOriginal = async () => {
    if (isOpeningReceiptOriginal) {
      return
    }
    const receiptId = expenseForm?.receiptId?.trim() || ''
    setIsOpeningReceiptOriginal(true)
    try {
      if (receiptId && expenseReceiptOriginalStoragePath) {
        const result = await fetchAccountingReceiptAccessUrl({ receiptId, variant: 'original' })
        if (result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer')
          return
        }
      }
      if (expenseReceiptOriginalUrl) {
        window.open(expenseReceiptOriginalUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      if (expenseReceiptOriginalUrl) {
        window.open(expenseReceiptOriginalUrl, '_blank', 'noopener,noreferrer')
      }
    } finally {
      setIsOpeningReceiptOriginal(false)
    }
  }

  const handleRotateReceiptImage = async (action: 'left' | 'right' | 'reset') => {
    if (!expenseForm || !hasAccountingFormReceiptImage(expenseForm)) {
      setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
      return
    }

    if (
      receiptRotateInFlightRef.current ||
      isRotatingReceipt ||
      isUploadingReceipt ||
      isRunningOcr ||
      receiptUploadInFlightRef.current
    ) {
      return
    }

    const receiptId = expenseForm.receiptId?.trim() ?? ''
    const previousDegrees = receiptRotationDegrees

    if (action === 'reset' && previousDegrees === 0 && !needsOcrRerunAfterRotation) {
      return
    }

    receiptRotateInFlightRef.current = true
    setIsRotatingReceipt(true)
    setErrorMessage('')

    try {
      let baseFile = receiptRotationBaseFile
      let rebuiltBaseFromRemote = false
      if (!baseFile || (receiptId && receiptRotationBaseReceiptId && receiptRotationBaseReceiptId !== receiptId)) {
        rebuiltBaseFromRemote = true
        const linkedReceipt = allReceipts.find((row) => row.id === receiptId) ?? unorganizedReceipts.find((row) => row.id === receiptId)
        const loaded = await loadAccountingReceiptOcrImageBlob({
          imageBlob:
            receiptId && previousDegrees === 0 ? recentReceiptBlobs[receiptId] : undefined,
          ocrImageDownloadUrl:
            expenseForm.receiptPreviewImageUrl ||
            linkedReceipt?.ocrImageDownloadUrl ||
            expenseForm.receiptImageUrl,
          ocrImageStoragePath:
            expenseForm.receiptPreviewStoragePath ||
            linkedReceipt?.ocrImageStoragePath ||
            expenseForm.receiptStoragePath,
          legacyDownloadUrl: expenseForm.receiptImageUrl || linkedReceipt?.downloadUrl,
          legacyStoragePath: expenseForm.receiptStoragePath || linkedReceipt?.storagePath,
          mimeType: expenseForm.receiptFileMimeType || linkedReceipt?.mimeType,
        })
        baseFile =
          loaded instanceof File
            ? loaded
            : new File([loaded], expenseForm.receiptFileName || 'receipt.jpg', {
                type: loaded.type || 'image/jpeg',
                lastModified: Date.now(),
              })
        setReceiptRotationBaseFile(baseFile)
        setReceiptRotationBaseReceiptId(receiptId)
        setReceiptRotationDegrees(0)
      }

      if (!baseFile || baseFile.size <= 0) {
        throw new Error(RECEIPT_ROTATION_ERROR_MESSAGE)
      }

      const effectivePreviousDegrees = rebuiltBaseFromRemote ? 0 : previousDegrees
      const effectiveNextDegrees =
        action === 'reset'
          ? 0
          : resolveNextReceiptRotationDegrees(effectivePreviousDegrees, action)

      const rotatedFile =
        effectiveNextDegrees === 0
          ? baseFile
          : await rotateAccountingReceiptImage(baseFile, effectiveNextDegrees)

      setReceiptPreviewFromFile(rotatedFile)
      setReceiptRotationDegrees(effectiveNextDegrees)

      if (receiptId) {
        setRecentReceiptBlobs((current) => ({
          ...current,
          [receiptId]: rotatedFile,
        }))

        const storagePath =
          expenseForm.receiptPreviewStoragePath ||
          expenseForm.receiptStoragePath ||
          linkedReceiptForForm?.ocrImageStoragePath ||
          linkedReceiptForForm?.storagePath ||
          ''

        if (storagePath) {
          const replaced = await replaceAccountingReceiptOcrImage({
            receiptId,
            ocrImageFile: rotatedFile,
            ocrImageStoragePath: storagePath,
            documentType: expenseReceiptIsPdf ? 'pdf' : 'image',
            originalStoragePath: expenseForm.receiptFileStoragePath || linkedReceiptForForm?.originalStoragePath,
          })

          setExpenseForm((current) =>
            current
              ? {
                  ...current,
                  receiptPreviewImageUrl: replaced.ocrImageDownloadUrl || current.receiptPreviewImageUrl,
                  receiptImageUrl: replaced.ocrImageDownloadUrl || current.receiptImageUrl,
                  receiptPreviewStoragePath: replaced.ocrImageStoragePath,
                  receiptStoragePath: replaced.ocrImageStoragePath,
                  imageHash: replaced.imageHash ?? current.imageHash,
                  ...(expenseReceiptIsPdf
                    ? {}
                    : {
                        receiptFileUrl: replaced.ocrImageDownloadUrl || current.receiptFileUrl,
                        receiptFileStoragePath: replaced.ocrImageStoragePath,
                      }),
                }
              : current,
          )
        }
      }

      const hasOcr = hasAccountingReceiptOcrResult(expenseForm)
      const needsRerun = shouldFlagOcrRerunAfterRotation({
        hasOcrResult: hasOcr,
        previousDegrees: effectivePreviousDegrees,
        nextDegrees: effectiveNextDegrees,
      })
      setNeedsOcrRerunAfterRotation(needsRerun)
      setStatusMessage(
        needsRerun
          ? RECEIPT_ROTATION_OCR_RERUN_MESSAGE
          : effectiveNextDegrees === 0
            ? '画像の向きを元に戻しました。'
            : `画像を${effectiveNextDegrees}度回転しました。`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : RECEIPT_ROTATION_ERROR_MESSAGE,
      )
    } finally {
      setIsRotatingReceipt(false)
      receiptRotateInFlightRef.current = false
    }
  }

  const handleReceiptUpload = async (file: File | null, input?: HTMLInputElement | null) => {
    if (!file || !expenseForm) {
      return
    }

    const previousReceiptId = expenseForm.receiptId?.trim() ?? ''
    const protectedReceiptIds = [editingExpenseBaseline?.form.receiptId]

    setIsUploadingReceipt(true)
    setStatusMessage('')
    setErrorMessage('')
    setReceiptSelectionError(false)
    setOcrProgressMessage('')
    setReceiptSelectedFileMeta({
      name: file.name,
      summary: formatAccountingReceiptSelectionSummary(file),
    })

    try {
      const validation = validateAccountingReceiptUploadFile(file)
      if (!validation.ok) {
        throw new Error(validation.message)
      }

      let originalFile = file
      let ocrImageFile: File
      let pdfPageCount: number | undefined

      if (validation.documentType === 'pdf') {
        const preview = await createAccountingPdfPreview(file)
        ocrImageFile = preview.previewFile
        pdfPageCount = preview.pageCount
      } else {
        ocrImageFile = await normalizeAccountingReceiptImage(file)
        originalFile = ocrImageFile
      }

      setReceiptPreviewFromFile(ocrImageFile)

      const uploaded = await uploadAccountingReceiptFile({
        originalFile,
        ocrImageFile,
        documentType: validation.documentType,
        pdfPageCount,
        franchiseeId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        uploadedBy: staffId,
        uploadedByName: staffName,
      })

      const replacedId = resolveReplacedUnorganizedReceiptIdToDiscard({
        previousReceiptId,
        nextReceiptId: uploaded.receiptId,
        protectedReceiptIds,
      })
      if (replacedId) {
        try {
          await discardUnorganizedAccountingReceipt(replacedId)
        } catch {
          // 保護対象・権限エラー時は既存証憑を壊さない
        }
        pendingUnorganizedReceiptIdsRef.current = pendingUnorganizedReceiptIdsRef.current.filter(
          (id) => id !== replacedId,
        )
      }
      rememberPendingUnorganizedReceipt(uploaded.receiptId)

      setExpenseForm((current) =>
        current
          ? {
              ...current,
              receiptId: uploaded.receiptId,
              receiptImageUrl: uploaded.ocrImageDownloadUrl,
              receiptStoragePath: uploaded.ocrImageStoragePath,
              receiptPreviewImageUrl: uploaded.ocrImageDownloadUrl,
              receiptPreviewStoragePath: uploaded.ocrImageStoragePath,
              receiptFileUrl: uploaded.originalDownloadUrl,
              receiptFileStoragePath: uploaded.originalStoragePath,
              receiptFileName: originalFile.name,
              receiptFileMimeType: originalFile.type || (validation.documentType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
              imageHash: uploaded.imageHash,
            }
          : current,
      )
      setReceiptLocalSelectionActive(true)
      setReceiptRotationBaseFile(ocrImageFile)
      setReceiptRotationBaseReceiptId(uploaded.receiptId)
      setReceiptRotationDegrees(0)
      setNeedsOcrRerunAfterRotation(false)
      setRecentReceiptBlobs((current) => ({
        ...current,
        [uploaded.receiptId]: ocrImageFile,
      }))
      await reloadUnorganizedReceipts()
      setStatusMessage(
        validation.documentType === 'pdf'
          ? 'PDF原本とOCR用画像をアップロードしました。OCRは1ページ目を対象にします。'
          : '証憑画像をアップロードしました。OCR読取で候補を反映できます。',
      )
    } catch (error) {
      // 既存証憑（フォーム上の URL / Storage 参照）は消さない。ローカルプレビューのみ破棄し再表示に任せる。
      clearReceiptPreviewObjectUrl()
      clearReceiptRotationState()
      setReceiptSelectionError(true)
      const failureMessage =
        error instanceof Error ? error.message : '証憑ファイルのアップロードに失敗しました。'
      setErrorMessage(
        hasExistingAccountingReceiptAttachment(expenseForm)
          ? ACCOUNTING_RECEIPT_READ_FAILED_MESSAGE
          : failureMessage,
      )
    } finally {
      setIsUploadingReceipt(false)
      if (input) {
        input.value = ''
      }
    }
  }

  /**
   * ファイル選択（input）とドラッグ＆ドロップの共通エントリ。
   * 保存形式・OCR・Storage アップロードは既存 handleReceiptUpload に委譲する。
   */
  const handleSelectedReceiptFiles = async (
    files: ArrayLike<File> | null | undefined,
    input?: HTMLInputElement | null,
  ) => {
    if (!expenseForm) {
      return
    }

    if (receiptUploadInFlightRef.current || isUploadingReceipt || isRunningOcr) {
      return
    }

    const selection = resolveSelectedAccountingReceiptFiles(files)
    if (!selection.ok) {
      if (selection.message) {
        setReceiptSelectionError(true)
        setErrorMessage(selection.message)
      }
      if (input) {
        input.value = ''
      }
      return
    }

    if (
      shouldPromptReceiptReplacement(hasExistingAccountingReceiptAttachment(expenseForm)) &&
      !window.confirm(ACCOUNTING_RECEIPT_REPLACE_CONFIRM_MESSAGE)
    ) {
      if (input) {
        input.value = ''
      }
      return
    }

    receiptUploadInFlightRef.current = true
    setReceiptSelectionError(false)
    try {
      await handleReceiptUpload(selection.file, input)
    } finally {
      receiptUploadInFlightRef.current = false
    }
  }

  const applyOcrResultToExpenseForm = (result: Awaited<ReturnType<typeof runAccountingReceiptOcr>>) => {
    setExpenseForm((current) =>
      current ? applyAccountingReceiptOcrToExpense(current, result) : current,
    )
    setIsConsumptionTaxManual(
      result.parsed.consumptionTaxAmount !== undefined ||
        result.ocrCandidates?.taxAmount !== undefined ||
        result.parsed.taxRate !== undefined,
    )
    if (result.parsed.invoiceNumber) {
      const validation = validateInvoiceNumberCandidate(result.parsed.invoiceNumber)
      setInvoiceNumberWarning(validation.warning)
    }
    const autoAppliedCategory =
      shouldAutoApplyOcrCandidates(result.ocrConfidence) && Boolean(result.suggestedExpenseCategory)
    const registrantFound = result.invoiceLookupStatus === 'success' && Boolean(result.parsed.invoiceRegisteredName)
    setOcrCandidateNotice(
      registrantFound
        ? `OCR候補を反映し、登録事業者名「${result.parsed.invoiceRegisteredName}」をインボイス番号検索で取得しました。`
        : autoAppliedCategory
          ? `OCR候補をフォームに反映しました（信頼度${(OCR_AUTO_APPLY_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%以上のため経費科目候補も自動入力）。内容を確認してから保存してください。`
          : 'OCR候補をフォームに反映しました。日付・金額・内容・経費科目候補を確認してから保存してください。',
    )
  }

  const resolveOcrResultMessage = (result: Awaited<ReturnType<typeof runAccountingReceiptOcr>>) => {
    if (result.status === 'error') {
      return result.message ?? 'OCR処理に失敗しました。手入力で登録できます。'
    }

    if (!result.ocrRawText) {
      return '文字を読み取れませんでした。手入力で登録できます。'
    }

    if (
      !result.parsed.receiptDate &&
      !result.parsed.vendorName &&
      !result.parsed.taxIncludedAmount &&
      !result.parsed.invoiceNumber
    ) {
      return 'テキストは読み取れましたが、日付・金額等を自動判定できませんでした。手入力してください。'
    }

    return result.message ?? 'OCR読取が完了しました。'
  }

  const handleRunReceiptOcr = async () => {
    if (!expenseForm || !hasAccountingFormReceiptImage(expenseForm)) {
      setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
      return
    }

    setIsRunningOcr(true)
    setErrorMessage('')
    setStatusMessage('')
    setOcrCandidateNotice('')
    setInvoiceLookupHistoryWarning('')
    setOcrProgressMessage('OCR読取を開始しました。')

    try {
      const previewUrl =
        expenseForm.receiptPreviewImageUrl || expenseForm.receiptImageUrl
      const previewPath =
        expenseForm.receiptPreviewStoragePath || expenseForm.receiptStoragePath
      const downloadUrl = await resolveAccountingReceiptDownloadUrl({
        downloadUrl: previewUrl,
        storagePath: previewPath,
        receiptId: expenseForm.receiptId,
        variant: 'preview',
      })

      if (
        !downloadUrl &&
        !previewPath?.trim() &&
        !recentReceiptBlobs[expenseForm.receiptId ?? '']
      ) {
        setErrorMessage(OCR_IMAGE_UNAVAILABLE_MESSAGE)
        return
      }

      // expenseForm には保存しない。プレビュー表示用のメモリ内 state のみ更新する。
      if (downloadUrl && expenseForm.receiptId?.trim()) {
        setReceiptAccessPreviewUrl({ receiptId: expenseForm.receiptId.trim(), url: downloadUrl })
      }

      const receiptId = expenseForm.receiptId ?? ''
      const linkedReceipt = allReceipts.find((row) => row.id === receiptId)
      const isPreparedOcrImage =
        receiptRotationDegrees !== 0 ||
        isAccountingReceiptPdfMime(expenseForm.receiptFileMimeType) ||
        isAccountingReceiptPdfMime(linkedReceipt?.originalMimeType) ||
        isAccountingReceiptPdfMime(linkedReceipt?.mimeType) ||
        linkedReceipt?.documentType === 'pdf'
      const result = await runAccountingReceiptOcr({
        ocrImageDownloadUrl:
          expenseForm.receiptPreviewImageUrl ||
          linkedReceipt?.ocrImageDownloadUrl ||
          downloadUrl ||
          expenseForm.receiptImageUrl,
        ocrImageStoragePath:
          expenseForm.receiptPreviewStoragePath ||
          linkedReceipt?.ocrImageStoragePath ||
          expenseForm.receiptStoragePath,
        downloadUrl: downloadUrl || expenseForm.receiptImageUrl,
        storagePath: expenseForm.receiptStoragePath,
        mimeType: expenseForm.receiptFileMimeType || linkedReceipt?.mimeType,
        receiptId,
        imageBlob: receiptId ? recentReceiptBlobs[receiptId] : undefined,
        isPreparedOcrImage,
        invoiceLookupAuditContext: buildInvoiceLookupAuditContext('ocr', {
          expenseId: editingExpenseId || undefined,
          receiptId: receiptId || undefined,
        }),
        onProgress: (progress) => {
          setOcrProgressMessage(progress.message)
          setStatusMessage(progress.message)
        },
      })

      if (result.status === 'not_configured') {
        setStatusMessage(OCR_NOT_CONFIGURED_MESSAGE)
        return
      }

      if (result.status === 'error') {
        setErrorMessage(result.message ?? 'OCR の実行に失敗しました。')
        setOcrProgressMessage(result.message ?? 'OCR処理に失敗しました。手入力で登録できます。')
        return
      }

      applyOcrResultToExpenseForm(result)

      if (result.invoiceLookupHistoryWarning) {
        setInvoiceLookupHistoryWarning(result.invoiceLookupHistoryWarning)
      }

      if (receiptId) {
        await applyOcrCandidatesToAccountingReceipt({ receiptId, ocr: result })
        await reloadUnorganizedReceipts()
      }

      setNeedsOcrRerunAfterRotation(false)
      const resultMessage = resolveOcrResultMessage(result)
      setOcrProgressMessage(resultMessage)
      setStatusMessage(resultMessage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR の実行に失敗しました。'
      setErrorMessage(message)
      setOcrProgressMessage('OCR処理に失敗しました。手入力で登録できます。')
    } finally {
      setIsRunningOcr(false)
    }
  }

  const handleSaveReceiptOnly = async () => {
    if (!expenseForm?.receiptId || !hasAccountingFormReceiptImage(expenseForm)) {
      setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
      return
    }

    setIsSavingReceiptOnly(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      await saveReceiptOnly({
        receiptId: expenseForm.receiptId,
        memo: expenseForm.memo,
        candidateFields: buildReceiptCandidateFieldsFromExpense(expenseForm),
        updatedBy: staffId,
        updatedByName: staffName,
      })
      await resetExpenseFormToNew({ retainPendingUploads: true })
      setStatusMessage('領収書を未整理として保存しました。あとで「編集する」から入力フォームへ読み込めます。')
      await reloadUnorganizedReceipts()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '領収書の保存に失敗しました。')
    } finally {
      setIsSavingReceiptOnly(false)
    }
  }

  const handleRegisterReceiptAsExpense = (receipt: StoredAccountingReceipt) => {
    const form = buildExpenseFormFromReceipt({
      receipt,
      franchiseeId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      staffId,
      staffName,
    })
    setEditingExpenseId('')
    setIsConsumptionTaxManual(
      form.taxCalculationMode === 'manual' || form.taxCalculationMode === 'ocr',
    )
    setOcrCandidateNotice(
      form.invoiceStatus === 'none'
        ? '未整理領収書を読み込みました。インボイス番号がないため、仕入税額控除の対象は要確認です。'
        : '未整理領収書から経費入力フォームへ引き継ぎました。税区分・インボイス・経費科目を確認してから保存してください。',
    )
    clearReceiptPreviewObjectUrl()
    clearReceiptRotationState()
    setReceiptLocalSelectionActive(false)
    setReceiptSelectionError(false)
    setReceiptSelectedFileMeta(
      form.receiptFileName
        ? {
            name: form.receiptFileName,
            summary: form.receiptFileMimeType
              ? `${form.receiptFileMimeType.includes('pdf') ? 'PDF' : '画像'}`
              : '',
          }
        : null,
    )
    setInvoiceNumberWarning(
      form.invoiceNumber ? validateInvoiceNumberCandidate(form.invoiceNumber).warning : '',
    )
    setExpenseForm(form)
    setActiveTab('expenses')
    setStatusMessage('未整理領収書を経費入力フォームへ読み込みました（スマホ保存分もPCから編集できます）。')
  }

  const handleConfirmUnorganizedReceipt = async (receipt: StoredAccountingReceipt) => {
    const form = buildExpenseFormFromReceipt({
      receipt,
      franchiseeId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      staffId,
      staffName,
    })

    if (!form.expenseCategory) {
      handleRegisterReceiptAsExpense(receipt)
      setErrorMessage('確定するには経費科目を選択してください。フォームで入力後に保存してください。')
      return
    }

    const confirmReceipt = async () => {
      setErrorMessage('')
      setStatusMessage('')
      try {
        await saveConfirmedAccountingReceipt({
          receiptId: receipt.id,
          editedBy: staffId,
          previousHistory: receipt.editHistory,
          confirmed: {
            vendorName: form.vendorName,
            date: form.receiptDate || getExpenseReceiptDate(form),
            amount: form.taxIncludedAmount,
            taxAmount: form.consumptionTaxAmount,
            taxCategory: form.taxCategory ?? 'taxable',
            invoiceStatus: form.invoiceStatus ?? 'unknown',
            invoiceNumber: form.invoiceNumber,
            invoiceRegisteredName: form.invoiceRegisteredName,
            accountTitle: form.expenseCategory,
            description: form.description,
            memo: form.memo,
            phoneNumber: form.ocrCandidates?.phoneNumber,
            address: form.invoiceAddress,
          },
        })
        const expensePayload: AccountingExpenseInput = {
          ...form,
          confirmationStatus: '確認済み',
          updatedBy: staffId,
          updatedByName: staffName,
        }
        await createAccountingExpense(expensePayload)
        setStatusMessage('領収書を確定し、経費・集計対象として登録しました。')
        await reloadExpensesAdjustmentsAndReceipts()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '領収書の確定に失敗しました。')
      }
    }

    promptDuplicateCheckBeforeConfirm(buildDuplicateCandidateFromForm(form), confirmReceipt)
  }

  const handleRejectUnorganizedReceipt = async (receipt: StoredAccountingReceipt) => {
    setErrorMessage('')
    try {
      await rejectAccountingReceiptWorkflow({
        receiptId: receipt.id,
        editedBy: staffId,
        previousHistory: receipt.editHistory,
      })
      setStatusMessage('領収書を「登録しない」に更新しました。')
      await reloadUnorganizedReceipts()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '領収書の却下に失敗しました。')
    }
  }

  const handleRunOcrOnUnorganizedReceipt = async (receipt: StoredAccountingReceipt) => {
    if (!hasStoredAccountingReceiptOcrImage(receipt)) {
      setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
      return
    }

    setOcrRunningReceiptId(receipt.id)
    setErrorMessage('')
    setStatusMessage('')
    setInvoiceLookupHistoryWarning('')
    setOcrStatusByReceiptId((current) => ({
      ...current,
      [receipt.id]: 'OCR読取を開始しました。',
    }))

    try {
      const previewUrl = getAccountingReceiptPreviewImageUrl(receipt)
      const downloadUrl = await resolveAccountingReceiptDownloadUrl({
        downloadUrl: previewUrl || receipt.ocrImageDownloadUrl,
        storagePath: receipt.ocrImageStoragePath || receipt.storagePath,
        receiptId: receipt.id,
        variant: 'preview',
      })

      if (
        !downloadUrl &&
        !receipt.ocrImageStoragePath?.trim() &&
        !receipt.storagePath?.trim() &&
        !recentReceiptBlobs[receipt.id]
      ) {
        const message = OCR_IMAGE_UNAVAILABLE_MESSAGE
        setErrorMessage(message)
        setOcrStatusByReceiptId((current) => ({ ...current, [receipt.id]: message }))
        return
      }

      const isPreparedOcrImage =
        receipt.documentType === 'pdf' ||
        isAccountingReceiptPdfMime(receipt.originalMimeType) ||
        isAccountingReceiptPdfMime(receipt.mimeType)
      const result = await runAccountingReceiptOcr({
        ocrImageDownloadUrl: receipt.ocrImageDownloadUrl || downloadUrl || previewUrl,
        ocrImageStoragePath: receipt.ocrImageStoragePath,
        downloadUrl: downloadUrl || previewUrl || receipt.downloadUrl,
        storagePath: receipt.ocrImageStoragePath || receipt.storagePath,
        receiptId: receipt.id,
        fileName: receipt.fileName,
        mimeType: receipt.mimeType,
        imageBlob: recentReceiptBlobs[receipt.id],
        isPreparedOcrImage,
        invoiceLookupAuditContext: buildInvoiceLookupAuditContext('ocr', {
          receiptId: receipt.id,
        }),
        onProgress: (progress) => {
          setOcrStatusByReceiptId((current) => ({
            ...current,
            [receipt.id]: progress.message,
          }))
          setStatusMessage(progress.message)
        },
      })

      if (result.status === 'not_configured') {
        setStatusMessage(OCR_NOT_CONFIGURED_MESSAGE)
        setOcrStatusByReceiptId((current) => ({
          ...current,
          [receipt.id]: OCR_NOT_CONFIGURED_MESSAGE,
        }))
        return
      }

      if (result.status === 'error') {
        const message = result.message ?? 'OCR の実行に失敗しました。'
        setErrorMessage(message)
        setOcrStatusByReceiptId((current) => ({
          ...current,
          [receipt.id]: `${message} 手入力で登録できます。`,
        }))
        return
      }

      if (result.invoiceLookupHistoryWarning) {
        setInvoiceLookupHistoryWarning(result.invoiceLookupHistoryWarning)
      }

      await applyOcrCandidatesToAccountingReceipt({ receiptId: receipt.id, ocr: result })
      await reloadUnorganizedReceipts()

      if (expenseForm?.receiptId === receipt.id) {
        applyOcrResultToExpenseForm(result)
      }

      const resultMessage = resolveOcrResultMessage(result)
      setOcrStatusByReceiptId((current) => ({
        ...current,
        [receipt.id]: resultMessage,
      }))
      setStatusMessage(resultMessage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR の実行に失敗しました。'
      setErrorMessage(message)
      setOcrStatusByReceiptId((current) => ({
        ...current,
        [receipt.id]: 'OCR処理に失敗しました。手入力で登録できます。',
      }))
    } finally {
      setOcrRunningReceiptId('')
    }
  }

  const handleDeleteUnorganizedReceipt = (
    receipt: StoredAccountingReceipt,
  ) => {
    if (isDeletingReceiptRef.current || isDeletingReceipt || isSavingExpense) {
      return
    }

    const linkedExpense = receipt.linkedExpenseId
      ? expenses.find((expense) => expense.id === receipt.linkedExpenseId) ?? null
      : null
    const decision = resolveAccountingImageDeleteAction(receipt, { linkedExpense })
    setImageDeletePrompt({
      receipt,
      mode: decision.action,
    })
  }

  const handleConfirmImageDeletePrompt = async () => {
    if (!imageDeletePrompt || isDeletingReceiptRef.current || isDeletingReceipt) {
      return
    }

    const { receipt, mode } = imageDeletePrompt
    isDeletingReceiptRef.current = true
    setIsDeletingReceipt(true)
    setErrorMessage('')

    try {
      if (mode === 'soft_hide') {
        await softHideAccountingReceipt({
          receiptId: receipt.id,
          deletedBy: staffId,
          deleteReason: IMAGE_SOFT_HIDE_DELETE_REASON,
          accessScope,
        })
        setStatusMessage(IMAGE_SOFT_HIDE_MESSAGE)
      } else {
        const linkedExpense = receipt.linkedExpenseId
          ? expenses.find((expense) => expense.id === receipt.linkedExpenseId) ?? null
          : null
        const result = await deleteAccountingReceipt(receipt.id, {
          accessScope,
          linkedExpense,
        })
        if (expenseForm?.receiptId === receipt.id) {
          await resetExpenseFormToNew({ retainPendingUploads: true })
        }
        setStatusMessage(
          result.storageImageWasMissing
            ? '画像ファイルは既に存在しません。未整理データのみ削除しました。'
            : '未整理領収書とアップロード画像を削除しました。',
        )
      }

      setImageDeletePrompt(null)
      await reloadExpensesAdjustmentsAndReceipts()
      setFocusReceiptId('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '証憑の削除に失敗しました。')
    } finally {
      isDeletingReceiptRef.current = false
      setIsDeletingReceipt(false)
    }
  }

  const handleUnlinkOrphanReceipt = async (receipt: StoredAccountingReceipt) => {
    const confirmed = window.confirm(
      '経費へのリンクを解除し、通常の未整理へ戻します。よろしいですか？',
    )
    if (!confirmed) {
      return
    }
    try {
      setErrorMessage('')
      await unlinkAccountingReceiptFromExpense({ receiptId: receipt.id })
      setStatusMessage('リンクを解除し、未整理へ戻しました。')
      await reloadExpensesAdjustmentsAndReceipts()
      setFocusReceiptId(receipt.id)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'リンク解除に失敗しました。')
    }
  }

  const handleRelinkOrphanReceipt = async (receipt: StoredAccountingReceipt, expenseId: string) => {
    try {
      setErrorMessage('')
      await relinkAccountingReceiptToExpense({
        receiptId: receipt.id,
        expenseId,
        previousLinkedExpenseId: receipt.linkedExpenseId,
      })
      setStatusMessage('既存経費へ再紐付けしました。')
      await reloadExpensesAdjustmentsAndReceipts()
      setFocusReceiptId('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '再紐付けに失敗しました。')
    }
  }

  const handleInvalidateOrphanReceipt = async (receipt: StoredAccountingReceipt) => {
    const confirmed = window.confirm(
      'この証憑を無効化します。経費リンクも解除され、提出対象から除外されます。よろしいですか？',
    )
    if (!confirmed) {
      return
    }
    try {
      setErrorMessage('')
      await invalidateAccountingReceipt({ receiptId: receipt.id })
      setStatusMessage('証憑を無効化しました。')
      await reloadExpensesAdjustmentsAndReceipts()
      setFocusReceiptId('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '証憑の無効化に失敗しました。')
    }
  }

  const reloadExpensesAndAdjustments = async () => {
    const [expenseRows, adjustmentRows] = await Promise.all([
      fetchAccountingExpenses(accessScope),
      fetchAccountingAdjustments(accessScope),
    ])
    setExpenses(expenseRows)
    setAdjustments(adjustmentRows)
  }

  const reloadFixedCosts = async () => {
    const rows = await fetchAccountingFixedCosts(accessScope)
    setFixedCosts(rows)
  }

  const reloadFixedAssets = async () => {
    const rows = await fetchAccountingFixedAssets(accessScope)
    setFixedAssets(rows)
  }

  const reloadSettlementAuxiliary = async () => {
    try {
      const authValidationError = await validateAccountingFirebaseAuth({ authSession })
      if (authValidationError) {
        setSettlementAuxiliary(null)
        setSettlementAuxiliaryLoadError(authValidationError)
        return
      }
      const row = await fetchAccountingSettlementAuxiliary(accessScope, targetYear)
      setSettlementAuxiliary(row)
      setSettlementAuxiliaryLoadError('')
    } catch (error) {
      setSettlementAuxiliary(null)
      const message = formatAccountingQueryErrorMessage('accountingSettlementAuxiliary', error)
      setSettlementAuxiliaryLoadError(`${message} / ${ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT}`)
      // 経費一覧の errorMessage は上書きしない
    }
  }

  const validateAssetDraftBeforeSave = () => {
    if (assetDraft.registrationType === 'normal') {
      const judgment = detectNormalExpenseOverrideJudgment({
        amountYen: assetDraft.acquisitionCost || expenseForm?.taxIncludedAmount || 0,
        description: expenseForm?.description ?? '',
        vendorName: expenseForm?.vendorName ?? '',
        suggestedCategory: expenseForm?.suggestedExpenseCategory ?? '',
      })

      const overrideValidation = validateNormalExpenseOverrideForSave({
        registrationType: assetDraft.registrationType,
        confirmed: assetDraft.normalExpenseOverrideConfirmed,
        reason: assetDraft.normalExpenseOverrideReason,
        confirmedJudgmentKey: assetDraft.normalExpenseOverrideJudgmentKey,
        judgment,
        isEditing: Boolean(editingExpenseId),
      })

      if (!overrideValidation.ok) {
        setErrorMessage(overrideValidation.message)
        setExpenseFormActionError(overrideValidation.message)
        window.setTimeout(() => {
          focusNormalExpenseOverrideField(overrideValidation.focusTarget)
        }, 0)
        return false
      }

      return true
    }

    if (!assetDraft.purchaseDate) {
      setErrorMessage('購入日を入力してください。')
      setExpenseFormActionError('購入日を入力してください。')
      return false
    }

    if (!assetDraft.useStartDate) {
      setErrorMessage('使用開始日を入力してください。')
      setExpenseFormActionError('使用開始日を入力してください。')
      return false
    }

    if ((assetDraft.acquisitionCost || expenseForm?.taxIncludedAmount || 0) <= 0) {
      setErrorMessage('取得価額を入力してください。')
      setExpenseFormActionError('取得価額を入力してください。')
      return false
    }

    if (
      assetDraft.registrationType === 'fixed' &&
      assetDraft.appliedUsefulLifeYears !== assetDraft.standardUsefulLifeYears &&
      !assetDraft.usefulLifeChangeReason.trim()
    ) {
      setErrorMessage('耐用年数を変更した場合は変更理由を入力してください。')
      setExpenseFormActionError('耐用年数を変更した場合は変更理由を入力してください。')
      return false
    }

    if (
      assetDraft.registrationType === 'fixed' &&
      assetDraft.assetCategory === '車両' &&
      assetDraft.condition === '中古' &&
      !assetDraft.firstRegistrationYearMonth
    ) {
      setErrorMessage('中古車の初度登録年月を入力してください。')
      setExpenseFormActionError('中古車の初度登録年月を入力してください。')
      return false
    }

    if (assetDraft.registrationType === 'fixed' && assetDraft.assetCategory === '車両') {
      const chassis = normalizeChassisNumber(assetDraft.chassisNumber)
      if (chassis && !isValidChassisNumberFormat(chassis)) {
        const message = '車台番号は英数字とハイフンのみ入力できます。'
        setErrorMessage(message)
        setExpenseFormActionError(message)
        return false
      }
      const yearCheck = validateModelYearValue(parseModelYearInput(assetDraft.modelYear), {
        firstRegistrationYearMonth: assetDraft.firstRegistrationYearMonth,
      })
      if (yearCheck.error) {
        setErrorMessage(yearCheck.error)
        setExpenseFormActionError(yearCheck.error)
        return false
      }
    }

    return true
  }

  const handleSaveExpense = async () => {
    if (!expenseForm) {
      return
    }

    if (authBlockedMessage || expensesLoadFailed) {
      const message = authBlockedMessage || ACCOUNTING_AUTH_REQUIRED_MESSAGE
      setErrorMessage(message)
      setExpenseFormActionError(
        'データ確認前のため保存できません。再ログインして経費一覧の読み込み成功後に保存してください。',
      )
      return
    }

    if (isSavingExpenseRef.current || isSavingExpense) {
      return
    }

    if (expenseForm.confirmationStatus === '確認済み' && !expenseForm.expenseCategory) {
      const message = '経費科目を選択しないと確認済みにできません。'
      setErrorMessage(message)
      setExpenseFormActionError(message)
      return
    }

    if (!validateAssetDraftBeforeSave()) {
      return
    }

    const duplicateMatches = findExpenseDuplicatesIncludingBilling(
      expenses,
      buildDuplicateCandidateFromForm(expenseForm, editingExpenseId || undefined),
    )
    if (hasBlockingExpenseDuplicate(duplicateMatches)) {
      setDuplicatePrompt({
        matches: duplicateMatches.filter((match) => match.severity === 'blocking'),
        severity: 'blocking',
        onContinue: () => setDuplicatePrompt(null),
      })
      return
    }

    if (editingExpenseId) {
      const fromType = baselineRegistrationTypeRef.current
      const toType = assetDraft.registrationType
      if (fromType !== toType) {
        const confirmed = window.confirm(
          buildAssetCategoryChangeConfirmMessage({ fromType, toType }),
        )
        if (!confirmed) {
          return
        }
      }
    }

    const persistExpense = async () => {
      if (isSavingExpenseRef.current) {
        return
      }
      isSavingExpenseRef.current = true
      setIsSavingExpense(true)
      setErrorMessage('')
      setExpenseFormActionError('')
      setStatusMessage('')

      try {
        const judgment = detectNormalExpenseOverrideJudgment({
          amountYen: assetDraft.acquisitionCost || expenseForm.taxIncludedAmount || 0,
          description: expenseForm.description,
          vendorName: expenseForm.vendorName,
          suggestedCategory: expenseForm.suggestedExpenseCategory,
        })
        const overridePersistFields = buildNormalExpenseOverridePersistFields({
          registrationType: assetDraft.registrationType,
          confirmed: assetDraft.normalExpenseOverrideConfirmed,
          reason: assetDraft.normalExpenseOverrideReason,
          judgment,
        })

        const expensePayload: AccountingExpenseInput = {
          ...expenseForm,
          plTreatment:
            assetDraft.registrationType === 'fixed'
              ? 'excluded'
              : normalizePlTreatment(expenseForm.plTreatment),
          ...overridePersistFields,
        }

        const acquisitionCost = assetDraft.acquisitionCost || expenseForm.taxIncludedAmount
        const syncedAssetDraft: ExpenseAssetRegistrationDraft = {
          ...assetDraft,
          acquisitionCost,
          purchaseDate: assetDraft.purchaseDate || getExpenseReceiptDate(expenseForm),
          useStartDate: assetDraft.useStartDate || getExpensePostingDate(expenseForm),
          assetName:
            assetDraft.assetName ||
            assetDraft.assetCategory ||
            expenseForm.description ||
            expenseForm.vendorName,
        }

        const wasEditing = Boolean(editingExpenseId)
        if (!wasEditing && !clientExpenseIdRef.current) {
          clientExpenseIdRef.current = `exp_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 10)}`
        }

        const saveResult = await saveExpenseWithFixedAssetSync({
          mode: wasEditing ? 'update' : 'create',
          expenseId: editingExpenseId || undefined,
          clientExpenseId: wasEditing ? undefined : clientExpenseIdRef.current,
          expensePayload,
          registrationType: syncedAssetDraft.registrationType,
          assetDraft: syncedAssetDraft,
          franchiseeId: tenantScope.franchiseeId,
          storeId: tenantScope.storeId,
          staffId,
          staffName,
          knownAssets: fixedAssets,
          actor: {
            userId: staffId,
            userName: staffName,
            role: (accessScope.role ?? '') as StaffRole | '',
            franchiseeId: tenantScope.franchiseeId,
            storeId: tenantScope.storeId,
          },
        })

        const successMessage =
          syncedAssetDraft.registrationType === 'small'
            ? saveResult.assetAction === 'update'
              ? '経費と少額資産を更新しました。'
              : '経費と少額資産一覧へ登録しました。'
            : syncedAssetDraft.registrationType === 'fixed'
              ? saveResult.assetAction === 'update'
                ? '経費と固定資産を更新しました。'
                : '経費と固定資産台帳へ登録しました。'
              : wasEditing
                ? '経費を更新しました。'
                : '経費を登録しました。'

        clientExpenseIdRef.current = ''
        setEditingExpenseId('')
        setEditingExpenseBaseline(null)
        setEditingExpenseSummary(null)
        baselineRegistrationTypeRef.current = 'normal'
        setAssetDraft(buildEmptyExpenseAssetDraft())
        await resetExpenseFormToNew({ retainPendingUploads: true })
        setStatusMessage(successMessage)
        await reloadExpensesAdjustmentsAndReceipts()
        await reloadFixedAssets()
      } catch (error) {
        const message = error instanceof Error ? error.message : '経費の保存に失敗しました。'
        setErrorMessage(message)
        setExpenseFormActionError(message)
      } finally {
        isSavingExpenseRef.current = false
        setIsSavingExpense(false)
      }
    }

    if (duplicateMatches.length > 0) {
      promptDuplicateCheckBeforeConfirm(
        buildDuplicateCandidateFromForm(expenseForm, editingExpenseId || undefined),
        persistExpense,
      )
      return
    }

    if (expenseForm.confirmationStatus === '確認済み') {
      // 確認済み保存でも重複候補が無い場合はそのまま保存
      await persistExpense()
      return
    }

    await persistExpense()
  }

  const handleEditExpense = (expenseId: string) => {
    const expense = expenses.find((row) => row.id === expenseId)
    if (!expense) {
      return
    }

    const linkedResolution = resolveLinkedFixedAssetsForExpense({
      expenseId,
      linkedAssetId: expense.linkedAssetId,
      assets: fixedAssets,
    })
    if (linkedResolution.status === 'multiple') {
      setErrorMessage(
        'この経費には複数の固定資産が紐付いています。データ確認が必要です。編集を開始できません。',
      )
      return
    }
    const linkedAsset = linkedResolution.status === 'one' ? linkedResolution.asset : null

    const nextForm: AccountingExpenseInput = {
      ...expense,
      receiptDate: getExpenseReceiptDate(expense),
      postingDate: getExpensePostingDate(expense),
      plTreatment: normalizePlTreatment(expense.plTreatment),
      billingInvoiceNumber: expense.billingInvoiceNumber ?? '',
      linkedAssetId: expense.linkedAssetId ?? linkedAsset?.id ?? '',
    }
    const nextDraft = buildAssetDraftForExpenseEdit({
      expense,
      amountYen: expense.taxIncludedAmount,
      description: expense.description,
      vendorName: expense.vendorName,
      suggestedCategory: expense.suggestedExpenseCategory,
      linkedAsset,
    })
    baselineRegistrationTypeRef.current = nextDraft.registrationType

    setEditingExpenseId(expenseId)
    setEditingExpenseBaseline({
      form: nextForm,
      draft: nextDraft,
    })
    setEditingExpenseSummary(
      buildExpenseEditSummary({
        vendorName: expense.vendorName,
        description: expense.description,
        taxIncludedAmount: expense.taxIncludedAmount,
        receiptDate: getExpenseReceiptDate(expense),
      }),
    )
    setExpenseFormActionError('')
    setIsConsumptionTaxManual(
      expense.taxCalculationMode === 'manual' ||
        expense.taxCalculationMode === 'ocr' ||
        (expense.taxAmount ?? expense.consumptionTaxAmount) !==
          calculateConsumptionTaxFromIncluded(expense.taxIncludedAmount, expense.taxRate),
    )
    setOcrCandidateNotice('')
    setInvoiceNumberWarning(
      expense.invoiceNumber ? validateInvoiceNumberCandidate(expense.invoiceNumber).warning : '',
    )
    setExpenseForm(nextForm)
    setAssetDraft(nextDraft)
    setReceiptLocalSelectionActive(false)
    setReceiptSelectionError(false)
    setReceiptSelectedFileMeta(
      nextForm.receiptFileName
        ? {
            name: nextForm.receiptFileName,
            summary: formatAccountingReceiptFileTypeLabel({
              name: nextForm.receiptFileName,
              type: nextForm.receiptFileMimeType || '',
            }),
          }
        : null,
    )
    clearReceiptPreviewObjectUrl()
    clearReceiptRotationState()
    setActiveTab('expenses')
    setStatusMessage('経費を編集モードで読み込みました。')
    setErrorMessage('')
  }

  const handleReturnToExpenseList = async () => {
    if (
      editingExpenseBaseline &&
      expenseForm &&
      hasUnsavedExpenseEditChanges({
        originalForm: editingExpenseBaseline.form as unknown as Record<string, unknown>,
        currentForm: expenseForm as unknown as Record<string, unknown>,
        originalDraft: editingExpenseBaseline.draft,
        currentDraft: assetDraft,
      })
    ) {
      const confirmed = window.confirm('変更内容は保存されません。戻りますか？')
      if (!confirmed) {
        return
      }
    }

    await resetExpenseFormToNew()
    setStatusMessage('経費一覧へ戻りました。')
    window.setTimeout(() => {
      document.getElementById(ACCOUNTING_EXPENSE_LIST_SECTION_ID)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  const handleInvalidateExpense = async (expenseId: string) => {
    const confirmed = window.confirm('この経費を無効化します。証憑画像は削除せず、PLから除外します。')
    if (!confirmed) {
      return
    }

    try {
      await invalidateAccountingExpense({
        expenseId,
        updatedBy: staffId,
        updatedByName: staffName,
      })
      setStatusMessage('経費を無効化しました。')
      await reloadExpensesAndAdjustments()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '経費の無効化に失敗しました。')
    }
  }

  const handleDeleteExpense = async (expenseId: string) => {
    const expense = expenses.find((row) => row.id === expenseId)
    const linkedResolution = resolveLinkedFixedAssetsForExpense({
      expenseId,
      linkedAssetId: expense?.linkedAssetId,
      assets: fixedAssets,
    })

    const confirmed = window.confirm(
      linkedResolution.status === 'none'
        ? 'この経費を削除しますか？\n削除後はPL・集計・CSV出力から除外されます。'
        : buildExpenseDeleteWithLinkedAssetConfirmMessage(),
    )
    if (!confirmed) {
      return
    }

    try {
      await softDeleteAccountingExpense({
        expenseId,
        deletedBy: staffId,
        deletedByName: staffName,
        knownAssets: fixedAssets,
        franchiseeId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        actor: {
          userId: staffId,
          userName: staffName,
          role: (accessScope.role ?? '') as StaffRole | '',
          franchiseeId: tenantScope.franchiseeId,
          storeId: tenantScope.storeId,
        },
      })

      if (editingExpenseId === expenseId) {
        await resetExpenseFormToNew()
      }

      setStatusMessage(
        linkedResolution.status === 'none'
          ? '経費を削除しました（紐付証憑のリンクも解除し、集計対象から除外）。'
          : '経費と紐付固定資産を削除しました（集計対象から除外）。',
      )
      await reloadExpensesAdjustmentsAndReceipts()
      await reloadFixedAssets()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '経費の削除に失敗しました。')
    }
  }

  const handleSaveAdjustment = async () => {
    if (!adjustmentForm) {
      return
    }

    setIsSavingAdjustment(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      await createAccountingAdjustment(adjustmentForm)
      setStatusMessage('調整行を追加しました。')
      setAdjustmentForm({
        ...adjustmentForm,
        amountYen: 0,
        description: '',
        confirmationStatus: '未確認',
      })
      await reloadExpensesAndAdjustments()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '調整行の保存に失敗しました。')
    } finally {
      setIsSavingAdjustment(false)
    }
  }

  const handleInvalidateAdjustment = async (adjustmentId: string) => {
    try {
      await invalidateAccountingAdjustment({
        adjustmentId,
        updatedBy: staffId,
        updatedByName: staffName,
      })
      setStatusMessage('調整行を無効化しました。')
      await reloadExpensesAndAdjustments()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '調整行の無効化に失敗しました。')
    }
  }

  const buildExportPayload = (exportType: 'monthly-pl' | 'yearly-pl' | 'expenses' | 'sales') => {
    if (exportType === 'yearly-pl') {
      return {
        csv: buildYearlyPlCsv(yearlyProfitLoss, targetYear),
        fileName: buildYearlyPlCsvFileName(targetYear),
        rowCount:
          SALES_CATEGORIES.length +
          COST_OF_SALES_CATEGORIES.length +
          FIXED_EXPENSE_CATEGORIES.length +
          VARIABLE_EXPENSE_CATEGORIES.length +
          6,
        targetYearMonth: `${targetYear}-01`,
      }
    }

    const fileSuffix = targetYearMonth

    if (exportType === 'monthly-pl') {
      return {
        csv: buildMonthlyPlCsv(profitLoss),
        fileName: `accounting-pl-${fileSuffix}.csv`,
        rowCount:
          SALES_CATEGORIES.length +
          COST_OF_SALES_CATEGORIES.length +
          FIXED_EXPENSE_CATEGORIES.length +
          VARIABLE_EXPENSE_CATEGORIES.length +
          6,
        targetYearMonth,
      }
    }

    if (exportType === 'sales') {
      return {
        csv: buildSalesCsv(salesRows, targetYearMonth),
        fileName: `accounting-sales-${fileSuffix}.csv`,
        rowCount: salesRows.length,
        targetYearMonth,
      }
    }

    return {
      csv: buildExpensesCsv(
        expenseCsvScope === 'filtered' ? filteredReportingExpenses : reportingMonthExpenses,
        targetYearMonth,
      ),
      fileName: `accounting-expenses-${fileSuffix}.csv`,
      rowCount:
        expenseCsvScope === 'filtered'
          ? filteredReportingExpenses.length
          : reportingMonthExpenses.length,
      targetYearMonth,
    }
  }

  const handleExportPackageRecorded = async (payload: AccountingExportPackageRecordPayload) => {
    // Package history: single Firestore write via recordAccountingExportOperation.
    // onExportRecorded only toasts and must not write history.
    const result = await recordAccountingExportOperation({
      franchiseeId: tenantScope.franchiseeId,
      companyId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      createdBy: staffId,
      createdByName: staffName,
      exportType: payload.exportType,
      fiscalPeriod: payload.fiscalPeriod ?? null,
      targetYearMonth: payload.targetYearMonth,
      files: payload.files,
      readiness: payload.readiness,
      sourceFingerprint: payload.sourceFingerprint,
      sourceRecordCounts: payload.sourceRecordCounts,
      exportSchemaVersion: ACCOUNTING_EXPORT_SCHEMA_VERSION,
      submissionPurpose: payload.submissionPurpose,
      archiveEntryCount: payload.archiveEntryCount,
    })
    if ('error' in result) {
      throw new Error(
        '資料の出力は完了しましたが、出力操作履歴の保存に失敗しました。',
      )
    }
    setStatusMessage(
      `資料の出力操作を記録しました。（${payload.files.length}ファイル）`,
    )
    if (activeTab === 'export') {
      void reloadExportHistory()
    }
  }

  const handleExport = async (exportType: 'monthly-pl' | 'yearly-pl' | 'expenses' | 'sales') => {
    const { csv, fileName, rowCount, targetYearMonth: exportYearMonth } = buildExportPayload(exportType)

    downloadCsvFile(fileName, csv)

    const recordedExportType =
      exportType === 'yearly-pl' ? 'yearly-management-pl-csv' : exportType

    let contentHash: string | undefined
    try {
      contentHash = await computeFileSha256(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    } catch {
      contentHash = undefined
    }

    try {
      await recordAccountingExport({
        franchiseeId: tenantScope.franchiseeId,
        companyId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        exportType: recordedExportType,
        targetYearMonth: exportYearMonth,
        fileName,
        rowCount,
        createdBy: staffId,
        createdByName: staffName,
        fileCount: 1,
        files: [
          {
            fileName,
            format: 'csv',
            documentType: recordedExportType,
            rowCount,
            byteSize: new TextEncoder().encode(csv).length,
            ...(contentHash ? { contentHash } : {}),
          },
        ],
        exportSchemaVersion: ACCOUNTING_EXPORT_SCHEMA_VERSION,
      })
      setStatusMessage(`${fileName} を出力しました。`)
      if (activeTab === 'export') {
        void reloadExportHistory()
      }
    } catch (error) {
      setStatusMessage(`${fileName} を出力しました（履歴保存は失敗）。`)
      console.error(error)
    }
  }

  if (!canAccess) {
    return (
      <main className="page accounting-page" aria-labelledby="accounting-title">
        <section className="content-card accounting-card">
          <h1 id="accounting-title">経理</h1>
          <p className="case-error" role="alert">
            経理画面はオーナーまたはFC本部管理者のみ利用できます。
          </p>
          <Link className="secondary-action" to="/">
            ホームへ戻る
          </Link>
        </section>
      </main>
    )
  }

  if (authBlockedMessage) {
    return (
      <main className="page accounting-page" aria-labelledby="accounting-title">
        <section className="content-card accounting-card">
          <h1 id="accounting-title">経理</h1>
          <p className="case-error" role="alert">
            {authBlockedMessage}
          </p>
          <p className="accounting-note">
            経理データの読み込み権限を確認できませんでした。空の経費一覧は表示しません。ホームから再ログインしてください。
          </p>
          <div className="admin-header-actions">
            <Link className="primary-action" to="/">
              ホームへ戻り再ログイン
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page accounting-page" aria-labelledby="accounting-title">
      <section className="content-card accounting-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Accounting</p>
            <h1 id="accounting-title">経理</h1>
          </div>
          <div className="admin-header-actions">
            {role === 'hq_admin' ? (
              <Link className="text-link" to="/hq">
                FC本部へ戻る
              </Link>
            ) : (
              <Link className="text-link" to="/owner">
                管理センターへ戻る
              </Link>
            )}
            <Link className="text-link" to="/">
              ホームへ戻る
            </Link>
          </div>
        </div>

        <p className="lead admin-lead">
          メーターアプリの確定済み売上を読み取り専用で表示し、経費入力と管理会計PLを管理します。caseRecords は変更しません。
        </p>

        <div className="accounting-toolbar">
          <label>
            対象年月
            <select value={targetYearMonth} onChange={(event) => setTargetYearMonth(event.target.value)}>
              {yearMonthOptions.map((option) => (
                <option key={option} value={option}>
                  {formatYearMonthLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            対象年
            <select value={targetYear} onChange={(event) => setTargetYear(Number(event.target.value))}>
              {calendarYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </select>
          </label>
          <p className="accounting-fiscal-year-note">
            {activeTab === 'pl-yearly' ? (
              <>
                対象年：{targetYear}年 / 年次PL（暦年・管理会計：1〜12月）
              </>
            ) : (
              <>
                対象年：{targetYear}年 / 会計年度：
                {getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, targetYear)?.label ??
                  '会社設立前の年度です'}
              </>
            )}
            {activeTab === 'pl-monthly' ? (
              <> / 月次PL対象月：{formatYearMonthLabel(targetYearMonth)}</>
            ) : null}
          </p>
        </div>

        {showAccountingDiagnostics && sessionDiagnostics ? (
          <section className="accounting-diagnostics" aria-label="セッション診断">
            <h2 className="accounting-diagnostics-title">セッション診断（permission 調査用）</h2>
            <dl className="accounting-diagnostics-list">
              <div>
                <dt>auth.currentUser.uid</dt>
                <dd>{sessionDiagnostics.firebaseAuthUid || '（未ログイン）'}</dd>
              </div>
              <div>
                <dt>auth.currentUser.email</dt>
                <dd>{sessionDiagnostics.firebaseAuthEmail || '（なし）'}</dd>
              </div>
              <div>
                <dt>token.role</dt>
                <dd>{sessionDiagnostics.tokenClaims?.role || '（なし）'}</dd>
              </div>
              <div>
                <dt>token.franchiseeId</dt>
                <dd>{sessionDiagnostics.tokenClaims?.franchiseeId || '（なし）'}</dd>
              </div>
              <div>
                <dt>token.storeId</dt>
                <dd>{sessionDiagnostics.tokenClaims?.storeId || '（なし）'}</dd>
              </div>
              <div>
                <dt>app session role</dt>
                <dd>{sessionDiagnostics.appSessionRole || '（なし）'}</dd>
              </div>
              <div>
                <dt>app session userId</dt>
                <dd>{sessionDiagnostics.appSessionUserId || '（なし）'}</dd>
              </div>
              <div>
                <dt>app session companyId</dt>
                <dd>{sessionDiagnostics.appSessionCompanyId || '（なし）'}</dd>
              </div>
              <div>
                <dt>app session franchiseeId</dt>
                <dd>{sessionDiagnostics.appSessionFranchiseeId || '（なし）'}</dd>
              </div>
              <div>
                <dt>app session storeId</dt>
                <dd>{sessionDiagnostics.appSessionStoreId || '（なし）'}</dd>
              </div>
              <div>
                <dt>session source</dt>
                <dd>{sessionDiagnostics.sessionSource}</dd>
              </div>
              <div>
                <dt>accessScope</dt>
                <dd>
                  role={sessionDiagnostics.accessScope.role ?? ''}, franchiseeId=
                  {sessionDiagnostics.accessScope.franchiseeId ?? ''}, storeId=
                  {sessionDiagnostics.accessScope.storeId ?? ''}, staffId=
                  {sessionDiagnostics.accessScope.staffId ?? ''}
                </dd>
              </div>
              <div>
                <dt>tenant</dt>
                <dd>
                  franchiseeId={sessionDiagnostics.tenant.franchiseeId}, storeId=
                  {sessionDiagnostics.tenant.storeId}
                </dd>
              </div>
              <div>
                <dt>accountingSettlementAuxiliary.docId</dt>
                <dd>
                  {sessionDiagnostics.accessScope.franchiseeId && sessionDiagnostics.accessScope.storeId
                    ? `${sessionDiagnostics.accessScope.franchiseeId}_${sessionDiagnostics.accessScope.storeId}_${targetYear}`
                    : '（scope不足）'}
                </dd>
              </div>
              <div>
                <dt>settlementAuxiliaryLoadError</dt>
                <dd>{settlementAuxiliaryLoadError || '（なし）'}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <nav className="accounting-main-menu" aria-label="経理メニュー">
          {ACCOUNTING_MAIN_MENU.map(({ tab, label }) => (
            <button
              key={tab}
              className={
                activeTab === tab
                  ? `accounting-main-menu-item is-active${
                      tab === 'etax' ? ' is-etax-featured' : tab === 'tax-advisor' ? ' is-tax-advisor-featured' : ''
                    }`
                  : `accounting-main-menu-item${
                      tab === 'etax' ? ' is-etax-featured' : tab === 'tax-advisor' ? ' is-tax-advisor-featured' : ''
                    }`
              }
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>

        {isLoading ? <p className="empty-note">経理データを読み込み中です。</p> : null}
        {authBlockedMessage ? (
          <section className="accounting-panel" aria-label="認証エラー" role="alert">
            <p className="case-error">{authBlockedMessage}</p>
            <p className="accounting-note">
              経理データの読み込み権限を確認できませんでした。ローカルのログイン情報だけでは表示しません。
            </p>
            <Link className="primary-action" to="/">
              ホームへ戻り再ログイン
            </Link>
          </section>
        ) : null}
        {!authBlockedMessage && errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {!authBlockedMessage && settlementAuxiliaryLoadError ? (
          <p className="accounting-warning" role="status">
            {settlementAuxiliaryLoadError}
          </p>
        ) : null}
        {!authBlockedMessage && expensesLoadFailed ? (
          <p className="case-error" role="alert">
            経費データの読み込みに失敗しました。一覧が空でもデータ消失とは限りません。再ログイン後に再度開いてください。
          </p>
        ) : null}
        {statusMessage ? <p className="save-note">{statusMessage}</p> : null}
        {invoiceLookupHistoryWarning ? (
          <p className="accounting-warning" role="status">
            {invoiceLookupHistoryWarning}
          </p>
        ) : null}

        {activeTab === 'pl-monthly' ? (
          <section className="accounting-panel" aria-label="月次PL">
            <>
                <h2>{formatYearMonthLabel(targetYearMonth)} の管理会計PL</h2>
                <p className="accounting-note">
                  会計年度：{formatFiscalYearLabel(targetYearMonth)} / 対象月：{formatYearMonthLabel(targetYearMonth)}
                </p>
                <p className="accounting-note">
                  確定案件 {profitLoss.caseRecordCount}件 / PL反映経費 {profitLoss.confirmedExpenseCount}件 / 固定費マスタ{' '}
                  {profitLoss.fixedCostCount}件 / 繰延資産候補 {profitLoss.deferredCandidateCount}件
                  <br />
                  固定資産台帳の減価償却費は毎月「減価償却費」として自動反映されます。
                </p>
                <SalesIntegrityCheckPanel check={salesIntegrityCheck} />
                <MonthlyManagementPlSections
                  profitLoss={profitLoss}
                  showExpenseFareSalesWarning={showExpenseFareSalesWarning}
                />
            </>
          </section>
        ) : null}

        {activeTab === 'pl-yearly' ? (
          <section className="accounting-panel" aria-label="年次PL">
              <>
                <div className="accounting-pl-yearly-header">
                  <h2>{targetYear}年 年次PL（暦年・管理会計）</h2>
                  <p className="accounting-note">
                    1〜12月の管理会計集計です。申告用は決算・申告 / e-Tax入力用決算資料を使用してください。
                  </p>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => void handleExport('yearly-pl')}
                  >
                    年間PL CSVダウンロード
                  </button>
                </div>
                <p className="accounting-note">
                  前々期・前期・各月・年間合計を同一レイアウトで表示します。減価償却費は固定費の「減価償却費」に集計されます。
                </p>
                <div className="accounting-pl-yearly-wrap">
                  <table className="accounting-table accounting-pl-yearly-table">
                    <thead>
                      <tr>
                        <th>区分</th>
                        <th>科目</th>
                        {yearlyColumnOrder.map((key) => (
                          <th key={key}>{yearlyProfitLoss.columnLabels[key]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SALES_CATEGORIES.map((category) => (
                        <tr key={`sales-${category}`}>
                          <td>売上</td>
                          <td>{category}</td>
                          {yearlyColumnOrder.map((key) => (
                            <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].sales[category])}</td>
                          ))}
                        </tr>
                      ))}
                      <tr className="accounting-pl-yearly-total">
                        <td>売上</td>
                        <td>売上小計</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].salesTotalYen)}</td>
                        ))}
                      </tr>
                      {COST_OF_SALES_CATEGORIES.map((category) => (
                        <tr key={`cos-${category}`}>
                          <td>売上原価</td>
                          <td>{category}</td>
                          {yearlyColumnOrder.map((key) => (
                            <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].costOfSales[category])}</td>
                          ))}
                        </tr>
                      ))}
                      <tr className="accounting-pl-yearly-total">
                        <td>売上原価</td>
                        <td>売上原価小計</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].costOfSalesTotalYen)}</td>
                        ))}
                      </tr>
                      <tr className="accounting-pl-yearly-highlight">
                        <td>粗利益</td>
                        <td>粗利益</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].grossProfitYen)}</td>
                        ))}
                      </tr>
                      {FIXED_EXPENSE_CATEGORIES.map((category) => (
                        <tr key={`fixed-${category}`}>
                          <td>固定費</td>
                          <td>{category}</td>
                          {yearlyColumnOrder.map((key) => (
                            <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].fixedCosts[category])}</td>
                          ))}
                        </tr>
                      ))}
                      <tr className="accounting-pl-yearly-total">
                        <td>固定費</td>
                        <td>固定費小計</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].fixedCostsTotalYen)}</td>
                        ))}
                      </tr>
                      {VARIABLE_EXPENSE_CATEGORIES.map((category) => (
                        <tr key={`var-${category}`}>
                          <td>変動費</td>
                          <td>{category}</td>
                          {yearlyColumnOrder.map((key) => (
                            <td key={key}>
                              {formatPlAmount(yearlyProfitLoss.columns[key].variableExpenses[category])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="accounting-pl-yearly-total">
                        <td>変動費</td>
                        <td>変動費小計</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].variableExpensesTotalYen)}</td>
                        ))}
                      </tr>
                      <tr className="accounting-pl-yearly-highlight">
                        <td>利益</td>
                        <td>営業利益（純利益）</td>
                        {yearlyColumnOrder.map((key) => (
                          <td key={key}>{formatPlAmount(yearlyProfitLoss.columns[key].operatingProfitYen)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
          </section>
        ) : null}

        {activeTab === 'sales' ? (
          <section className="accounting-panel" aria-label="確定売上">
            <h2>確定済み売上（読み取り専用）</h2>
            <p className="accounting-note">
              未完了・運行中・キャンセル・削除済み案件は含みません。修正が必要な場合は調整行を追加してください。
            </p>
            <SalesIntegrityCheckPanel check={salesIntegrityCheck} />
            {showExpenseFareSalesWarning ? (
              <p className="accounting-warning accounting-warning--info" role="note">
                {EXPENSE_FARE_SALES_WARNING}
              </p>
            ) : null}

            <div className="accounting-table-wrap">
              <table className="accounting-table">
                <thead>
                  <tr>
                    <th>案件番号</th>
                    <th>精算日時</th>
                    <th>店舗</th>
                    <th>ドライバー</th>
                    {SALES_CATEGORIES.map((category) => (
                      <th key={category}>{category}</th>
                    ))}
                    <th>合計</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.length > 0 ? (
                    salesRows.map((row) => (
                      <tr key={row.caseRecordId}>
                        <td>{row.caseNumber}</td>
                        <td>{formatCaseDateTime(row.closedAt)}</td>
                        <td>{row.storeName}</td>
                        <td>{row.staffName}</td>
                        {SALES_CATEGORIES.map((category) => (
                          <td key={category}>{formatFareYen(row.breakdown[category])}</td>
                        ))}
                        <td>{formatFareYen(row.totalFareYen)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4 + SALES_CATEGORIES.length + 1}>対象月の確定売上はありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <section className="accounting-subpanel">
              <h3>調整行（売上/経費）</h3>
              {adjustmentForm ? (
                <div className="accounting-form-grid">
                  <label>
                    種別
                    <select
                      value={adjustmentForm.adjustmentType}
                      onChange={(event) =>
                        setAdjustmentForm({
                          ...adjustmentForm,
                          adjustmentType: event.target.value as AccountingAdjustmentInput['adjustmentType'],
                        })
                      }
                    >
                      <option value="sales">売上調整</option>
                      <option value="expense">経費調整</option>
                    </select>
                  </label>
                  <label>
                    対象年月
                    <input
                      type="month"
                      value={adjustmentForm.targetYearMonth}
                      onChange={(event) =>
                        setAdjustmentForm({ ...adjustmentForm, targetYearMonth: event.target.value })
                      }
                    />
                  </label>
                  {adjustmentForm.adjustmentType === 'sales' ? (
                    <label>
                      売上区分
                      <select
                        value={adjustmentForm.salesCategory}
                        onChange={(event) =>
                          setAdjustmentForm({
                            ...adjustmentForm,
                            salesCategory: event.target.value as SalesCategory,
                          })
                        }
                      >
                        {SALES_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      経費科目
                      <select
                        value={adjustmentForm.expenseCategory}
                        onChange={(event) =>
                          setAdjustmentForm({
                            ...adjustmentForm,
                            expenseCategory: event.target.value as ExpenseCategory,
                          })
                        }
                      >
                        <option value="">未選択</option>
                        {EXPENSE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    金額(円)
                    <input
                      type="number"
                      value={adjustmentForm.amountYen}
                      onChange={(event) =>
                        setAdjustmentForm({
                          ...adjustmentForm,
                          amountYen: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    確認状態
                    <select
                      value={adjustmentForm.confirmationStatus}
                      onChange={(event) =>
                        setAdjustmentForm({
                          ...adjustmentForm,
                          confirmationStatus: event.target.value as ExpenseConfirmationStatus,
                        })
                      }
                    >
                      {confirmationStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="accounting-form-span-2">
                    内容
                    <input
                      type="text"
                      value={adjustmentForm.description}
                      onChange={(event) =>
                        setAdjustmentForm({ ...adjustmentForm, description: event.target.value })
                      }
                    />
                  </label>
                  <div className="accounting-form-actions accounting-form-span-2">
                    <button
                      className="primary-action"
                      type="button"
                      disabled={isSavingAdjustment}
                      onClick={() => void handleSaveAdjustment()}
                    >
                      調整行を追加
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="accounting-table-wrap">
                <table className="accounting-table">
                  <thead>
                    <tr>
                      <th>種別</th>
                      <th>区分/科目</th>
                      <th>金額</th>
                      <th>内容</th>
                      <th>状態</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthAdjustments.length > 0 ? (
                      monthAdjustments.map((adjustment) => (
                        <tr key={adjustment.id}>
                          <td>{adjustment.adjustmentType === 'sales' ? '売上' : '経費'}</td>
                          <td>
                            {adjustment.adjustmentType === 'sales'
                              ? adjustment.salesCategory
                              : adjustment.expenseCategory}
                          </td>
                          <td>{formatFareYen(adjustment.amountYen)}</td>
                          <td>{adjustment.description}</td>
                          <td>{adjustment.confirmationStatus}</td>
                          <td>
                            {adjustment.confirmationStatus !== '無効' ? (
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => void handleInvalidateAdjustment(adjustment.id)}
                              >
                                無効化
                              </button>
                            ) : (
                              '―'
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>調整行はありません。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

        {activeTab === 'unorganized-receipts' ? (
          <UnorganizedReceiptsPanel
            entries={receiptInboxEntries}
            expenses={expenses}
            focusReceiptId={focusReceiptId}
            ocrRunningReceiptId={ocrRunningReceiptId}
            ocrStatusByReceiptId={ocrStatusByReceiptId}
            onRegisterAsExpense={handleRegisterReceiptAsExpense}
            onRunOcr={(receipt) => void handleRunOcrOnUnorganizedReceipt(receipt)}
            onConfirm={(receipt) => void handleConfirmUnorganizedReceipt(receipt)}
            onReject={(receipt) => void handleRejectUnorganizedReceipt(receipt)}
            onUnlinkOrphan={(receipt) => void handleUnlinkOrphanReceipt(receipt)}
            onRelinkOrphan={(receipt, expenseId) => void handleRelinkOrphanReceipt(receipt, expenseId)}
            onInvalidateOrphan={(receipt) => void handleInvalidateOrphanReceipt(receipt)}
            onDelete={(receipt) => handleDeleteUnorganizedReceipt(receipt)}
            isBusy={isDeletingReceipt || isSavingExpense || isUploadingReceipt}
          />
        ) : null}

        {activeTab === 'expenses' && expenseForm ? (
          <section className="accounting-panel accounting-expense-panel" aria-label="経費入力">
            <h2>{editingExpenseId ? '経費編集' : '経費入力'}</h2>
            {editingExpenseId && editingExpenseSummary ? (
              <div className="accounting-expense-editing-summary" role="status">
                <p className="accounting-expense-editing-summary-title">編集中：</p>
                <dl className="accounting-expense-editing-summary-grid">
                  <div>
                    <dt>仕入先名</dt>
                    <dd>{editingExpenseSummary.vendorName}</dd>
                  </div>
                  <div>
                    <dt>内容</dt>
                    <dd>{editingExpenseSummary.description}</dd>
                  </div>
                  <div>
                    <dt>税込金額</dt>
                    <dd>{formatFareYen(editingExpenseSummary.taxIncludedAmount)}</dd>
                  </div>
                  <div>
                    <dt>証憑日</dt>
                    <dd>{editingExpenseSummary.receiptDate}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
            <p className="accounting-note">
              OCR/AIの科目提案は参考値です。最終的な経費科目は必ず人が選択して確定してください。
              <br />
              スマホは撮影→OCR→「領収書だけ保存」で一時保存し、PCで未整理領収書を編集・確定する運用を推奨します。
            </p>

            {ocrCandidateNotice ? (
              <p className="accounting-suggestion" role="status">
                {ocrCandidateNotice}
              </p>
            ) : null}

            <section
              className={`accounting-receipt-flow${isReceiptDropActive ? ' accounting-receipt-flow--drag-active' : ''}`}
              aria-label={ACCOUNTING_RECEIPT_DROP_ZONE_ARIA_LABEL}
              role="region"
              tabIndex={0}
              onClick={(event) => {
                if (!shouldOpenFilePickerFromDropZoneTarget(event.target, event.currentTarget)) {
                  return
                }
                openReceiptFilePicker()
              }}
              onKeyDown={(event) => {
                if (!shouldOpenFilePickerFromKeyboard(event.key)) {
                  return
                }
                event.preventDefault()
                openReceiptFilePicker()
              }}
              onDragEnter={(event) => {
                preventBrowserFileNavigation(event)
                setReceiptDropDepth((current) => advanceDropZoneDragDepth(current, 1))
              }}
              onDragLeave={(event) => {
                preventBrowserFileNavigation(event)
                setReceiptDropDepth((current) => advanceDropZoneDragDepth(current, -1))
              }}
              onDragOver={(event) => {
                preventBrowserFileNavigation(event)
              }}
              onDrop={(event) => {
                preventBrowserFileNavigation(event)
                setReceiptDropDepth(0)
                void handleSelectedReceiptFiles(event.dataTransfer.files)
              }}
            >
              <h3>領収書から入力</h3>
              <div
                className={`accounting-receipt-drop-hint${isReceiptDropActive ? ' accounting-receipt-drop-hint--active' : ''}`}
              >
                {isReceiptDropActive ? (
                  <p className="accounting-receipt-drop-hint-title">{ACCOUNTING_RECEIPT_DROP_ZONE_ACTIVE_LABEL}</p>
                ) : (
                  <>
                    <p className="accounting-receipt-drop-hint-title">
                      {ACCOUNTING_RECEIPT_DROP_ZONE_TITLE.split('\n').map((line, index) => (
                        <span key={line}>
                          {index > 0 ? <br /> : null}
                          {line}
                        </span>
                      ))}
                    </p>
                    <p className="accounting-receipt-drop-hint-formats">{ACCOUNTING_RECEIPT_DROP_ZONE_HINT}</p>
                  </>
                )}
              </div>
              <p className="accounting-note">
                <strong>スマホ運用：</strong>撮影 → OCR読取 → 「領収書だけ保存」で一時保存（PL未反映）。
                PCで後から編集・確定してください。
                <br />
                <strong>PC運用：</strong>未整理領収書 → 編集する → OCR候補を確認・修正 → 確定する。
                confirmed のみ PL・CSV・集計へ反映されます。
              </p>
              <div
                className="accounting-receipt-actions"
                data-receipt-drop-ignore="true"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <label className="accounting-receipt-upload-button primary-action">
                  カメラで撮影
                  <input
                    accept="image/*"
                    capture="environment"
                    className="accounting-hidden-input"
                    disabled={isUploadingReceipt || isRunningOcr || isRotatingReceipt}
                    type="file"
                    onChange={(event) =>
                      void handleSelectedReceiptFiles(event.target.files, event.currentTarget)
                    }
                  />
                </label>
                <label className="accounting-receipt-upload-button secondary-action">
                  画像・PDFを選択
                  <input
                    ref={receiptFileInputRef}
                    accept={ACCOUNTING_RECEIPT_FILE_ACCEPT}
                    className="accounting-hidden-input"
                    disabled={isUploadingReceipt || isRunningOcr || isRotatingReceipt}
                    type="file"
                    onChange={(event) =>
                      void handleSelectedReceiptFiles(event.target.files, event.currentTarget)
                    }
                  />
                </label>
                <button
                  className="secondary-action"
                  disabled={!hasFormReceiptImage || isUploadingReceipt || isRunningOcr || isRotatingReceipt}
                  type="button"
                  onClick={() => void handleRunReceiptOcr()}
                >
                  {isRunningOcr
                    ? 'OCR読取中…'
                    : needsOcrRerunAfterRotation
                      ? 'OCR再実行'
                      : 'OCR読取（候補を反映）'}
                </button>
                <button
                  className="primary-action accounting-save-receipt-only-button"
                  disabled={
                    !hasFormReceiptImage ||
                    isUploadingReceipt ||
                    isRunningOcr ||
                    isSavingReceiptOnly ||
                    isRotatingReceipt
                  }
                  type="button"
                  onClick={() => void handleSaveReceiptOnly()}
                >
                  {isSavingReceiptOnly ? '保存中…' : '領収書だけ保存'}
                </button>
              </div>
              {errorMessage ? (
                <p className="accounting-receipt-error" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              {receiptMetaName ? (
                <div className="accounting-receipt-file-meta" aria-live="polite">
                  <p className="accounting-receipt-file-meta-name">{receiptMetaName}</p>
                  {receiptMetaSummary ? (
                    <p className="accounting-receipt-file-meta-summary">{receiptMetaSummary}</p>
                  ) : null}
                  {receiptAttachmentStatusLabel ? (
                    <p className="accounting-receipt-file-meta-status">{receiptAttachmentStatusLabel}</p>
                  ) : null}
                </div>
              ) : null}
              {isUploadingReceipt ? <p className="accounting-note">証憑ファイルをアップロード中…</p> : null}
              {isRunningOcr && ocrProgressMessage ? (
                <p className="accounting-note accounting-ocr-status" role="status">
                  {ocrProgressMessage}
                </p>
              ) : null}
              {expenseReceiptPreviewUrl ? (
                <div className="accounting-receipt-preview accounting-receipt-preview--flow">
                  <div className="accounting-receipt-rotate-toolbar" data-receipt-drop-ignore="true">
                    <button
                      className="secondary-action accounting-receipt-rotate-button"
                      type="button"
                      aria-label="左へ90度回転"
                      title="左へ90度回転"
                      disabled={
                        !hasFormReceiptImage ||
                        isUploadingReceipt ||
                        isRunningOcr ||
                        isRotatingReceipt
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleRotateReceiptImage('left')
                      }}
                    >
                      ↶ 左へ回転
                    </button>
                    <button
                      className="secondary-action accounting-receipt-rotate-button"
                      type="button"
                      aria-label="右へ90度回転"
                      title="右へ90度回転"
                      disabled={
                        !hasFormReceiptImage ||
                        isUploadingReceipt ||
                        isRunningOcr ||
                        isRotatingReceipt
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleRotateReceiptImage('right')
                      }}
                    >
                      ↷ 右へ回転
                    </button>
                    <button
                      className="secondary-action accounting-receipt-rotate-button"
                      type="button"
                      aria-label="元の向きに戻す"
                      title="元の向きに戻す"
                      disabled={
                        !hasFormReceiptImage ||
                        isUploadingReceipt ||
                        isRunningOcr ||
                        isRotatingReceipt ||
                        (receiptRotationDegrees === 0 && !needsOcrRerunAfterRotation)
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleRotateReceiptImage('reset')
                      }}
                    >
                      元に戻す
                    </button>
                  </div>
                  {isRotatingReceipt ? (
                    <p className="accounting-note" role="status">
                      画像を回転中…
                    </p>
                  ) : null}
                  {needsOcrRerunAfterRotation ? (
                    <p className="accounting-warning" role="status">
                      {RECEIPT_ROTATION_OCR_RERUN_MESSAGE}
                    </p>
                  ) : null}
                  <img alt="証憑プレビュー" src={expenseReceiptPreviewUrl} />
                  {expenseReceiptIsPdf ? (
                    <div className="accounting-receipt-pdf-meta">
                      <p className="accounting-receipt-pdf-title">PDF証憑</p>
                      <p>ファイル名：{expenseReceiptFileName || '―'}</p>
                      <p>
                        {expenseReceiptPageCount != null
                          ? `全${expenseReceiptPageCount}ページ`
                          : 'PDF原本は全ページ保存されています'}
                      </p>
                      <p>OCR対象：1ページ目</p>
                      <p className="accounting-note">
                        PDF原本は全ページ保存されています。OCRは1ページ目を対象にしています。
                      </p>
                      {expenseReceiptOriginalStoragePath || expenseReceiptOriginalUrl ? (
                        <button
                          className="secondary-action accounting-receipt-pdf-open"
                          type="button"
                          disabled={isOpeningReceiptOriginal}
                          onClick={() => void handleOpenReceiptOriginal()}
                        >
                          {isOpeningReceiptOriginal ? '開いています…' : 'PDF原本を開く'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {expenseForm.receiptStoragePath || expenseForm.receiptFileStoragePath ? (
                    <p className="accounting-receipt-path">
                      {expenseForm.receiptFileStoragePath || expenseForm.receiptStoragePath}
                    </p>
                  ) : null}
                </div>
              ) : expenseForm.receiptStoragePath || expenseForm.receiptFileStoragePath ? (
                <p className="accounting-note accounting-receipt-preview--flow">
                  証憑ファイルをアップロード済みです（
                  {expenseForm.receiptFileStoragePath || expenseForm.receiptStoragePath}
                  ）。OCR読取を実行できます。
                </p>
              ) : null}
              {expenseForm.ocrConfidence != null ? (
                <p className="accounting-note">OCR信頼度（参考）: {(expenseForm.ocrConfidence * 100).toFixed(0)}%</p>
              ) : null}
            </section>

            <section className="accounting-expense-editor" aria-label="経費確認・編集">
              <aside className="accounting-expense-editor-image" aria-label="領収書画像">
                {expenseReceiptPreviewUrl ? (
                  <>
                    <div className="accounting-expense-image-toolbar">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => adjustReceiptImageZoom(-0.25)}
                      >
                        縮小
                      </button>
                      <span>{Math.round(receiptImageZoom * 100)}%</span>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => adjustReceiptImageZoom(0.25)}
                      >
                        拡大
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={resetReceiptImageZoomOnly}
                      >
                        ズーム解除
                      </button>
                      <button
                        className="secondary-action accounting-receipt-rotate-button"
                        type="button"
                        aria-label="左へ90度回転"
                        title="左へ90度回転"
                        disabled={isUploadingReceipt || isRunningOcr || isRotatingReceipt}
                        onClick={() => void handleRotateReceiptImage('left')}
                      >
                        ↶ 左へ回転
                      </button>
                      <button
                        className="secondary-action accounting-receipt-rotate-button"
                        type="button"
                        aria-label="右へ90度回転"
                        title="右へ90度回転"
                        disabled={isUploadingReceipt || isRunningOcr || isRotatingReceipt}
                        onClick={() => void handleRotateReceiptImage('right')}
                      >
                        ↷ 右へ回転
                      </button>
                      <button
                        className="secondary-action accounting-receipt-rotate-button"
                        type="button"
                        aria-label="元の向きに戻す"
                        title="元の向きに戻す"
                        disabled={
                          isUploadingReceipt ||
                          isRunningOcr ||
                          isRotatingReceipt ||
                          (receiptRotationDegrees === 0 && !needsOcrRerunAfterRotation)
                        }
                        onClick={() => void handleRotateReceiptImage('reset')}
                      >
                        元に戻す
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void resetExpenseFormToNew()}
                      >
                        入力リセット
                      </button>
                    </div>
                    {needsOcrRerunAfterRotation ? (
                      <p className="accounting-warning" role="status">
                        {RECEIPT_ROTATION_OCR_RERUN_MESSAGE}
                      </p>
                    ) : null}
                    {isRotatingReceipt ? (
                      <p className="accounting-note" role="status">
                        画像を回転中…
                      </p>
                    ) : null}
                    {expenseReceiptIsPdf ? (
                      <div className="accounting-receipt-pdf-meta accounting-receipt-pdf-meta--editor">
                        <p className="accounting-receipt-pdf-title">PDF証憑</p>
                        <p>ファイル名：{expenseReceiptFileName || '―'}</p>
                        <p>
                          {expenseReceiptPageCount != null
                            ? `全${expenseReceiptPageCount}ページ`
                            : 'PDF原本は全ページ保存されています'}
                        </p>
                        <p>OCR対象：1ページ目</p>
                        {expenseReceiptOriginalStoragePath || expenseReceiptOriginalUrl ? (
                          <button
                            className="secondary-action accounting-receipt-pdf-open"
                            type="button"
                            disabled={isOpeningReceiptOriginal}
                            onClick={() => void handleOpenReceiptOriginal()}
                          >
                            {isOpeningReceiptOriginal ? '開いています…' : 'PDF原本を開く'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="accounting-expense-image-viewport">
                      <img
                        alt="領収書"
                        className="accounting-expense-image"
                        src={expenseReceiptPreviewUrl}
                        style={{ transform: `scale(${receiptImageZoom})` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="accounting-note">
                    左に領収書画像が表示されます。未整理から「編集する」、または撮影・アップロードしてください。
                  </p>
                )}
              </aside>

              <div className="accounting-expense-editor-form">
                <div className="accounting-form-stack">
                  <label>
                    ① 証憑日
                    <input
                      type="date"
                      value={expenseForm.receiptDate ?? getExpenseReceiptDate(expenseForm)}
                      onChange={(event) => handleExpenseFieldChange('receiptDate', event.target.value)}
                    />
                  </label>

                  <div className="accounting-invoice-quote-row">
                    <label>
                      ② 適格請求書番号
                      <input
                        type="text"
                        value={expenseForm.invoiceNumber ?? ''}
                        placeholder="T4200001013662"
                        onChange={(event) => handleExpenseFieldChange('invoiceNumber', event.target.value)}
                      />
                    </label>
                    <button
                      className="secondary-action accounting-invoice-quote-button"
                      type="button"
                      disabled={isLookingUpInvoice || !expenseForm.invoiceNumber?.trim()}
                      onClick={() => void handleQuoteInvoiceRegistrant()}
                    >
                      {isLookingUpInvoice ? '取得中...' : '引用'}
                    </button>
                  </div>
                  <label>
                    請求書番号
                    <input
                      type="text"
                      value={expenseForm.billingInvoiceNumber ?? ''}
                      placeholder="04938-2312929-1"
                      onChange={(event) =>
                        handleExpenseFieldChange('billingInvoiceNumber', event.target.value)
                      }
                    />
                  </label>
                  <p className="accounting-note">
                    請求書番号は仕入先の請求書・注文番号です。適格請求書番号（T番号）とは別項目です。
                  </p>
                  {invoiceQuoteMessage ? (
                    <p
                      className={
                        invoiceQuoteMessage.tone === 'success'
                          ? 'accounting-quote-success'
                          : 'accounting-quote-error'
                      }
                      role={invoiceQuoteMessage.tone === 'success' ? 'status' : 'alert'}
                    >
                      {invoiceQuoteMessage.text}
                    </p>
                  ) : null}
                  {invoiceLookupHistoryWarning ? (
                    <p className="accounting-warning" role="status">
                      {invoiceLookupHistoryWarning}
                    </p>
                  ) : null}
                  {invoiceNumberWarning ? (
                    <p className="accounting-warning" role="alert">
                      {invoiceNumberWarning}
                    </p>
                  ) : null}
                  {expenseForm.invoiceStatus === 'none' ? (
                    <p className="accounting-warning" role="status">
                      インボイス番号がないため、仕入税額控除の対象は要確認です。
                    </p>
                  ) : null}

                  <label>
                    ③ 仕入先
                    <input
                      type="text"
                      value={expenseForm.vendorName}
                      onChange={(event) => handleExpenseFieldChange('vendorName', event.target.value)}
                    />
                  </label>
                  {expenseForm.invoiceRegisteredNameVerified && expenseForm.invoiceRegisteredName ? (
                    <p className="accounting-note">登録事業者名（引用）: {expenseForm.invoiceRegisteredName}</p>
                  ) : null}

                  <div className="accounting-form-pair">
                    <label>
                      ④ 店舗名
                      <input
                        type="text"
                        value={expenseForm.storeName ?? ''}
                        onChange={(event) => handleExpenseFieldChange('storeName', event.target.value)}
                      />
                    </label>
                    <label>
                      電話番号
                      <input
                        type="tel"
                        value={expenseForm.phoneNumber ?? ''}
                        onChange={(event) => handleExpenseFieldChange('phoneNumber', event.target.value)}
                      />
                    </label>
                  </div>

                  <label>
                    ⑤ 合計金額（税込・円）
                    <input
                      inputMode="numeric"
                      placeholder="例：55000"
                      type="text"
                      value={formatYenInputDisplay(expenseForm.taxIncludedAmount, isNewExpenseEntry)}
                      onChange={(event) => handleTaxIncludedAmountChange(event.target.value)}
                    />
                  </label>
                  <label>
                    消費税額（円・自動計算／手修正可）
                    <div className="accounting-tax-input-row">
                      <input
                        inputMode="numeric"
                        placeholder="例：5000"
                        type="text"
                        value={formatYenInputDisplay(
                          expenseForm.taxAmount ?? expenseForm.consumptionTaxAmount,
                          isNewExpenseEntry && !isConsumptionTaxManual,
                        )}
                        onChange={(event) => handleConsumptionTaxAmountChange(event.target.value)}
                      />
                      <button
                        className="secondary-action accounting-recalc-tax-button"
                        type="button"
                        onClick={handleRecalculateConsumptionTax}
                      >
                        税額を再計算
                      </button>
                    </div>
                    {expenseForm.taxExcludedAmount != null ? (
                      <span className="accounting-note">
                        税抜金額（参考）: {formatFareYen(expenseForm.taxExcludedAmount)}円
                      </span>
                    ) : null}
                  </label>

                  <fieldset className="accounting-radio-fieldset">
                    <legend>⑥ 税区分</legend>
                    <div className="accounting-radio-row">
                      {TAX_CATEGORIES.map((category) => (
                        <label key={category} className="accounting-radio-label">
                          <input
                            type="radio"
                            name="taxCategory"
                            checked={(expenseForm.taxCategory ?? 'taxable') === category}
                            onChange={() => handleExpenseFieldChange('taxCategory', category as TaxCategory)}
                          />
                          {TAX_CATEGORY_LABELS[category]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="accounting-radio-fieldset">
                    <legend>消費税率</legend>
                    <div className="accounting-radio-row">
                      {TAX_RATE_PRESETS.map((rate) => (
                        <label key={rate} className="accounting-radio-label">
                          <input
                            type="radio"
                            name="taxRate"
                            checked={expenseForm.taxRate === rate}
                            onChange={() => handleTaxRatePresetSelect(rate)}
                          />
                          {rate}%
                        </label>
                      ))}
                      <label className="accounting-radio-label">
                        <input
                          type="radio"
                          name="taxRate"
                          checked={
                            expenseForm.taxRate !== null &&
                            expenseForm.taxRate !== undefined &&
                            !isPresetTaxRate(expenseForm.taxRate)
                          }
                          onChange={() => {
                            if (isPresetTaxRate(expenseForm.taxRate) || expenseForm.taxRate === null) {
                              handleCustomTaxRateChange('5')
                            }
                          }}
                        />
                        その他
                      </label>
                      <label className="accounting-radio-label">
                        <input
                          type="radio"
                          name="taxRate"
                          checked={expenseForm.taxRate === null || expenseForm.taxRate === undefined}
                          onChange={() => handleTaxRatePresetSelect(null)}
                        />
                        未設定
                      </label>
                    </div>
                    <label className="accounting-tax-rate-custom">
                      消費税率（%）
                      <input
                        inputMode="decimal"
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        placeholder="例：5"
                        value={expenseForm.taxRate ?? ''}
                        onChange={(event) => handleCustomTaxRateChange(event.target.value)}
                      />
                    </label>
                    {expenseForm.ocrCandidates?.taxRate != null ||
                    expenseForm.ocrCandidates?.taxAmount != null ||
                    expenseForm.ocrParsedFields?.taxRate != null ||
                    expenseForm.ocrParsedFields?.consumptionTaxAmount != null ? (
                      <p className="accounting-note accounting-tax-ocr-candidates">
                        OCR候補: 税率{' '}
                        {expenseForm.ocrCandidates?.taxRate ??
                          expenseForm.ocrParsedFields?.taxRate ??
                          '―'}
                        %／税額{' '}
                        {(
                          expenseForm.ocrCandidates?.taxAmount ??
                          expenseForm.ocrParsedFields?.consumptionTaxAmount
                        ) != null
                          ? `${formatFareYen(
                              expenseForm.ocrCandidates?.taxAmount ??
                                expenseForm.ocrParsedFields?.consumptionTaxAmount ??
                                0,
                            )}円`
                          : '―'}
                        ／税込{' '}
                        {(expenseForm.ocrCandidates?.amount ??
                          expenseForm.ocrParsedFields?.taxIncludedAmount) != null
                          ? `${formatFareYen(
                              expenseForm.ocrCandidates?.amount ??
                                expenseForm.ocrParsedFields?.taxIncludedAmount ??
                                0,
                            )}円`
                          : '―'}
                        ／税抜{' '}
                        {(expenseForm.ocrCandidates?.taxExcludedAmount ??
                          expenseForm.ocrParsedFields?.taxExcludedAmount) != null
                          ? `${formatFareYen(
                              expenseForm.ocrCandidates?.taxExcludedAmount ??
                                expenseForm.ocrParsedFields?.taxExcludedAmount ??
                                0,
                            )}円`
                          : '―'}
                      </p>
                    ) : null}
                  </fieldset>

                  <label className="accounting-expense-category-field">
                    <span className="accounting-expense-category-label-row">
                      ⑦ 経費科目
                      <button
                        type="button"
                        className="accounting-expense-category-help-button"
                        onClick={() => setIsExpenseCategoryHelpOpen(true)}
                        aria-label="経費科目の一覧と使用例を表示"
                        title="経費科目の一覧と使用例"
                      >
                        ?
                      </button>
                    </span>
                    <select
                      value={expenseForm.expenseCategory}
                      onChange={(event) =>
                        handleExpenseFieldChange('expenseCategory', event.target.value as ExpenseCategory | '')
                      }
                    >
                      <option value="">未選択</option>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  {expenseForm.suggestedExpenseCategory ? (
                    <p className="accounting-suggestion">
                      OCR科目候補: {expenseForm.suggestedExpenseCategory}
                      {shouldAutoApplyOcrCandidates(expenseForm.ocrConfidence) &&
                      expenseForm.expenseCategory === expenseForm.suggestedExpenseCategory
                        ? '（自動反映済み・要確認）'
                        : '（参考・集計には未使用）'}
                    </p>
                  ) : null}

                  <ExpenseAssetBranchPanel
                    hasExpenseCategory={Boolean(expenseForm.expenseCategory)}
                    draft={assetDraft}
                    defaultAmount={expenseForm.taxIncludedAmount}
                    defaultPurchaseDate={getExpenseReceiptDate(expenseForm) || getExpensePostingDate(expenseForm)}
                    description={expenseForm.description}
                    vendorName={expenseForm.vendorName}
                    suggestedCategory={expenseForm.suggestedExpenseCategory}
                    smallAssetUsageAssets={fixedAssets}
                    existingFixedAssets={fixedAssets}
                    onChange={setAssetDraft}
                  />

                  <label>
                    ⑧ 支払方法
                    <select
                      value={expenseForm.paymentMethod}
                      onChange={(event) =>
                        handleExpenseFieldChange(
                          'paymentMethod',
                          event.target.value as AccountingExpenseInput['paymentMethod'],
                        )
                      }
                    >
                      <option value="">未選択</option>
                      {PAYMENT_METHODS.filter((method) => method !== '電子マネー' && method !== '役員立替').map(
                        (method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ),
                      )}
                      {(expenseForm.paymentMethod === '電子マネー' ||
                        expenseForm.paymentMethod === '役員立替') && (
                        <option value={expenseForm.paymentMethod}>{expenseForm.paymentMethod}</option>
                      )}
                    </select>
                  </label>

                  <label>
                    ⑨ メモ
                    <textarea
                      rows={3}
                      value={expenseForm.memo ?? ''}
                      onChange={(event) => handleExpenseFieldChange('memo', event.target.value)}
                    />
                  </label>

                  <label>
                    内容（任意・商品名など）
                    <input
                      type="text"
                      value={expenseForm.description}
                      onChange={(event) => handleExpenseFieldChange('description', event.target.value)}
                    />
                  </label>
                  <label>
                    {POSTING_DATE_FIELD_LABEL}
                    <input
                      type="date"
                      value={expenseForm.postingDate ?? getExpensePostingDate(expenseForm)}
                      onChange={(event) => handleExpenseFieldChange('postingDate', event.target.value)}
                    />
                  </label>
                  <p className="accounting-note">{POSTING_DATE_HELP_TEXT}</p>
                  {showPastMonthPostingNotice ? (
                    <p className="accounting-warning" role="status">
                      {PAST_MONTH_POSTING_DATE_NOTICE}
                    </p>
                  ) : null}
                  <label>
                    PL反映区分
                    <select
                      value={expenseForm.plTreatment ?? 'expense'}
                      onChange={(event) =>
                        handleExpenseFieldChange('plTreatment', event.target.value as PlTreatment)
                      }
                    >
                      {PL_TREATMENTS.map((treatment) => (
                        <option key={treatment} value={treatment}>
                          {PL_TREATMENT_LABELS[treatment]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    確認状態
                    <select
                      value={expenseForm.confirmationStatus}
                      onChange={(event) =>
                        handleExpenseFieldChange(
                          'confirmationStatus',
                          event.target.value as ExpenseConfirmationStatus,
                        )
                      }
                    >
                      {confirmationStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="accounting-radio-fieldset">
                    <legend>インボイス</legend>
                    <div className="accounting-radio-row">
                      {INVOICE_STATUSES.map((status) => (
                        <label key={status} className="accounting-radio-label">
                          <input
                            type="radio"
                            name="invoiceStatus"
                            checked={(expenseForm.invoiceStatus ?? 'unknown') === status}
                            onChange={() =>
                              handleExpenseFieldChange('invoiceStatus', status as InvoiceStatus)
                            }
                          />
                          {INVOICE_STATUS_LABELS[status]}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="accounting-form-actions">
                    <button
                      className="primary-action"
                      type="button"
                      disabled={isSavingExpense || isUploadingReceipt || isRunningOcr || isSavingReceiptOnly}
                      onClick={() => void handleSaveExpense()}
                    >
                      {editingExpenseId ? '経費を更新' : '経費を登録（確定）'}
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void resetExpenseFormToNew()}
                    >
                      入力リセット
                    </button>
                    {editingExpenseId ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void resetExpenseFormToNew()}
                      >
                        新規入力に切替
                      </button>
                    ) : null}
                    {editingExpenseId ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void handleReturnToExpenseList()}
                      >
                        経費一覧へ戻る
                      </button>
                    ) : null}
                    {expenseFormActionError ? (
                      <p className="case-error accounting-form-action-error" role="alert">
                        {expenseFormActionError}
                      </p>
                    ) : null}
                  </div>

                  <details
                    className="accounting-audit-menu"
                    open={isAuditMenuOpen}
                    onToggle={(event) => setIsAuditMenuOpen(event.currentTarget.open)}
                  >
                    <summary>証明・監査メニュー</summary>
                    <p className="accounting-note">
                      日常業務では不要です。画像ハッシュ・修正履歴・電子証憑情報など、監査・証明用にまとめています。
                    </p>
                    <dl className="accounting-audit-grid">
                      <div>
                        <dt>imageHash</dt>
                        <dd>{expenseForm.imageHash || '―'}</dd>
                      </div>
                      <div>
                        <dt>プレビュー画像</dt>
                        <dd>
                          {expenseReceiptPreviewStoragePath || expenseReceiptLegacyPreviewUrl ? '有' : '無'}
                        </dd>
                      </div>
                      <div>
                        <dt>storagePath</dt>
                        <dd>
                          {expenseForm.receiptPreviewStoragePath || expenseForm.receiptStoragePath || '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>原本ファイル</dt>
                        <dd>
                          {expenseReceiptOriginalStoragePath || expenseReceiptOriginalUrl ? (
                            <>
                              <span>{expenseReceiptFileName || expenseReceiptOriginalStoragePath || '有'}</span>{' '}
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={isOpeningReceiptOriginal}
                                onClick={() => void handleOpenReceiptOriginal()}
                              >
                                {isOpeningReceiptOriginal ? '開いています…' : '開く'}
                              </button>
                            </>
                          ) : (
                            '―'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>receiptId / receiptStatus</dt>
                        <dd>
                          {expenseForm.receiptId || '―'} / {expenseForm.receiptStatus || '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>OCR日時</dt>
                        <dd>{formatOcrProcessedAt(expenseForm.ocrProcessedAt)}</dd>
                      </div>
                      <div>
                        <dt>OCR信頼度</dt>
                        <dd>
                          {expenseForm.ocrConfidence != null
                            ? `${(expenseForm.ocrConfidence * 100).toFixed(0)}%`
                            : '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>登録者</dt>
                        <dd>
                          {expenseForm.createdByName || expenseForm.createdBy || '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>更新者</dt>
                        <dd>
                          {expenseForm.updatedByName || expenseForm.updatedBy || '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>法人番号</dt>
                        <dd>{expenseForm.invoiceCorporateNumber || '―'}</dd>
                      </div>
                      <div>
                        <dt>所在地</dt>
                        <dd>{expenseForm.invoiceAddress || '―'}</dd>
                      </div>
                      <div>
                        <dt>インボイス確認日時</dt>
                        <dd>{expenseForm.invoiceCheckedAt || '―'}</dd>
                      </div>
                      <div>
                        <dt>取得方法</dt>
                        <dd>{expenseForm.invoiceLookupMethod || '―'}</dd>
                      </div>
                      <div>
                        <dt>確認状態（インボイス）</dt>
                        <dd>{expenseForm.invoiceCheckStatus || '―'}</dd>
                      </div>
                      <div>
                        <dt>論理削除</dt>
                        <dd>
                          {expenseForm.isDeleted
                            ? `削除済み${expenseForm.deletedAt ? ` / ${expenseForm.deletedAt}` : ''}${
                                expenseForm.deletedBy ? ` / by ${expenseForm.deletedBy}` : ''
                              }`
                            : '未削除'}
                        </dd>
                      </div>
                      <div>
                        <dt>削除理由</dt>
                        <dd>{expenseForm.deleteReason || '―'}</dd>
                      </div>
                      <div>
                        <dt>lineItems（将来の複数仕訳）</dt>
                        <dd>{expenseForm.lineItems?.length ?? 0}件</dd>
                      </div>
                      <div>
                        <dt>二重計上チェック</dt>
                        <dd>
                          {currentFormDuplicateMatches.length > 0
                            ? `候補あり（${currentFormDuplicateMatches.length}件）`
                            : '該当なし'}
                        </dd>
                      </div>
                      <div>
                        <dt>電子証憑リンク</dt>
                        <dd>{expenseForm.receiptId ? 'receiptId 紐付けあり' : '未紐付け'}</dd>
                      </div>
                    </dl>
                    <label>
                      OCR全文（候補・集計非対象）
                      <textarea readOnly rows={4} value={expenseForm.ocrRawText ?? ''} />
                    </label>
                    {expenseForm.ocrCandidates ? (
                      <pre className="accounting-audit-json">
                        {JSON.stringify(expenseForm.ocrCandidates, null, 2)}
                      </pre>
                    ) : (
                      <p className="accounting-note">OCR候補データはありません。</p>
                    )}
                  </details>
                </div>
              </div>
            </section>

            <section className="accounting-expense-summaries" aria-label="経費集計サマリー">
              <h3>{formatYearMonthLabel(targetYearMonth)} の集計（確認済み・未削除）</h3>
              <div className="accounting-expense-summary-grid">
                <section>
                  <h4>税区分集計</h4>
                  <ul className="accounting-pl-list">
                    {TAX_CATEGORIES.map((category) => (
                      <li key={category}>
                        <span>{formatTaxCategoryAggregationLabel(category)}</span>
                        <strong>{formatFareYen(taxCategorySummary[category])}</strong>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>インボイス集計</h4>
                  <ul className="accounting-pl-list">
                    {INVOICE_STATUSES.map((status) => (
                      <li key={status}>
                        <span>{formatInvoiceStatusAggregationLabel(status)}</span>
                        <strong>{formatFareYen(invoiceStatusSummary[status])}</strong>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>経費件数</h4>
                  <p className="accounting-note">
                    一覧 {monthExpenses.length}件 / 集計対象 {reportingMonthExpenses.length}件
                  </p>
                </section>
              </div>
            </section>

            <ExpenseListFilterPanel
              filters={expenseListFilters}
              searchInput={expenseSearchInput}
              filtersExpanded={expenseFiltersExpanded}
              resultCount={expenseListQuery.totalCount}
              resultTotalYen={expenseListQuery.totalTaxIncludedAmount}
              activeConditionLabels={expenseListQuery.activeConditionLabels}
              isFiltered={expenseListQuery.isFiltered}
              onSearchInputChange={setExpenseSearchInput}
              onFiltersChange={setExpenseListFilters}
              onClear={() => {
                setExpenseSearchInput('')
                setExpenseListFilters(DEFAULT_EXPENSE_LIST_FILTERS)
              }}
              onToggleExpanded={() => setExpenseFiltersExpanded((current) => !current)}
            />

            <div
              className="accounting-expense-cards"
              id={ACCOUNTING_EXPENSE_LIST_SECTION_ID}
              aria-label="当月経費一覧（カード）"
            >
              {filteredMonthExpenses.length > 0 ? (
                filteredMonthExpenses.map((expense) => (
                  <article key={expense.id} className="accounting-expense-card">
                    <header>
                      <strong>{expense.vendorName || '（仕入先未入力）'}</strong>
                      <span>
                        {EXPENSE_LIST_CONFIRMATION_STATUS_HEADER}{' '}
                        {formatExpenseListConfirmationStatus(expense.confirmationStatus)}
                      </span>
                    </header>
                    <dl>
                      <div>
                        <dt>証憑日</dt>
                        <dd>{getExpenseReceiptDate(expense)}</dd>
                      </div>
                      <div>
                        <dt>{POSTING_DATE_FIELD_LABEL}</dt>
                        <dd>{getExpensePostingDate(expense)}</dd>
                      </div>
                      <div>
                        <dt>仕入先</dt>
                        <dd>{expense.vendorName || '－'}</dd>
                      </div>
                      <div>
                        <dt>T番号</dt>
                        <dd className="accounting-expense-invoice-number">
                          {formatExpenseListInvoiceNumber(expense.invoiceNumber)}
                        </dd>
                      </div>
                      <div>
                        <dt>請求書番号</dt>
                        <dd>{formatExpenseListBillingInvoiceNumber(expense.billingInvoiceNumber)}</dd>
                      </div>
                      <div>
                        <dt>インボイス状態</dt>
                        <dd>{formatExpenseListInvoiceStatus(expense.invoiceStatus)}</dd>
                      </div>
                      <div>
                        <dt>内容</dt>
                        <dd>{expense.description || '―'}</dd>
                      </div>
                      <div>
                        <dt>経費科目</dt>
                        <dd>{expense.expenseCategory || '未選択'}</dd>
                      </div>
                      <div>
                        <dt>PL反映区分</dt>
                        <dd>{getPlTreatmentLabel(expense.plTreatment)}</dd>
                      </div>
                      <div>
                        <dt>税込</dt>
                        <dd>{formatFareYen(expense.taxIncludedAmount)}</dd>
                      </div>
                      <div>
                        <dt>{EXPENSE_LIST_CONFIRMATION_STATUS_HEADER}</dt>
                        <dd>{formatExpenseListConfirmationStatus(expense.confirmationStatus)}</dd>
                      </div>
                    </dl>
                    <div className="accounting-expense-card-actions">
                      {(() => {
                        const actionStatus = getExpenseListActionStatusLabel(expense)
                        if (!actionStatus) {
                          return null
                        }
                        return (
                          <span
                            className={
                              actionStatus === EXPENSE_LIST_RECEIPT_PENDING_LABEL
                                ? 'accounting-expense-action-badge accounting-expense-action-badge--receipt-pending'
                                : 'accounting-expense-action-badge accounting-expense-action-badge--confirm-pending'
                            }
                          >
                            {actionStatus}
                          </span>
                        )
                      })()}
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => handleEditExpense(expense.id)}
                      >
                        編集
                      </button>
                      {expense.confirmationStatus !== '無効' ? (
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => void handleInvalidateExpense(expense.id)}
                        >
                          無効化
                        </button>
                      ) : null}
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void handleDeleteExpense(expense.id)}
                      >
                        削除
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="accounting-note">
                  {expenseListQuery.isFiltered
                    ? '条件に一致する経費はありません。'
                    : '当月の経費はありません。'}
                </p>
              )}
            </div>

            <div className="accounting-table-wrap accounting-table-wrap--desktop">
              <table className="accounting-table accounting-table--desktop accounting-expense-list-table">
                <thead>
                  <tr>
                    <th>証憑日</th>
                    <th>{POSTING_DATE_FIELD_LABEL}</th>
                    <th>仕入先</th>
                    <th>T番号</th>
                    <th>請求書番号</th>
                    <th>インボイス状態</th>
                    <th>内容</th>
                    <th>経費科目</th>
                    <th>PL反映区分</th>
                    <th>税込</th>
                    <th>{EXPENSE_LIST_CONFIRMATION_STATUS_HEADER}</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMonthExpenses.length > 0 ? (
                    filteredMonthExpenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>{getExpenseReceiptDate(expense)}</td>
                        <td>{getExpensePostingDate(expense)}</td>
                        <td>{expense.vendorName}</td>
                        <td className="accounting-expense-invoice-number">
                          {formatExpenseListInvoiceNumber(expense.invoiceNumber)}
                        </td>
                        <td>{formatExpenseListBillingInvoiceNumber(expense.billingInvoiceNumber)}</td>
                        <td>{formatExpenseListInvoiceStatus(expense.invoiceStatus)}</td>
                        <td>{expense.description}</td>
                        <td>{expense.expenseCategory || '未選択'}</td>
                        <td>{getPlTreatmentLabel(expense.plTreatment)}</td>
                        <td>{formatFareYen(expense.taxIncludedAmount)}</td>
                        <td>{formatExpenseListConfirmationStatus(expense.confirmationStatus)}</td>
                        <td>
                          <div className="accounting-expense-row-actions">
                            {(() => {
                              const actionStatus = getExpenseListActionStatusLabel(expense)
                              if (!actionStatus) {
                                return null
                              }
                              return (
                                <span
                                  className={
                                    actionStatus === EXPENSE_LIST_RECEIPT_PENDING_LABEL
                                      ? 'accounting-expense-action-badge accounting-expense-action-badge--receipt-pending'
                                      : 'accounting-expense-action-badge accounting-expense-action-badge--confirm-pending'
                                  }
                                >
                                  {actionStatus}
                                </span>
                              )
                            })()}
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => handleEditExpense(expense.id)}
                            >
                              編集
                            </button>
                            {expense.confirmationStatus !== '無効' ? (
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => void handleInvalidateExpense(expense.id)}
                              >
                                無効化
                              </button>
                            ) : null}
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => void handleDeleteExpense(expense.id)}
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12}>
                        {expenseListQuery.isFiltered
                          ? '条件に一致する経費はありません。'
                          : '対象月の経費はありません。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === 'fixed-costs' ? (
          <FixedCostManagementPanel
            fixedCosts={fixedCosts}
            franchiseeId={tenantScope.franchiseeId}
            storeId={tenantScope.storeId}
            staffId={staffId}
            onReload={reloadFixedCosts}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
          />
        ) : null}

        {activeTab === 'fixed-assets' ? (
          <FixedAssetLedgerPanel
            fixedAssets={fixedAssets}
            staffId={staffId}
            onReload={reloadFixedAssets}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
          />
        ) : null}

        {activeTab === 'audit' ? (
          <AuditMaterialsPanel
            expenses={expenses}
            allReceipts={allReceipts}
            unorganizedReceipts={plainUnorganizedReceipts}
            fixedAssets={fixedAssets}
            salesRows={salesRows}
            profitLoss={profitLoss}
            yearlyProfitLoss={yearlyProfitLoss}
            targetYearMonth={targetYearMonth}
            targetYear={targetYear}
            accessScope={accessScope}
            onExportRecorded={(fileName) => setStatusMessage(`${fileName} を出力しました。`)}
          />
        ) : null}

        {activeTab === 'etax' ? (
          <ETaxSettlementPanel
            franchiseeId={tenantScope.franchiseeId}
            storeId={tenantScope.storeId}
            targetYear={targetYear}
            targetYearMonth={targetYearMonth}
            staffId={staffId}
            staffName={staffName}
            caseRecords={caseRecords}
            expenses={expenses}
            adjustments={adjustments}
            fixedCosts={fixedCosts}
            fixedAssets={fixedAssets}
            settlementAuxiliary={settlementAuxiliary}
            settlementAuxiliaryLoadError={settlementAuxiliaryLoadError}
            allReceipts={allReceipts}
            unorganizedReceipts={plainUnorganizedReceipts}
            onReloadAuxiliary={reloadSettlementAuxiliary}
            onExportRecorded={(fileName) => setStatusMessage(`${fileName} を出力しました。`)}
            onExportPackageRecorded={handleExportPackageRecorded}
            onStatus={setStatusMessage}
            onError={setErrorMessage}
            onNavigateAccountingTab={(tab) => navigateAccountingTab(tab)}
          />
        ) : null}

        {activeTab === 'tax-advisor' ? (
          <TaxAdvisorPackagePanel
            franchiseeId={tenantScope.franchiseeId}
            storeId={tenantScope.storeId}
            storeName={storeName}
            initialTargetYear={targetYear}
            staffId={staffId}
            staffName={staffName}
            caseRecords={caseRecords}
            expenses={expenses}
            adjustments={adjustments}
            fixedCosts={fixedCosts}
            fixedAssets={fixedAssets}
            settlementAuxiliary={settlementAuxiliary}
            settlementAuxiliaryLoadError={settlementAuxiliaryLoadError}
            allReceipts={allReceipts}
            unorganizedReceipts={plainUnorganizedReceipts}
            onExportRecorded={(fileName) => setStatusMessage(`${fileName} を出力しました。`)}
            onExportPackageRecorded={handleExportPackageRecorded}
            onStatus={setStatusMessage}
            onError={setErrorMessage}
            onNavigateAccountingTab={(tab) => navigateAccountingTab(tab)}
          />
        ) : null}

        {activeTab === 'submission' ? (
          <SubmissionPackagePanel
            franchiseeId={tenantScope.franchiseeId}
            storeId={tenantScope.storeId}
            storeName={storeName}
            initialTargetYear={targetYear}
            staffId={staffId}
            staffName={staffName}
            caseRecords={caseRecords}
            expenses={expenses}
            adjustments={adjustments}
            fixedCosts={fixedCosts}
            fixedAssets={fixedAssets}
            settlementAuxiliary={settlementAuxiliary}
            settlementAuxiliaryLoadError={settlementAuxiliaryLoadError}
            receipts={allReceipts}
            unorganizedReceipts={plainUnorganizedReceipts}
            companyName={storeName}
            onExportPackageRecorded={handleExportPackageRecorded}
            onStatus={setStatusMessage}
            onError={setErrorMessage}
            onNavigateAccountingTab={navigateAccountingTab}
          />
        ) : null}

        {activeTab === 'export' ? (
          <section className="accounting-panel" aria-label="CSV出力">
            <h2>CSV出力</h2>
            <p className="accounting-note">
              管理会計PL（月次・年次）・確定売上・経費一覧をCSV出力します。経費CSVは確認済み・未削除のみ含みます。
            </p>
            <fieldset className="accounting-expense-csv-scope">
              <legend>経費CSVの出力範囲</legend>
              <label>
                <input
                  type="radio"
                  name="expense-csv-scope"
                  checked={expenseCsvScope === 'filtered'}
                  onChange={() => setExpenseCsvScope('filtered')}
                />
                現在の絞り込み結果を出力
              </label>
              <label>
                <input
                  type="radio"
                  name="expense-csv-scope"
                  checked={expenseCsvScope === 'all'}
                  onChange={() => setExpenseCsvScope('all')}
                />
                全件を出力
              </label>
            </fieldset>
            <div className="accounting-export-actions">
              <button className="primary-action" type="button" onClick={() => void handleExport('monthly-pl')}>
                月次PL CSV
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport('yearly-pl')}>
                年間PL CSVダウンロード
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport('sales')}>
                確定売上 CSV
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport('expenses')}>
                経費 CSV
              </button>
            </div>

            <section className="accounting-export-history" aria-label="出力操作履歴">
              <h3>出力操作履歴</h3>
              <p className="accounting-warning accounting-warning--info">
                この履歴はアプリ内での出力操作の記録です。端末への保存完了や税務署・税理士への提出済みを保証するものではありません。
              </p>
              {exportHistoryLoading ? <p className="save-note">履歴を読み込み中…</p> : null}
              {exportHistoryError ? (
                <p className="case-error" role="alert">
                  {exportHistoryError}
                </p>
              ) : null}
              {!exportHistoryLoading && !exportHistoryError && exportHistory.length === 0 ? (
                <p className="save-note">出力操作履歴はまだありません。</p>
              ) : null}
              {exportHistory.length > 0 ? (
                <div className="accounting-table-wrap">
                  <table className="accounting-table accounting-export-history-table">
                    <thead>
                      <tr>
                        <th scope="col">日時</th>
                        <th scope="col">操作者</th>
                        <th scope="col">種別</th>
                        <th scope="col">期間</th>
                        <th scope="col">ファイル数</th>
                        <th scope="col">申告前チェック</th>
                        <th scope="col">指紋</th>
                        <th scope="col">schema</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportHistory.map((entry) => {
                        const isExpanded = expandedExportHistoryId === entry.id
                        const periodLabel =
                          entry.fiscalPeriod?.label ||
                          (entry.targetYearMonth
                            ? `対象年月: ${entry.targetYearMonth}`
                            : '記録なし')
                        const fileCount =
                          entry.fileCount ?? entry.files?.length ?? (entry.fileName ? 1 : 0)
                        return (
                          <Fragment key={entry.id}>
                            <tr>
                              <td>
                                <button
                                  type="button"
                                  className="text-link accounting-export-history-expand"
                                  onClick={() =>
                                    setExpandedExportHistoryId(isExpanded ? '' : entry.id)
                                  }
                                >
                                  {entry.createdAt
                                    ? formatCaseDateTime(entry.createdAt)
                                    : '記録なし'}
                                </button>
                              </td>
                              <td>{entry.createdByName || '記録なし'}</td>
                              <td>{formatAccountingExportTypeLabel(entry.exportType)}</td>
                              <td>{periodLabel}</td>
                              <td>{fileCount || '記録なし'}</td>
                              <td>
                                {entry.readiness ? (
                                  <span className="accounting-export-readiness-badges">
                                    <span className="is-blocking">要修正 {entry.readiness.blockingCount}</span>
                                    <span className="is-warning">要確認 {entry.readiness.warningCount}</span>
                                    <span className={entry.readiness.isFilingReady ? 'is-ready' : 'is-not-ready'}>
                                      {entry.readiness.isFilingReady ? '申告可' : '準備未完'}
                                    </span>
                                  </span>
                                ) : (
                                  '記録なし'
                                )}
                              </td>
                              <td>
                                <code>{shortFingerprint(entry.sourceFingerprint, 10)}</code>
                              </td>
                              <td>{entry.exportSchemaVersion || '記録なし'}</td>
                            </tr>
                            {isExpanded ? (
                              <tr className="accounting-export-history-detail">
                                <td colSpan={8}>
                                  <ul className="accounting-export-file-list">
                                    {(entry.files && entry.files.length > 0
                                      ? entry.files.map((file) => file.fileName)
                                      : entry.fileName
                                        ? [entry.fileName]
                                        : []
                                    ).map((name) => (
                                      <li key={name}>{name}</li>
                                    ))}
                                    {!entry.files?.length && !entry.fileName ? (
                                      <li>ファイル名の記録なし</li>
                                    ) : null}
                                  </ul>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}
      </section>
      <ExpenseCategoryHelpDialog
        open={isExpenseCategoryHelpOpen}
        onClose={() => setIsExpenseCategoryHelpOpen(false)}
      />
      {duplicatePrompt ? (
        <DuplicateExpensePromptDialog
          matches={duplicatePrompt.matches}
          severity={duplicatePrompt.severity}
          onReviewExisting={(expenseId) => {
            setDuplicatePrompt(null)
            handleEditExpense(expenseId)
          }}
          onContinue={duplicatePrompt.onContinue}
          onCancel={() => setDuplicatePrompt(null)}
        />
      ) : null}
      {imageDeletePrompt ? (
        <ImageDeleteConfirmDialog
          mode={imageDeletePrompt.mode}
          busy={isDeletingReceipt}
          onCancel={() => {
            if (!isDeletingReceipt) {
              setImageDeletePrompt(null)
            }
          }}
          onConfirm={() => void handleConfirmImageDeletePrompt()}
        />
      ) : null}
    </main>
  )
}
