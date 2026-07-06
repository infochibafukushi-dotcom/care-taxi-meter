import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import './AccountingPage.css'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import {
  buildEmptyExpenseInput,
  createAccountingExpense,
  deleteAccountingExpense,
  fetchAccountingExpenses,
  invalidateAccountingExpense,
  updateAccountingExpense,
} from '../services/accountingExpenses'
import {
  createAccountingAdjustment,
  fetchAccountingAdjustments,
  invalidateAccountingAdjustment,
} from '../services/accountingAdjustments'
import {
  applyOcrCandidatesToAccountingReceipt,
  deleteAccountingReceipt,
  fetchUnorganizedAccountingReceipts,
  invalidateAccountingReceipt,
  resolveAccountingReceiptDownloadUrl,
  saveReceiptOnly,
  uploadAccountingReceiptImage,
  type StoredAccountingReceipt,
} from '../services/accountingReceipts'
import { runAccountingReceiptOcr } from '../services/accountingReceiptOcr'
import { recordAccountingExport } from '../services/accountingExports'
import { loadAuthStaffSession } from '../services/authSession'
import { formatFareYen } from '../services/fare'
import {
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
  INVOICE_CHECK_STATUSES,
  PAYMENT_METHODS,
  PL_TREATMENTS,
  PL_TREATMENT_LABELS,
  RECEIPT_STATUS_LABELS,
  SALES_CATEGORIES,
  getExpensePostingDate,
  getExpenseReceiptDate,
  getPlTreatmentLabel,
  normalizePlTreatment,
  type AccountingAdjustmentInput,
  type AccountingExpenseInput,
  type ExpenseCategory,
  type ExpenseConfirmationStatus,
  type InvoiceCheckStatus,
  type PlTreatment,
  type SalesCategory,
} from '../types/accounting'
import { canAccessAccounting } from '../types/permissions'
import {
  buildExpensesCsv,
  buildMonthlyPlCsv,
  buildSalesCsv,
  downloadCsvFile,
  formatPlAmount,
} from '../utils/accountingCsv'
import { buildAccountingSalesRows, calculateSalesIntegrityCheck, EXPENSE_FARE_SALES_WARNING, filterCaseRecordsByYearMonth, SALES_INTEGRITY_WARNING, sumExpenseFareYenFromCaseRecords } from '../utils/accountingSalesMapping'
import {
  buildYearMonthOptions,
  calculateConsumptionTaxFromIncluded,
  calculateMonthlyProfitLoss,
  EXPENSE_CATEGORIES as PL_EXPENSE_CATEGORIES,
  formatYearMonthLabel,
  getCurrentYearMonthInJapan,
  SALES_CATEGORIES as PL_SALES_CATEGORIES,
} from '../utils/accountingPl'
import { formatCaseDateTime } from '../utils/caseRecords'
import {
  applyAccountingReceiptOcrToExpense,
  buildExpenseFormFromReceipt,
  buildReceiptCandidateFieldsFromExpense,
  formatReceiptSavedAt,
  formatYenInputDisplay,
  hasAccountingFormReceiptImage,
  hasStoredAccountingReceiptImage,
  OCR_NOT_CONFIGURED_MESSAGE,
  parseYenInput,
  RECEIPT_IMAGE_REQUIRED_MESSAGE,
  validateInvoiceNumberCandidate,
} from '../utils/accountingExpenseForm'
import type { SalesIntegrityCheck } from '../utils/accountingSalesMapping'

type AccountingTab = 'sales' | 'expenses' | 'pl' | 'export'

const confirmationStatusOptions: ExpenseConfirmationStatus[] = ['未確認', '確認済み', '無効']

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

  const [activeTab, setActiveTab] = useState<AccountingTab>('pl')
  const [targetYearMonth, setTargetYearMonth] = useState(getCurrentYearMonthInJapan())
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [expenses, setExpenses] = useState<Awaited<ReturnType<typeof fetchAccountingExpenses>>>([])
  const [adjustments, setAdjustments] = useState<Awaited<ReturnType<typeof fetchAccountingAdjustments>>>([])
  const [sessionDiagnostics, setSessionDiagnostics] = useState<AccountingSessionDiagnostics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [expenseForm, setExpenseForm] = useState<AccountingExpenseInput | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false)
  const [isRunningOcr, setIsRunningOcr] = useState(false)
  const [ocrRunningReceiptId, setOcrRunningReceiptId] = useState('')
  const [isConsumptionTaxManual, setIsConsumptionTaxManual] = useState(false)
  const [ocrCandidateNotice, setOcrCandidateNotice] = useState('')
  const [invoiceNumberWarning, setInvoiceNumberWarning] = useState('')
  const [unorganizedReceipts, setUnorganizedReceipts] = useState<StoredAccountingReceipt[]>([])
  const [isSavingReceiptOnly, setIsSavingReceiptOnly] = useState(false)
  const [adjustmentForm, setAdjustmentForm] = useState<AccountingAdjustmentInput | null>(null)
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false)

  const yearMonthOptions = useMemo(() => buildYearMonthOptions(18), [])

  const canAccess = canAccessAccounting(role)

  useEffect(() => {
    if (!canAccess) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    const loadData = async () => {
      setIsLoading(true)
      setErrorMessage('')

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
        loadErrors.push(authValidationError)
      }

      let records: StoredCaseRecord[] = []
      let expenseRows: Awaited<ReturnType<typeof fetchAccountingExpenses>> = []
      let adjustmentRows: Awaited<ReturnType<typeof fetchAccountingAdjustments>> = []
      let unorganizedRows: StoredAccountingReceipt[] = []

      if (!authValidationError) {
        try {
          records = await fetchCaseRecords(accessScope)
        } catch (error) {
          logAccountingQueryFailure('caseRecords', accessScope, error)
          loadErrors.push(formatAccountingQueryErrorMessage('caseRecords', error))
        }

        try {
          expenseRows = await fetchAccountingExpenses(accessScope)
        } catch (error) {
          loadErrors.push(formatAccountingQueryErrorMessage('accountingExpenses', error))
        }

        try {
          adjustmentRows = await fetchAccountingAdjustments(accessScope)
        } catch (error) {
          loadErrors.push(formatAccountingQueryErrorMessage('accountingAdjustments', error))
        }

        try {
          unorganizedRows = await fetchUnorganizedAccountingReceipts(accessScope)
        } catch (error) {
          loadErrors.push(formatAccountingQueryErrorMessage('accountingReceipts', error))
        }
      }

      if (cancelled) {
        return
      }

      setSessionDiagnostics(showAccountingDiagnostics ? diagnostics : null)
      setCaseRecords(records)
      setExpenses(expenseRows)
      setAdjustments(adjustmentRows)
      setUnorganizedReceipts(unorganizedRows)
      setErrorMessage(loadErrors.join(' / '))
      setIsLoading(false)
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [accessScopeKey, authSession, canAccess, showAccountingDiagnostics, targetYearMonth, workSession.currentSession])

  useEffect(() => {
    if (!canAccess || expenseForm) {
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
  }, [canAccess, expenseForm, staffId, staffName, tenantScope.franchiseeId, tenantScope.storeId])

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
      salesCategory: 'その他',
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
        targetYearMonth,
      }),
    [adjustments, caseRecords, expenses, targetYearMonth],
  )
  const monthExpenses = useMemo(
    () => expenses.filter((expense) => getExpensePostingDate(expense).startsWith(targetYearMonth)),
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
  const showExpenseFareSalesWarning = monthExpenseFareTotalYen > 0 || profitLoss.sales['その他'] > 0

  const visibleUnorganizedReceipts = useMemo(
    () => unorganizedReceipts.filter((receipt) => receipt.id !== expenseForm?.receiptId),
    [expenseForm?.receiptId, unorganizedReceipts],
  )

  const hasFormReceiptImage = Boolean(expenseForm && hasAccountingFormReceiptImage(expenseForm))

  const buildFreshExpenseForm = () =>
    buildEmptyExpenseInput({
      franchiseeId: tenantScope.franchiseeId,
      storeId: tenantScope.storeId,
      staffId,
      staffName,
    })

  const resetExpenseFormToNew = () => {
    setEditingExpenseId('')
    setIsConsumptionTaxManual(false)
    setOcrCandidateNotice('')
    setInvoiceNumberWarning('')
    setExpenseForm(buildFreshExpenseForm())
  }

  const reloadUnorganizedReceipts = async () => {
    const rows = await fetchUnorganizedAccountingReceipts(accessScope)
    setUnorganizedReceipts(rows)
  }

  const reloadExpensesAdjustmentsAndReceipts = async () => {
    await reloadExpensesAndAdjustments()
    await reloadUnorganizedReceipts()
  }

  const isNewExpenseEntry = !editingExpenseId

  const handleExpenseFieldChange = <K extends keyof AccountingExpenseInput>(
    key: K,
    value: AccountingExpenseInput[K],
  ) => {
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      const next = { ...current, [key]: value, updatedBy: staffId, updatedByName: staffName }

      if (key === 'taxRate' && !isConsumptionTaxManual) {
        next.consumptionTaxAmount = calculateConsumptionTaxFromIncluded(
          next.taxIncludedAmount,
          Number(value),
        )
      }

      if (key === 'postingDate') {
        next.postingDate = String(value)
        next.transactionDate = String(value)
      }

      if (key === 'receiptDate') {
        next.receiptDate = String(value)
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

      const next = {
        ...current,
        taxIncludedAmount: amount,
        updatedBy: staffId,
        updatedByName: staffName,
      }

      if (!isConsumptionTaxManual) {
        next.consumptionTaxAmount = calculateConsumptionTaxFromIncluded(amount, next.taxRate)
      }

      return next
    })
  }

  const handleConsumptionTaxAmountChange = (raw: string) => {
    setIsConsumptionTaxManual(true)
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        consumptionTaxAmount: parseYenInput(raw),
        updatedBy: staffId,
        updatedByName: staffName,
      }
    })
  }

  const handleRecalculateConsumptionTax = () => {
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        consumptionTaxAmount: calculateConsumptionTaxFromIncluded(current.taxIncludedAmount, current.taxRate),
        updatedBy: staffId,
        updatedByName: staffName,
      }
    })
    setIsConsumptionTaxManual(false)
    setStatusMessage('消費税額を再計算しました。')
  }

  const handleReceiptUpload = async (file: File | null) => {
    if (!file || !expenseForm) {
      return
    }

    setIsUploadingReceipt(true)
    setStatusMessage('')
    setErrorMessage('')

    try {
      const uploaded = await uploadAccountingReceiptImage({
        file,
        franchiseeId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        uploadedBy: staffId,
        uploadedByName: staffName,
      })

      setExpenseForm((current) =>
        current
          ? {
              ...current,
              receiptId: uploaded.receiptId,
              receiptImageUrl: uploaded.downloadUrl,
              receiptStoragePath: uploaded.storagePath,
            }
          : current,
      )
      setStatusMessage('証憑画像をアップロードしました。OCR読取で候補を反映できます。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '証憑画像のアップロードに失敗しました。')
    } finally {
      setIsUploadingReceipt(false)
    }
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

    try {
      const downloadUrl = await resolveAccountingReceiptDownloadUrl({
        downloadUrl: expenseForm.receiptImageUrl,
        storagePath: expenseForm.receiptStoragePath,
      })

      if (!downloadUrl) {
        setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
        return
      }

      if (downloadUrl !== expenseForm.receiptImageUrl) {
        setExpenseForm((current) =>
          current ? { ...current, receiptImageUrl: downloadUrl } : current,
        )
      }

      const result = await runAccountingReceiptOcr({
        downloadUrl,
        receiptId: expenseForm.receiptId,
      })

      if (result.status === 'not_configured') {
        setStatusMessage(OCR_NOT_CONFIGURED_MESSAGE)
        return
      }

      if (result.status === 'error') {
        setErrorMessage(result.message ?? 'OCR の実行に失敗しました。')
        return
      }

      setExpenseForm((current) =>
        current ? applyAccountingReceiptOcrToExpense(current, result) : current,
      )
      setIsConsumptionTaxManual(Boolean(result.parsed.consumptionTaxAmount))
      if (result.parsed.invoiceNumber) {
        const validation = validateInvoiceNumberCandidate(result.parsed.invoiceNumber)
        setInvoiceNumberWarning(validation.warning)
      }
      setOcrCandidateNotice(
        'OCR候補をフォームに反映しました。日付・金額・仕入先等を確認し、経費科目は必ず手動で選択してから保存してください。',
      )
      setStatusMessage(result.message ?? 'OCR候補を反映しました。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'OCR の実行に失敗しました。')
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
      setStatusMessage('領収書を未整理として保存しました。あとで「経費として登録」できます。')
      resetExpenseFormToNew()
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
      form.consumptionTaxAmount !==
        calculateConsumptionTaxFromIncluded(form.taxIncludedAmount, form.taxRate),
    )
    setOcrCandidateNotice(
      '未整理領収書から経費入力フォームへ引き継ぎました。内容と経費科目を確認してから保存してください。',
    )
    setInvoiceNumberWarning(
      form.invoiceNumber ? validateInvoiceNumberCandidate(form.invoiceNumber).warning : '',
    )
    setExpenseForm(form)
    setActiveTab('expenses')
    setStatusMessage('未整理領収書を経費入力フォームへ読み込みました。')
  }

  const handleRunOcrOnUnorganizedReceipt = async (receipt: StoredAccountingReceipt) => {
    if (!hasStoredAccountingReceiptImage(receipt)) {
      setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
      return
    }

    setOcrRunningReceiptId(receipt.id)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const downloadUrl = await resolveAccountingReceiptDownloadUrl({
        downloadUrl: receipt.downloadUrl,
        storagePath: receipt.storagePath,
      })

      if (!downloadUrl) {
        setErrorMessage(RECEIPT_IMAGE_REQUIRED_MESSAGE)
        return
      }

      const result = await runAccountingReceiptOcr({
        downloadUrl,
        receiptId: receipt.id,
        fileName: receipt.fileName,
      })

      if (result.status === 'not_configured') {
        setStatusMessage(OCR_NOT_CONFIGURED_MESSAGE)
        return
      }

      if (result.status === 'error') {
        setErrorMessage(result.message ?? 'OCR の実行に失敗しました。')
        return
      }

      await applyOcrCandidatesToAccountingReceipt({ receiptId: receipt.id, ocr: result })
      await reloadUnorganizedReceipts()

      if (expenseForm?.receiptId === receipt.id) {
        setExpenseForm((current) =>
          current ? applyAccountingReceiptOcrToExpense(current, result) : current,
        )
        setIsConsumptionTaxManual(Boolean(result.parsed.consumptionTaxAmount))
        if (result.parsed.invoiceNumber) {
          setInvoiceNumberWarning(validateInvoiceNumberCandidate(result.parsed.invoiceNumber).warning)
        }
        setOcrCandidateNotice('OCR候補を反映しました。内容と経費科目を確認してから保存してください。')
      }

      setStatusMessage(result.message ?? 'OCR候補を領収書データに反映しました。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'OCR の実行に失敗しました。')
    } finally {
      setOcrRunningReceiptId('')
    }
  }

  const handleInvalidateUnorganizedReceipt = async (receiptId: string) => {
    const confirmed = window.confirm('この未整理領収書を無効化します。画像は削除せず、一覧から除外します。')
    if (!confirmed) {
      return
    }

    try {
      await invalidateAccountingReceipt({ receiptId })
      if (expenseForm?.receiptId === receiptId) {
        resetExpenseFormToNew()
      }
      setStatusMessage('未整理領収書を無効化しました。')
      await reloadUnorganizedReceipts()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '未整理領収書の無効化に失敗しました。')
    }
  }

  const handleDeleteUnorganizedReceipt = async (receiptId: string) => {
    const confirmed = window.confirm(
      'この未整理の領収書データとアップロード画像を削除します。元に戻せません。削除してよろしいですか？',
    )
    if (!confirmed) {
      return
    }

    try {
      const result = await deleteAccountingReceipt(receiptId)

      if (expenseForm?.receiptId === receiptId) {
        resetExpenseFormToNew()
      }

      setStatusMessage(
        result.storageImageWasMissing
          ? '画像ファイルは既に存在しません。未整理データのみ削除しました。'
          : '未整理領収書とアップロード画像を削除しました。',
      )
      await reloadUnorganizedReceipts()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '未整理領収書の削除に失敗しました。')
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

  const handleSaveExpense = async () => {
    if (!expenseForm) {
      return
    }

    if (expenseForm.confirmationStatus === '確認済み' && !expenseForm.expenseCategory) {
      setErrorMessage('経費科目を選択しないと確認済みにできません。')
      return
    }

    setIsSavingExpense(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      if (editingExpenseId) {
        await updateAccountingExpense(editingExpenseId, expenseForm)
        setStatusMessage('経費を更新しました。')
      } else {
        await createAccountingExpense(expenseForm)
        setStatusMessage('経費を登録しました。')
      }

      setEditingExpenseId('')
      resetExpenseFormToNew()
      await reloadExpensesAdjustmentsAndReceipts()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '経費の保存に失敗しました。')
    } finally {
      setIsSavingExpense(false)
    }
  }

  const handleEditExpense = (expenseId: string) => {
    const expense = expenses.find((row) => row.id === expenseId)
    if (!expense) {
      return
    }

    setEditingExpenseId(expenseId)
    setIsConsumptionTaxManual(
      expense.consumptionTaxAmount !==
        calculateConsumptionTaxFromIncluded(expense.taxIncludedAmount, expense.taxRate),
    )
    setOcrCandidateNotice('')
    setInvoiceNumberWarning(
      expense.invoiceNumber ? validateInvoiceNumberCandidate(expense.invoiceNumber).warning : '',
    )
    setExpenseForm({
      ...expense,
      receiptDate: getExpenseReceiptDate(expense),
      postingDate: getExpensePostingDate(expense),
      plTreatment: normalizePlTreatment(expense.plTreatment),
    })
    setActiveTab('expenses')
    setStatusMessage('経費を編集モードで読み込みました。')
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
    const confirmed = window.confirm(
      'この経費データを削除します。元に戻せません。削除してよろしいですか？',
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteAccountingExpense(expenseId)

      if (editingExpenseId === expenseId) {
        resetExpenseFormToNew()
      }

      setStatusMessage('経費を削除しました。')
      await reloadExpensesAndAdjustments()
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

  const buildExportPayload = (exportType: 'monthly-pl' | 'expenses' | 'sales') => {
    const fileSuffix = targetYearMonth

    if (exportType === 'monthly-pl') {
      return {
        csv: buildMonthlyPlCsv(profitLoss),
        fileName: `accounting-pl-${fileSuffix}.csv`,
        rowCount: PL_SALES_CATEGORIES.length + PL_EXPENSE_CATEGORIES.length + 3,
      }
    }

    if (exportType === 'sales') {
      return {
        csv: buildSalesCsv(salesRows, targetYearMonth),
        fileName: `accounting-sales-${fileSuffix}.csv`,
        rowCount: salesRows.length,
      }
    }

    return {
      csv: buildExpensesCsv(monthExpenses, targetYearMonth),
      fileName: `accounting-expenses-${fileSuffix}.csv`,
      rowCount: monthExpenses.length,
    }
  }

  const handleExport = async (exportType: 'monthly-pl' | 'expenses' | 'sales') => {
    const { csv, fileName, rowCount } = buildExportPayload(exportType)

    downloadCsvFile(fileName, csv)

    try {
      await recordAccountingExport({
        franchiseeId: tenantScope.franchiseeId,
        companyId: tenantScope.franchiseeId,
        storeId: tenantScope.storeId,
        exportType,
        targetYearMonth,
        fileName,
        rowCount,
        createdBy: staffId,
        createdByName: staffName,
      })
      setStatusMessage(`${fileName} を出力しました。`)
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
          メーターアプリの確定済み売上を読み取り専用で表示し、経費入力と月次PLを管理します。caseRecords は変更しません。
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
            </dl>
          </section>
        ) : null}

        <nav className="accounting-tabs" aria-label="経理メニュー">
          {([
            ['pl', '月次PL'],
            ['sales', '確定売上'],
            ['expenses', '経費入力'],
            ['export', 'CSV出力'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              className={activeTab === tab ? 'accounting-tab is-active' : 'accounting-tab'}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>

        {isLoading ? <p className="empty-note">経理データを読み込み中です。</p> : null}
        {errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {statusMessage ? <p className="save-note">{statusMessage}</p> : null}

        {activeTab === 'pl' ? (
          <section className="accounting-panel" aria-label="月次PL">
            <h2>{formatYearMonthLabel(targetYearMonth)} の月次PL</h2>
            <p className="accounting-note">
              確定案件 {profitLoss.caseRecordCount}件 / PL反映経費 {profitLoss.confirmedExpenseCount}件 / 繰延資産候補{' '}
              {profitLoss.deferredCandidateCount}件
            </p>
            <SalesIntegrityCheckPanel check={salesIntegrityCheck} />
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
                    <span>売上合計</span>
                    <strong>{formatPlAmount(profitLoss.salesTotalYen)}</strong>
                  </li>
                </ul>
              </section>
              <section>
                <h3>経費</h3>
                <ul className="accounting-pl-list">
                  {PL_EXPENSE_CATEGORIES.map((category) => (
                    <li key={category}>
                      <span>{category}</span>
                      <strong>{formatPlAmount(profitLoss.expenses[category])}</strong>
                    </li>
                  ))}
                  <li className="accounting-pl-total">
                    <span>経費合計</span>
                    <strong>{formatPlAmount(profitLoss.expensesTotalYen)}</strong>
                  </li>
                </ul>
              </section>
              <section className="accounting-pl-deferred">
                <h3>繰延資産候補</h3>
                <p className="accounting-note">
                  PL反映区分が「繰延資産候補」の確認済み経費です。経費合計・営業利益には含めません。
                </p>
                <ul className="accounting-pl-list">
                  {EXPENSE_CATEGORIES.filter((category) => profitLoss.deferredCandidate[category] > 0).length > 0 ? (
                    EXPENSE_CATEGORIES.filter((category) => profitLoss.deferredCandidate[category] > 0).map(
                      (category) => (
                        <li key={category}>
                          <span>{category}</span>
                          <strong>{formatPlAmount(profitLoss.deferredCandidate[category])}</strong>
                        </li>
                      ),
                    )
                  ) : (
                    <li>
                      <span>該当なし</span>
                      <strong>{formatPlAmount(0)}</strong>
                    </li>
                  )}
                  <li className="accounting-pl-total">
                    <span>繰延資産候補合計</span>
                    <strong>{formatPlAmount(profitLoss.deferredCandidateTotalYen)}</strong>
                  </li>
                </ul>
              </section>
              <section className="accounting-pl-profit">
                <h3>利益</h3>
                <p>
                  <span>営業利益</span>
                  <strong>{formatPlAmount(profitLoss.operatingProfitYen)}</strong>
                </p>
              </section>
            </div>
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

        {activeTab === 'expenses' && expenseForm ? (
          <section className="accounting-panel accounting-expense-panel" aria-label="経費入力">
            <h2>{editingExpenseId ? '経費編集' : '経費入力'}</h2>
            <p className="accounting-note">
              OCR/AIの科目提案は参考値です。最終的な経費科目は必ず人が選択して確定してください。
            </p>

            {ocrCandidateNotice ? (
              <p className="accounting-suggestion" role="status">
                {ocrCandidateNotice}
              </p>
            ) : null}

            <section className="accounting-receipt-flow" aria-label="領収書OCR登録">
              <h3>領収書から入力</h3>
              <p className="accounting-note">
                撮影または画像選択 → OCR読取（候補） → 内容確認 → 経費科目を手動選択 → 保存
                <br />
                忙しい時は「領収書だけ保存」で画像だけ先に残せます。
              </p>
              <div className="accounting-receipt-actions">
                <label className="accounting-receipt-upload-button primary-action">
                  カメラで撮影
                  <input
                    accept="image/*"
                    capture="environment"
                    className="accounting-hidden-input"
                    disabled={isUploadingReceipt || isRunningOcr}
                    type="file"
                    onChange={(event) => void handleReceiptUpload(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="accounting-receipt-upload-button secondary-action">
                  画像を選択
                  <input
                    accept="image/*"
                    className="accounting-hidden-input"
                    disabled={isUploadingReceipt || isRunningOcr}
                    type="file"
                    onChange={(event) => void handleReceiptUpload(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  className="secondary-action"
                  disabled={!hasFormReceiptImage || isUploadingReceipt || isRunningOcr}
                  type="button"
                  onClick={() => void handleRunReceiptOcr()}
                >
                  {isRunningOcr ? 'OCR読取中…' : 'OCR読取（候補を反映）'}
                </button>
                <button
                  className="primary-action accounting-save-receipt-only-button"
                  disabled={!hasFormReceiptImage || isUploadingReceipt || isRunningOcr || isSavingReceiptOnly}
                  type="button"
                  onClick={() => void handleSaveReceiptOnly()}
                >
                  {isSavingReceiptOnly ? '保存中…' : '領収書だけ保存'}
                </button>
              </div>
              {isUploadingReceipt ? <p className="accounting-note">証憑画像をアップロード中…</p> : null}
              {expenseForm.receiptImageUrl ? (
                <div className="accounting-receipt-preview">
                  <img alt="証憑プレビュー" src={expenseForm.receiptImageUrl} />
                  <p>{expenseForm.receiptStoragePath}</p>
                </div>
              ) : expenseForm.receiptStoragePath ? (
                <p className="accounting-note">証憑画像をアップロード済みです（{expenseForm.receiptStoragePath}）。OCR読取を実行できます。</p>
              ) : null}
              {expenseForm.ocrConfidence != null ? (
                <p className="accounting-note">OCR信頼度（参考）: {(expenseForm.ocrConfidence * 100).toFixed(0)}%</p>
              ) : null}
            </section>

            <section className="accounting-unorganized-panel" aria-label="未整理の領収書">
              <h3>未整理の領収書 ({visibleUnorganizedReceipts.length})</h3>
              <p className="accounting-note">
                領収書だけ保存したデータです。PLには反映されません。「経費として登録」で入力フォームへ引き継げます。
              </p>
              {visibleUnorganizedReceipts.length > 0 ? (
                <>
                  <div className="accounting-unorganized-cards">
                    {visibleUnorganizedReceipts.map((receipt) => (
                      <article key={receipt.id} className="accounting-unorganized-card">
                        {receipt.downloadUrl ? (
                          <img
                            alt="領収書サムネイル"
                            className="accounting-unorganized-thumb"
                            src={receipt.downloadUrl}
                          />
                        ) : (
                          <div className="accounting-unorganized-thumb accounting-unorganized-thumb--empty">
                            画像なし
                          </div>
                        )}
                        <div className="accounting-unorganized-body">
                          <header>
                            <strong>{receipt.vendorNameCandidate || '（仕入先候補なし）'}</strong>
                            <span>{RECEIPT_STATUS_LABELS[receipt.status]}</span>
                          </header>
                          <dl>
                            <div>
                              <dt>保存日</dt>
                              <dd>{formatReceiptSavedAt(receipt)}</dd>
                            </div>
                            <div>
                              <dt>証憑日候補</dt>
                              <dd>{receipt.receiptDate || '―'}</dd>
                            </div>
                            <div>
                              <dt>金額候補</dt>
                              <dd>
                                {receipt.amountTotalCandidate != null
                                  ? formatFareYen(receipt.amountTotalCandidate)
                                  : '―'}
                              </dd>
                            </div>
                            <div>
                              <dt>インボイス候補</dt>
                              <dd>{receipt.invoiceNumberCandidate || '―'}</dd>
                            </div>
                            <div>
                              <dt>メモ</dt>
                              <dd>{receipt.memo || '―'}</dd>
                            </div>
                          </dl>
                          <div className="accounting-unorganized-actions">
                            <button
                              className="primary-action"
                              type="button"
                              onClick={() => handleRegisterReceiptAsExpense(receipt)}
                            >
                              経費として登録
                            </button>
                            <button
                              className="secondary-action"
                              disabled={!hasStoredAccountingReceiptImage(receipt) || ocrRunningReceiptId === receipt.id}
                              type="button"
                              onClick={() => void handleRunOcrOnUnorganizedReceipt(receipt)}
                            >
                              {ocrRunningReceiptId === receipt.id ? 'OCR読取中…' : 'OCR読取'}
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => void handleInvalidateUnorganizedReceipt(receipt.id)}
                            >
                              無効化
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => void handleDeleteUnorganizedReceipt(receipt.id)}
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="accounting-table-wrap accounting-table-wrap--desktop accounting-unorganized-table-wrap">
                    <table className="accounting-table accounting-table--desktop">
                      <thead>
                        <tr>
                          <th>画像</th>
                          <th>保存日</th>
                          <th>証憑日候補</th>
                          <th>仕入先候補</th>
                          <th>金額候補</th>
                          <th>インボイス候補</th>
                          <th>メモ</th>
                          <th>状態</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleUnorganizedReceipts.map((receipt) => (
                          <tr key={receipt.id}>
                            <td>
                              {receipt.downloadUrl ? (
                                <img
                                  alt="領収書サムネイル"
                                  className="accounting-unorganized-table-thumb"
                                  src={receipt.downloadUrl}
                                />
                              ) : (
                                '―'
                              )}
                            </td>
                            <td>{formatReceiptSavedAt(receipt)}</td>
                            <td>{receipt.receiptDate || '―'}</td>
                            <td>{receipt.vendorNameCandidate || '―'}</td>
                            <td>
                              {receipt.amountTotalCandidate != null
                                ? formatFareYen(receipt.amountTotalCandidate)
                                : '―'}
                            </td>
                            <td>{receipt.invoiceNumberCandidate || '―'}</td>
                            <td>{receipt.memo || '―'}</td>
                            <td>{RECEIPT_STATUS_LABELS[receipt.status]}</td>
                            <td>
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => handleRegisterReceiptAsExpense(receipt)}
                              >
                                経費として登録
                              </button>
                              <button
                                className="secondary-action"
                                disabled={!hasStoredAccountingReceiptImage(receipt) || ocrRunningReceiptId === receipt.id}
                                type="button"
                                onClick={() => void handleRunOcrOnUnorganizedReceipt(receipt)}
                              >
                                OCR読取
                              </button>
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => void handleInvalidateUnorganizedReceipt(receipt.id)}
                              >
                                無効化
                              </button>
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => void handleDeleteUnorganizedReceipt(receipt.id)}
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="accounting-note">未整理の領収書はありません。</p>
              )}
            </section>

            <div className="accounting-form-grid">
              <label>
                証憑日
                <input
                  type="date"
                  value={expenseForm.receiptDate ?? getExpenseReceiptDate(expenseForm)}
                  onChange={(event) => handleExpenseFieldChange('receiptDate', event.target.value)}
                />
              </label>
              <label>
                計上日
                <input
                  type="date"
                  value={expenseForm.postingDate ?? getExpensePostingDate(expenseForm)}
                  onChange={(event) => handleExpenseFieldChange('postingDate', event.target.value)}
                />
              </label>
              <label>
                仕入先
                <input
                  type="text"
                  value={expenseForm.vendorName}
                  onChange={(event) => handleExpenseFieldChange('vendorName', event.target.value)}
                />
              </label>
              <label className="accounting-form-span-2">
                内容
                <input
                  type="text"
                  value={expenseForm.description}
                  onChange={(event) => handleExpenseFieldChange('description', event.target.value)}
                />
              </label>
              <label>
                経費科目（必須・手動確定）
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
                <p className="accounting-suggestion accounting-form-span-2">
                  OCR/AI仮分類: {expenseForm.suggestedExpenseCategory}（自動確定しません）
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
                税込金額(円)
                <input
                  inputMode="numeric"
                  placeholder="例：551000"
                  type="text"
                  value={formatYenInputDisplay(expenseForm.taxIncludedAmount, isNewExpenseEntry)}
                  onChange={(event) => handleTaxIncludedAmountChange(event.target.value)}
                />
              </label>
              <label>
                税率(%)
                <input
                  inputMode="decimal"
                  min="0"
                  type="number"
                  value={expenseForm.taxRate}
                  onChange={(event) => handleExpenseFieldChange('taxRate', Number(event.target.value))}
                />
              </label>
              <label className="accounting-tax-field">
                消費税額(円)
                <div className="accounting-tax-input-row">
                  <input
                    inputMode="numeric"
                    placeholder="例：50090"
                    type="text"
                    value={formatYenInputDisplay(
                      expenseForm.consumptionTaxAmount,
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
              </label>
              <label>
                支払方法
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
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                インボイス番号
                <input
                  type="text"
                  value={expenseForm.invoiceNumber ?? ''}
                  onChange={(event) => handleExpenseFieldChange('invoiceNumber', event.target.value)}
                />
              </label>
              {invoiceNumberWarning ? (
                <p className="accounting-warning accounting-form-span-2" role="alert">
                  {invoiceNumberWarning}
                </p>
              ) : null}
              <label>
                インボイス確認
                <select
                  value={expenseForm.invoiceCheckStatus ?? '未確認'}
                  onChange={(event) =>
                    handleExpenseFieldChange('invoiceCheckStatus', event.target.value as InvoiceCheckStatus)
                  }
                >
                  {INVOICE_CHECK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                登録事業者名（手入力）
                <input
                  type="text"
                  value={expenseForm.invoiceRegisteredName ?? ''}
                  onChange={(event) => handleExpenseFieldChange('invoiceRegisteredName', event.target.value)}
                />
              </label>
              <label>
                インボイス確認日時
                <input
                  type="datetime-local"
                  value={
                    expenseForm.invoiceCheckedAt
                      ? expenseForm.invoiceCheckedAt.slice(0, 16)
                      : ''
                  }
                  onChange={(event) =>
                    handleExpenseFieldChange(
                      'invoiceCheckedAt',
                      event.target.value ? `${event.target.value}:00` : '',
                    )
                  }
                />
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
              <label className="accounting-form-span-2">
                メモ
                <textarea
                  rows={3}
                  value={expenseForm.memo ?? ''}
                  onChange={(event) => handleExpenseFieldChange('memo', event.target.value)}
                />
              </label>
              <details className="accounting-form-span-2 accounting-ocr-details">
                <summary>OCR詳細（候補データ）</summary>
                <p className="accounting-note">以下は OCR 候補の保存用です。経費科目は上の選択欄で手動確定してください。</p>
                <label>
                  OCR全文
                  <textarea
                    readOnly
                    rows={3}
                    value={expenseForm.ocrRawText ?? ''}
                  />
                </label>
                <label>
                  ocrConfidence
                  <input
                    readOnly
                    type="number"
                    step="0.01"
                    value={expenseForm.ocrConfidence ?? ''}
                  />
                </label>
                <label>
                  suggestedExpenseCategory（参考・自動確定しない）
                  <select
                    disabled
                    value={expenseForm.suggestedExpenseCategory ?? ''}
                  >
                    <option value="">未設定</option>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              <div className="accounting-form-actions accounting-form-span-2">
                <button
                  className="primary-action"
                  type="button"
                  disabled={isSavingExpense || isUploadingReceipt || isRunningOcr || isSavingReceiptOnly}
                  onClick={() => void handleSaveExpense()}
                >
                  {editingExpenseId ? '経費を更新' : '経費を登録'}
                </button>
                {editingExpenseId ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={resetExpenseFormToNew}
                  >
                    新規入力に切替
                  </button>
                ) : null}
              </div>
            </div>

            <div className="accounting-expense-cards" aria-label="当月経費一覧（カード）">
              {monthExpenses.length > 0 ? (
                monthExpenses.map((expense) => (
                  <article key={expense.id} className="accounting-expense-card">
                    <header>
                      <strong>{expense.vendorName || '（仕入先未入力）'}</strong>
                      <span>{expense.confirmationStatus}</span>
                    </header>
                    <dl>
                      <div>
                        <dt>証憑日</dt>
                        <dd>{getExpenseReceiptDate(expense)}</dd>
                      </div>
                      <div>
                        <dt>計上日</dt>
                        <dd>{getExpensePostingDate(expense)}</dd>
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
                    </dl>
                    <div className="accounting-expense-card-actions">
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
                <p className="accounting-note">当月の経費はありません。</p>
              )}
            </div>

            <div className="accounting-table-wrap accounting-table-wrap--desktop">
              <table className="accounting-table accounting-table--desktop">
                <thead>
                  <tr>
                    <th>証憑日</th>
                    <th>計上日</th>
                    <th>仕入先</th>
                    <th>内容</th>
                    <th>経費科目</th>
                    <th>PL反映区分</th>
                    <th>税込</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {monthExpenses.length > 0 ? (
                    monthExpenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>{getExpenseReceiptDate(expense)}</td>
                        <td>{getExpensePostingDate(expense)}</td>
                        <td>{expense.vendorName}</td>
                        <td>{expense.description}</td>
                        <td>{expense.expenseCategory || '未選択'}</td>
                        <td>{getPlTreatmentLabel(expense.plTreatment)}</td>
                        <td>{formatFareYen(expense.taxIncludedAmount)}</td>
                        <td>{expense.confirmationStatus}</td>
                        <td>
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
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9}>対象月の経費はありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === 'export' ? (
          <section className="accounting-panel" aria-label="CSV出力">
            <h2>CSV出力</h2>
            <p className="accounting-note">
              月次PL・確定売上・経費一覧をCSV出力します。出力履歴は accountingExports に保存されます。
            </p>
            <div className="accounting-export-actions">
              <button className="primary-action" type="button" onClick={() => void handleExport('monthly-pl')}>
                月次PL CSV
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport('sales')}>
                確定売上 CSV
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport('expenses')}>
                経費 CSV
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}
