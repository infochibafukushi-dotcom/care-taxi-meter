import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './AccountingPage.css'
import { fetchCaseRecordsInClosedAtRange } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import {
  buildEmptyExpenseInput,
  createAccountingExpense,
  fetchAccountingExpenses,
  invalidateAccountingExpense,
  updateAccountingExpense,
} from '../services/accountingExpenses'
import {
  createAccountingAdjustment,
  fetchAccountingAdjustments,
  invalidateAccountingAdjustment,
} from '../services/accountingAdjustments'
import { uploadAccountingReceiptImage } from '../services/accountingReceipts'
import { recordAccountingExport } from '../services/accountingExports'
import { loadAuthStaffSession } from '../services/authSession'
import { formatFareYen } from '../services/fare'
import { tenantScopeFromSession } from '../services/tenancy'
import {
  formatAccountingQueryErrorMessage,
  logAccountingQueryFailure,
  resolveAccountingAccessScope,
} from '../services/accountingTenant'
import { useWorkSession } from '../hooks/useWorkSession'
import type { StaffRole } from '../types/work'
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  SALES_CATEGORIES,
  type AccountingAdjustmentInput,
  type AccountingExpenseInput,
  type ExpenseCategory,
  type ExpenseConfirmationStatus,
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
import { getMonthRangeInJapan } from '../utils/japanDate'
import { formatCaseDateTime } from '../utils/caseRecords'
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
  const workSession = useWorkSession()
  const authSession = useMemo(() => loadAuthStaffSession(), [])
  const sessionSource = useMemo(() => {
    if (authSession && (authSession.role === 'owner' || authSession.role === 'hq_admin')) {
      return authSession
    }

    return workSession.currentSession ?? authSession
  }, [authSession, workSession.currentSession])
  const accessScope = useMemo(() => resolveAccountingAccessScope(sessionSource), [sessionSource])
  const tenantScope = useMemo(() => tenantScopeFromSession(sessionSource), [sessionSource])
  const role = (accessScope.role ?? '') as StaffRole | ''
  const accessScopeKey = `${accessScope.role ?? ''}|${accessScope.franchiseeId ?? ''}|${accessScope.storeId ?? ''}|${accessScope.staffId ?? ''}`
  const staffId = accessScope.staffId ?? authSession?.id ?? workSession.currentSession?.staffId ?? ''
  const staffName =
    authSession?.name ?? workSession.currentSession?.staffName ?? '経理担当'

  const [activeTab, setActiveTab] = useState<AccountingTab>('pl')
  const [targetYearMonth, setTargetYearMonth] = useState(getCurrentYearMonthInJapan())
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [expenses, setExpenses] = useState<Awaited<ReturnType<typeof fetchAccountingExpenses>>>([])
  const [adjustments, setAdjustments] = useState<Awaited<ReturnType<typeof fetchAccountingAdjustments>>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [expenseForm, setExpenseForm] = useState<AccountingExpenseInput | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false)
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

      const monthRange = getMonthRangeInJapan(new Date(`${targetYearMonth}-01T00:00:00+09:00`))
      const loadErrors: string[] = []
      let records: StoredCaseRecord[] = []
      let expenseRows: Awaited<ReturnType<typeof fetchAccountingExpenses>> = []
      let adjustmentRows: Awaited<ReturnType<typeof fetchAccountingAdjustments>> = []

      try {
        records = await fetchCaseRecordsInClosedAtRange({
          startIso: monthRange.startIso,
          endIso: monthRange.endIso,
          scope: accessScope,
        })
      } catch (error) {
        logAccountingQueryFailure('caseRecords', accessScope, error, {
          startIso: monthRange.startIso,
          endIso: monthRange.endIso,
        })
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

      if (cancelled) {
        return
      }

      setCaseRecords(records)
      setExpenses(expenseRows)
      setAdjustments(adjustmentRows)
      setErrorMessage(loadErrors.join(' / '))
      setIsLoading(false)
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [accessScopeKey, canAccess, targetYearMonth])

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
    () => expenses.filter((expense) => expense.transactionDate.startsWith(targetYearMonth)),
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

  const handleExpenseFieldChange = <K extends keyof AccountingExpenseInput>(
    key: K,
    value: AccountingExpenseInput[K],
  ) => {
    setExpenseForm((current) => {
      if (!current) {
        return current
      }

      const next = { ...current, [key]: value, updatedBy: staffId, updatedByName: staffName }

      if (key === 'taxIncludedAmount' || key === 'taxRate') {
        next.consumptionTaxAmount = calculateConsumptionTaxFromIncluded(
          key === 'taxIncludedAmount' ? Number(value) : next.taxIncludedAmount,
          key === 'taxRate' ? Number(value) : next.taxRate,
        )
      }

      if (key === 'confirmationStatus' && value === '確認済み' && !next.expenseCategory) {
        setStatusMessage('経費科目を選択してから確認済みにしてください。')
        return { ...current, confirmationStatus: '未確認' }
      }

      return next
    })
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
      setStatusMessage('証憑画像をアップロードしました。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '証憑画像のアップロードに失敗しました。')
    } finally {
      setIsUploadingReceipt(false)
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
      setExpenseForm(
        buildEmptyExpenseInput({
          franchiseeId: tenantScope.franchiseeId,
          storeId: tenantScope.storeId,
          staffId,
          staffName,
        }),
      )
      await reloadExpensesAndAdjustments()
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
    setExpenseForm({ ...expense })
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
              確定案件 {profitLoss.caseRecordCount}件 / 確認済み経費 {profitLoss.confirmedExpenseCount}件
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
          <section className="accounting-panel" aria-label="経費入力">
            <h2>{editingExpenseId ? '経費編集' : '経費入力'}</h2>
            <p className="accounting-note">
              OCR/AIの科目提案は参考値です。最終的な経費科目は必ず人が選択して確定してください。
            </p>

            <div className="accounting-form-grid">
              <label>
                取引日
                <input
                  type="date"
                  value={expenseForm.transactionDate}
                  onChange={(event) => handleExpenseFieldChange('transactionDate', event.target.value)}
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
                税込金額(円)
                <input
                  type="number"
                  min="0"
                  value={expenseForm.taxIncludedAmount}
                  onChange={(event) =>
                    handleExpenseFieldChange('taxIncludedAmount', Number(event.target.value))
                  }
                />
              </label>
              <label>
                税率(%)
                <input
                  type="number"
                  min="0"
                  value={expenseForm.taxRate}
                  onChange={(event) => handleExpenseFieldChange('taxRate', Number(event.target.value))}
                />
              </label>
              <label>
                消費税額(円)
                <input type="number" min="0" value={expenseForm.consumptionTaxAmount} readOnly />
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
              <label className="accounting-form-span-2">
                証憑画像
                <input
                  accept="image/*"
                  capture="environment"
                  type="file"
                  onChange={(event) => void handleReceiptUpload(event.target.files?.[0] ?? null)}
                />
              </label>
              {expenseForm.receiptImageUrl ? (
                <div className="accounting-receipt-preview accounting-form-span-2">
                  <img alt="証憑プレビュー" src={expenseForm.receiptImageUrl} />
                  <p>{expenseForm.receiptStoragePath}</p>
                </div>
              ) : null}
              <details className="accounting-form-span-2">
                <summary>OCRデータ（将来拡張用）</summary>
                <label>
                  ocrRawText
                  <textarea
                    rows={3}
                    value={expenseForm.ocrRawText ?? ''}
                    onChange={(event) => handleExpenseFieldChange('ocrRawText', event.target.value)}
                  />
                </label>
                <label>
                  ocrConfidence
                  <input
                    type="number"
                    step="0.01"
                    value={expenseForm.ocrConfidence ?? ''}
                    onChange={(event) =>
                      handleExpenseFieldChange(
                        'ocrConfidence',
                        event.target.value === '' ? undefined : Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label>
                  suggestedExpenseCategory
                  <select
                    value={expenseForm.suggestedExpenseCategory ?? ''}
                    onChange={(event) =>
                      handleExpenseFieldChange(
                        'suggestedExpenseCategory',
                        event.target.value as ExpenseCategory | '',
                      )
                    }
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
                  disabled={isSavingExpense || isUploadingReceipt}
                  onClick={() => void handleSaveExpense()}
                >
                  {editingExpenseId ? '経費を更新' : '経費を登録'}
                </button>
                {editingExpenseId ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setEditingExpenseId('')
                      setExpenseForm(
                        buildEmptyExpenseInput({
                          franchiseeId: tenantScope.franchiseeId,
                          storeId: tenantScope.storeId,
                          staffId,
                          staffName,
                        }),
                      )
                    }}
                  >
                    新規入力に切替
                  </button>
                ) : null}
              </div>
            </div>

            <div className="accounting-table-wrap">
              <table className="accounting-table">
                <thead>
                  <tr>
                    <th>取引日</th>
                    <th>仕入先</th>
                    <th>内容</th>
                    <th>経費科目</th>
                    <th>税込</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {monthExpenses.length > 0 ? (
                    monthExpenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>{expense.transactionDate}</td>
                        <td>{expense.vendorName}</td>
                        <td>{expense.description}</td>
                        <td>{expense.expenseCategory || '未選択'}</td>
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
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>対象月の経費はありません。</td>
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
