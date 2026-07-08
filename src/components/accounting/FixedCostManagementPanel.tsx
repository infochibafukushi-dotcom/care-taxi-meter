import { useMemo, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import {
  buildEmptyFixedCostInput,
  cancelAccountingFixedCost,
  createAccountingFixedCost,
  invalidateAccountingFixedCost,
  updateAccountingFixedCost,
} from '../../services/accountingFixedCosts'
import type { AccountingFixedCostInput, ExpenseCategory, StoredAccountingFixedCost } from '../../types/accounting'
import {
  FIXED_COST_AMOUNT_MODES,
  FIXED_COST_CATEGORY_OPTIONS,
  FIXED_COST_STATUS_LABELS,
} from '../../types/accounting'
import {
  calculateFixedCostFiscalYearAmount,
  deriveFixedCostStatus,
  formatFixedCostYearMonthLabel,
  getFixedCostCancelYearMonth,
  syncFixedCostAmounts,
} from '../../utils/accountingFixedCost'
import { getCurrentYearMonthInJapan } from '../../utils/accountingPl'

type FixedCostManagementPanelProps = {
  fixedCosts: StoredAccountingFixedCost[]
  franchiseeId: string
  storeId: string
  staffId: string
  onReload: () => Promise<void>
  onError: (message: string) => void
  onStatus: (message: string) => void
}

export function FixedCostManagementPanel({
  fixedCosts,
  franchiseeId,
  storeId,
  staffId,
  onReload,
  onError,
  onStatus,
}: FixedCostManagementPanelProps) {
  const referenceYearMonth = getCurrentYearMonthInJapan()
  const [showForm, setShowForm] = useState(false)
  const [editingFixedCostId, setEditingFixedCostId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [cancelTargetId, setCancelTargetId] = useState('')
  const [cancelYearMonth, setCancelYearMonth] = useState(referenceYearMonth)
  const [fixedCostForm, setFixedCostForm] = useState<AccountingFixedCostInput>(() =>
    buildEmptyFixedCostInput({ franchiseeId, storeId, staffId }),
  )

  const visibleFixedCosts = useMemo(
    () => fixedCosts.filter((cost) => cost.confirmationStatus !== '無効'),
    [fixedCosts],
  )

  const resetForm = () => {
    setEditingFixedCostId('')
    setShowForm(false)
    setFixedCostForm(buildEmptyFixedCostInput({ franchiseeId, storeId, staffId }))
  }

  const openCreateForm = () => {
    setEditingFixedCostId('')
    setFixedCostForm({
      ...buildEmptyFixedCostInput({ franchiseeId, storeId, staffId }),
      startYearMonth: getCurrentYearMonthInJapan(),
    })
    setShowForm(true)
  }

  const openEditForm = (cost: StoredAccountingFixedCost) => {
    setEditingFixedCostId(cost.id)
    setFixedCostForm({
      franchiseeId: cost.franchiseeId,
      companyId: cost.companyId,
      storeId: cost.storeId,
      name: cost.name,
      expenseCategory: cost.expenseCategory,
      amountMode: cost.amountMode,
      monthlyAmountYen: cost.monthlyAmountYen,
      annualAmountYen: cost.annualAmountYen,
      startYearMonth: cost.startYearMonth,
      cancelYearMonth: getFixedCostCancelYearMonth(cost),
      endYearMonth: getFixedCostCancelYearMonth(cost),
      status: deriveFixedCostStatus(cost),
      memo: cost.memo ?? '',
      confirmationStatus: cost.confirmationStatus,
      sourceType: 'fixedCost',
      createdBy: cost.createdBy ?? staffId,
      updatedBy: staffId,
    })
    setShowForm(true)
  }

  const handleAmountModeChange = (amountMode: AccountingFixedCostInput['amountMode']) => {
    setFixedCostForm((current) => {
      const synced = syncFixedCostAmounts(amountMode, current.monthlyAmountYen, current.annualAmountYen)
      return { ...current, amountMode, ...synced }
    })
  }

  const handleMonthlyAmountChange = (monthlyAmountYen: number) => {
    setFixedCostForm((current) => ({
      ...current,
      ...syncFixedCostAmounts('monthly', monthlyAmountYen, current.annualAmountYen),
      amountMode: 'monthly',
    }))
  }

  const handleAnnualAmountChange = (annualAmountYen: number) => {
    setFixedCostForm((current) => ({
      ...current,
      ...syncFixedCostAmounts('annual', current.monthlyAmountYen, annualAmountYen),
      amountMode: 'annual',
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    onError('')

    try {
      const payload: AccountingFixedCostInput = {
        ...fixedCostForm,
        franchiseeId,
        companyId: franchiseeId,
        storeId,
        updatedBy: staffId,
        confirmationStatus: '確認済み',
        sourceType: 'fixedCost',
        status: getFixedCostCancelYearMonth(fixedCostForm) ? 'cancelled' : 'active',
      }

      if (editingFixedCostId) {
        await updateAccountingFixedCost(editingFixedCostId, payload)
        onStatus('固定費を更新しました。')
      } else {
        await createAccountingFixedCost({
          ...payload,
          createdBy: staffId,
        })
        onStatus('固定費を追加しました。')
      }

      resetForm()
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定費の保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelFixedCost = async () => {
    if (!cancelTargetId || !cancelYearMonth) {
      onError('解約月を入力してください。')
      return
    }

    try {
      await cancelAccountingFixedCost({
        fixedCostId: cancelTargetId,
        cancelYearMonth,
        updatedBy: staffId,
      })
      onStatus('固定費を解約しました。')
      setCancelTargetId('')
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定費の解約に失敗しました。')
    }
  }

  const handleDeleteFixedCost = async (fixedCostId: string) => {
    const confirmed = window.confirm('この固定費を削除しますか？履歴からも消えます。')
    if (!confirmed) {
      return
    }

    try {
      await invalidateAccountingFixedCost({ fixedCostId, updatedBy: staffId })
      onStatus('固定費を削除しました。')
      if (editingFixedCostId === fixedCostId) {
        resetForm()
      }
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定費の削除に失敗しました。')
    }
  }

  const previewFiscalAmount = calculateFixedCostFiscalYearAmount(fixedCostForm, referenceYearMonth)

  return (
    <section className="accounting-panel" aria-label="固定費管理">
      <div className="accounting-fixed-cost-header">
        <h2>固定費管理</h2>
        {!showForm ? (
          <button className="primary-action" type="button" onClick={openCreateForm}>
            ＋固定費を追加
          </button>
        ) : null}
      </div>

      {showForm ? (
        <section className="accounting-subpanel">
          <h3>{editingFixedCostId ? '固定費を編集' : '固定費を追加'}</h3>
          <div className="accounting-form-grid">
            <label>
              科目
              <select
                value={fixedCostForm.expenseCategory}
                onChange={(event) =>
                  setFixedCostForm({
                    ...fixedCostForm,
                    expenseCategory: event.target.value as ExpenseCategory,
                  })
                }
              >
                {FIXED_COST_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input
                type="text"
                value={fixedCostForm.name}
                onChange={(event) => setFixedCostForm({ ...fixedCostForm, name: event.target.value })}
                placeholder="例：楽天ひかり"
              />
            </label>
            <label>
              金額入力方式
              <select
                value={fixedCostForm.amountMode}
                onChange={(event) =>
                  handleAmountModeChange(event.target.value as AccountingFixedCostInput['amountMode'])
                }
              >
                {FIXED_COST_AMOUNT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === 'monthly' ? '月額' : '年額'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              月額(円)
              <input
                type="number"
                value={fixedCostForm.monthlyAmountYen}
                disabled={fixedCostForm.amountMode !== 'monthly'}
                onChange={(event) => handleMonthlyAmountChange(Number(event.target.value))}
              />
            </label>
            <label>
              年額(円)
              <input
                type="number"
                value={fixedCostForm.annualAmountYen}
                disabled={fixedCostForm.amountMode !== 'annual'}
                onChange={(event) => handleAnnualAmountChange(Number(event.target.value))}
              />
            </label>
            <label>
              発生開始月
              <input
                type="month"
                value={fixedCostForm.startYearMonth}
                onChange={(event) =>
                  setFixedCostForm({ ...fixedCostForm, startYearMonth: event.target.value })
                }
              />
            </label>
            <label>
              解約月（任意）
              <input
                type="month"
                value={fixedCostForm.cancelYearMonth ?? ''}
                onChange={(event) =>
                  setFixedCostForm({
                    ...fixedCostForm,
                    cancelYearMonth: event.target.value || undefined,
                    endYearMonth: event.target.value || undefined,
                    status: event.target.value ? 'cancelled' : 'active',
                  })
                }
              />
            </label>
            <label>
              状態
              <input
                type="text"
                value={FIXED_COST_STATUS_LABELS[deriveFixedCostStatus(fixedCostForm)]}
                readOnly
              />
            </label>
            <label className="accounting-form-span-2">
              メモ
              <textarea
                value={fixedCostForm.memo ?? ''}
                onChange={(event) => setFixedCostForm({ ...fixedCostForm, memo: event.target.value })}
                rows={2}
              />
            </label>
            <p className="accounting-note accounting-form-span-2">
              当年度計上額（プレビュー）: {formatFareYen(previewFiscalAmount)}
            </p>
            <div className="accounting-form-actions accounting-form-span-2">
              <button className="primary-action" type="button" disabled={isSaving} onClick={() => void handleSave()}>
                {editingFixedCostId ? '更新する' : '追加する'}
              </button>
              <button className="secondary-action" type="button" onClick={resetForm}>
                キャンセル
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="accounting-table-wrap accounting-table-wrap--desktop accounting-fixed-cost-table-wrap">
        <table className="accounting-table">
          <thead>
            <tr>
              <th>科目</th>
              <th>名称</th>
              <th>月額</th>
              <th>年額</th>
              <th>開始月</th>
              <th>解約月</th>
              <th>当年度計上額</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleFixedCosts.length > 0 ? (
              visibleFixedCosts.map((cost) => {
                const status = deriveFixedCostStatus(cost)
                const fiscalAmount = calculateFixedCostFiscalYearAmount(cost, referenceYearMonth)
                const categoryLabel =
                  FIXED_COST_CATEGORY_OPTIONS.find((option) => option.value === cost.expenseCategory)?.label ??
                  cost.expenseCategory

                return (
                  <tr key={cost.id}>
                    <td>{categoryLabel}</td>
                    <td>{cost.name}</td>
                    <td>{formatFareYen(cost.monthlyAmountYen)}</td>
                    <td>{formatFareYen(cost.annualAmountYen)}</td>
                    <td>{formatFixedCostYearMonthLabel(cost.startYearMonth)}</td>
                    <td>{formatFixedCostYearMonthLabel(getFixedCostCancelYearMonth(cost))}</td>
                    <td>{formatFareYen(fiscalAmount)}</td>
                    <td>{FIXED_COST_STATUS_LABELS[status]}</td>
                    <td>
                      <div className="accounting-fixed-cost-row-actions">
                        <button className="secondary-action" type="button" onClick={() => openEditForm(cost)}>
                          編集
                        </button>
                        {status === 'active' ? (
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => {
                              setCancelTargetId(cost.id)
                              setCancelYearMonth(referenceYearMonth)
                            }}
                          >
                            解約
                          </button>
                        ) : null}
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => void handleDeleteFixedCost(cost.id)}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={9}>登録済みの固定費はありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="accounting-fixed-cost-cards" aria-label="固定費一覧（カード）">
        {visibleFixedCosts.map((cost) => {
          const status = deriveFixedCostStatus(cost)
          const fiscalAmount = calculateFixedCostFiscalYearAmount(cost, referenceYearMonth)
          const categoryLabel =
            FIXED_COST_CATEGORY_OPTIONS.find((option) => option.value === cost.expenseCategory)?.label ??
            cost.expenseCategory

          return (
            <article key={cost.id} className="accounting-fixed-cost-card">
              <header>
                <div>
                  <p className="accounting-fixed-cost-card-category">{categoryLabel}</p>
                  <h3>{cost.name}</h3>
                </div>
                <span className="accounting-fixed-cost-card-status">{FIXED_COST_STATUS_LABELS[status]}</span>
              </header>
              <dl>
                <div>
                  <dt>月額</dt>
                  <dd>{formatFareYen(cost.monthlyAmountYen)}</dd>
                </div>
                <div>
                  <dt>年額</dt>
                  <dd>{formatFareYen(cost.annualAmountYen)}</dd>
                </div>
                <div>
                  <dt>開始</dt>
                  <dd>{formatFixedCostYearMonthLabel(cost.startYearMonth)}</dd>
                </div>
                <div>
                  <dt>解約</dt>
                  <dd>{formatFixedCostYearMonthLabel(getFixedCostCancelYearMonth(cost))}</dd>
                </div>
                <div>
                  <dt>当年度</dt>
                  <dd>{formatFareYen(fiscalAmount)}</dd>
                </div>
              </dl>
              <div className="accounting-fixed-cost-card-actions">
                <button className="secondary-action" type="button" onClick={() => openEditForm(cost)}>
                  編集
                </button>
                {status === 'active' ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setCancelTargetId(cost.id)
                      setCancelYearMonth(referenceYearMonth)
                    }}
                  >
                    解約
                  </button>
                ) : null}
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void handleDeleteFixedCost(cost.id)}
                >
                  削除
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {cancelTargetId ? (
        <div className="accounting-fixed-cost-cancel-dialog" role="dialog" aria-modal="true" aria-label="固定費解約">
          <div className="accounting-fixed-cost-cancel-dialog-body">
            <h3>固定費を解約</h3>
            <p className="accounting-note">解約月の翌月からPLへの計上を停止します。</p>
            <label>
              解約月
              <input
                type="month"
                value={cancelYearMonth}
                onChange={(event) => setCancelYearMonth(event.target.value)}
              />
            </label>
            <div className="accounting-form-actions">
              <button className="primary-action" type="button" onClick={() => void handleCancelFixedCost()}>
                解約する
              </button>
              <button className="secondary-action" type="button" onClick={() => setCancelTargetId('')}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
