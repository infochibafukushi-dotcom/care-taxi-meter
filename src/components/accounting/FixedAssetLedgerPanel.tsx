import { useEffect, useMemo, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import {
  fetchAccountingExpenseLinkById,
  softDeleteAccountingFixedAsset,
  updateFixedAssetWithOptionalLinkedExpense,
} from '../../services/accountingFixedAssets'
import { getCurrentYearMonthInJapan } from '../../utils/accountingPl'
import {
  buildFixedAssetEditDraft,
  buildKindChangeImpact,
  categoryOptionsForKind,
  materialFieldsChanged,
  recalculateFixedAssetPreview,
  validateFixedAssetEditDraft,
  type FixedAssetEditDraft,
} from '../../utils/accountingFixedAssetEdit'
import { toYearMonth } from '../../utils/accountingDepreciation'
import {
  ASSET_CONDITIONS,
  EXPENSE_REGISTRATION_TYPE_LABELS,
  EXPENSE_REGISTRATION_TYPES,
  FIXED_ASSET_STATUS_LABELS,
  VEHICLE_TYPES,
  type ExpenseRegistrationType,
  type StoredAccountingFixedAsset,
} from '../../types/accountingFixedAssets'

type SortKey =
  | 'purchaseDate'
  | 'assetName'
  | 'assetCategory'
  | 'acquisitionCost'
  | 'appliedUsefulLifeYears'
  | 'monthlyDepreciationYen'
  | 'remainingBookValue'
  | 'status'

type FixedAssetLedgerPanelProps = {
  fixedAssets: StoredAccountingFixedAsset[]
  staffId: string
  onReload: () => Promise<void>
  onError: (message: string) => void
  onStatus: (message: string) => void
}

const emptyDraft = (): FixedAssetEditDraft => ({
  purchaseDate: '',
  assetName: '',
  assetCategory: '',
  acquisitionCost: 0,
  useStartDate: '',
  appliedUsefulLifeYears: 1,
  usefulLifeChangeReason: '',
  notes: '',
  assetKind: 'fixed',
  registrationType: 'fixed',
  condition: '新品',
  vehicleType: '',
  firstRegistrationYearMonth: '',
})

export function FixedAssetLedgerPanel({
  fixedAssets,
  staffId,
  onReload,
  onError,
  onStatus,
}: FixedAssetLedgerPanelProps) {
  const asOfYearMonth = getCurrentYearMonthInJapan()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('purchaseDate')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [editingAssetId, setEditingAssetId] = useState('')
  const [draft, setDraft] = useState<FixedAssetEditDraft>(emptyDraft)
  const [originalAsset, setOriginalAsset] = useState<StoredAccountingFixedAsset | null>(null)
  const [linkedExpenseStatus, setLinkedExpenseStatus] = useState<
    'unknown' | 'loading' | 'found' | 'missing' | 'none'
  >('unknown')
  const [linkedExpenseLabel, setLinkedExpenseLabel] = useState('')
  const [pendingKindChange, setPendingKindChange] = useState<{
    nextType: ExpenseRegistrationType
  } | null>(null)
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const smallAssets = useMemo(
    () =>
      fixedAssets
        .filter((asset) => !asset.isDeleted && asset.assetKind === 'small')
        .sort((left, right) => right.purchaseDate.localeCompare(left.purchaseDate, 'ja')),
    [fixedAssets],
  )

  const visibleAssets = useMemo(
    () =>
      fixedAssets
        .filter((asset) => !asset.isDeleted && asset.assetKind === 'fixed')
        .map((asset) => {
          const preview = recalculateFixedAssetPreview(buildFixedAssetEditDraft(asset), asOfYearMonth)
          return {
            ...asset,
            monthlyDepreciationYen: preview.monthlyDepreciationYen,
            remainingBookValue: preview.remainingBookValue,
            status: preview.status,
          }
        }),
    [asOfYearMonth, fixedAssets],
  )

  const filteredAssets = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const rows = normalizedQuery
      ? visibleAssets.filter(
          (asset) =>
            asset.assetName.toLowerCase().includes(normalizedQuery) ||
            asset.assetCategory.toLowerCase().includes(normalizedQuery) ||
            asset.notes?.toLowerCase().includes(normalizedQuery),
        )
      : visibleAssets

    return [...rows].sort((left, right) => {
      const leftValue = left[sortKey]
      const rightValue = right[sortKey]
      const direction = sortDirection === 'asc' ? 1 : -1

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction
      }

      return String(leftValue).localeCompare(String(rightValue), 'ja') * direction
    })
  }, [searchQuery, sortDirection, sortKey, visibleAssets])

  const preview = useMemo(
    () => recalculateFixedAssetPreview(draft, asOfYearMonth),
    [asOfYearMonth, draft],
  )

  const originalPreview = useMemo(
    () => (originalAsset ? recalculateFixedAssetPreview(buildFixedAssetEditDraft(originalAsset), asOfYearMonth) : null),
    [asOfYearMonth, originalAsset],
  )

  useEffect(() => {
    let cancelled = false
    const loadLink = async () => {
      if (!originalAsset) {
        setLinkedExpenseStatus('none')
        setLinkedExpenseLabel('')
        return
      }
      const expenseId = originalAsset.expenseId?.trim()
      if (!expenseId) {
        setLinkedExpenseStatus('none')
        setLinkedExpenseLabel('紐付け経費なし')
        return
      }
      setLinkedExpenseStatus('loading')
      try {
        const linked = await fetchAccountingExpenseLinkById(expenseId)
        if (cancelled) return
        if (!linked || !linked.exists) {
          setLinkedExpenseStatus('missing')
          setLinkedExpenseLabel(`紐付け経費が見つかりません（ID: ${expenseId}）`)
          return
        }
        setLinkedExpenseStatus('found')
        setLinkedExpenseLabel(
          `${linked.description || '(内容なし)'} / ${linked.taxIncludedAmount.toLocaleString('ja-JP')}円`,
        )
      } catch {
        if (cancelled) return
        setLinkedExpenseStatus('missing')
        setLinkedExpenseLabel('紐付け経費が見つかりません')
      }
    }
    void loadLink()
    return () => {
      cancelled = true
    }
  }, [originalAsset])

  const openEdit = (asset: StoredAccountingFixedAsset) => {
    setEditingAssetId(asset.id)
    setOriginalAsset(asset)
    setDraft(buildFixedAssetEditDraft(asset))
    setPendingKindChange(null)
    setShowSaveConfirm(false)
    onError('')
    if (asset.status === 'fully_depreciated' || asset.remainingBookValue === 0) {
      onStatus('償却済み（または残高0）の資産を編集しています。保存内容を確認してください。')
    }
  }

  const closeEdit = () => {
    setEditingAssetId('')
    setOriginalAsset(null)
    setDraft(emptyDraft())
    setPendingKindChange(null)
    setShowSaveConfirm(false)
  }

  const updateDraft = (patch: Partial<FixedAssetEditDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.registrationType === 'small') {
        next.assetKind = 'small'
      }
      if (patch.registrationType === 'fixed') {
        next.assetKind = 'fixed'
      }
      if (patch.assetCategory === '車両' && !next.vehicleType) {
        next.vehicleType = '普通車'
      }
      return next
    })
  }

  const requestRegistrationTypeChange = (nextType: ExpenseRegistrationType) => {
    if (nextType === draft.registrationType) return
    setPendingKindChange({ nextType })
  }

  const confirmRegistrationTypeChange = () => {
    if (!pendingKindChange) return
    updateDraft({ registrationType: pendingKindChange.nextType })
    setPendingKindChange(null)
  }

  const kindImpact =
    pendingKindChange && originalPreview
      ? buildKindChangeImpact({
          before: draft.registrationType,
          after: pendingKindChange.nextType,
          beforePreview: preview,
          afterPreview: recalculateFixedAssetPreview(
            { ...draft, registrationType: pendingKindChange.nextType },
            asOfYearMonth,
          ),
        })
      : null

  const beginSave = () => {
    if (!originalAsset) return
    const validationError = validateFixedAssetEditDraft(draft, preview)
    if (validationError) {
      onError(validationError)
      return
    }
    setShowSaveConfirm(true)
  }

  const handleSaveEdit = async () => {
    if (!originalAsset || isSaving) return
    const validationError = validateFixedAssetEditDraft(draft, preview)
    if (validationError) {
      onError(validationError)
      setShowSaveConfirm(false)
      return
    }

    setIsSaving(true)
    onError('')

    try {
      const changed = materialFieldsChanged(originalAsset, draft)
      const needsLinkedExpenseSync =
        Boolean(originalAsset.expenseId) &&
        (changed.purchaseDate ||
          changed.assetName ||
          changed.acquisitionCost ||
          changed.registrationTypeChanged)

      if (needsLinkedExpenseSync && linkedExpenseStatus === 'missing') {
        throw new Error(
          '紐付け経費が見つかりません。購入日・資産名・取得価額・資産区分の変更は保存できません。',
        )
      }

      if (draft.registrationType === 'normal') {
        if (!originalAsset.expenseId || linkedExpenseStatus !== 'found') {
          throw new Error(
            '通常経費へ変更するには紐付け経費が必要です。紐付け経費が見つからないため保存を中止しました。',
          )
        }

        await updateFixedAssetWithOptionalLinkedExpense({
          assetId: originalAsset.id,
          linkedExpenseId: originalAsset.expenseId,
          requireLinkedExpense: true,
          assetPatch: {
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: staffId,
            notes: draft.notes,
            updatedBy: staffId,
          },
          expensePatch: {
            plTreatment: 'expense',
            taxIncludedAmount: Number(draft.acquisitionCost),
            receiptDate: draft.purchaseDate,
            description: draft.assetName.trim(),
          },
        })
        onStatus('通常経費へ変更し、固定資産台帳から除外しました。')
      } else {
        const nextKind = draft.registrationType === 'small' ? 'small' : 'fixed'
        const assetPatch = {
          purchaseDate: draft.purchaseDate,
          assetName: draft.assetName.trim(),
          assetCategory: draft.assetCategory,
          acquisitionCost: Number(draft.acquisitionCost),
          useStartDate: draft.useStartDate,
          appliedUsefulLifeYears:
            nextKind === 'fixed' ? Number(draft.appliedUsefulLifeYears) : 1,
          usefulLifeChangeReason: draft.usefulLifeChangeReason.trim() || undefined,
          notes: draft.notes,
          assetKind: nextKind as 'small' | 'fixed',
          condition: draft.condition,
          vehicleType: draft.assetCategory === '車両' ? draft.vehicleType || undefined : undefined,
          firstRegistrationYearMonth:
            draft.assetCategory === '車両' && draft.condition === '中古'
              ? draft.firstRegistrationYearMonth || undefined
              : undefined,
          standardUsefulLifeYears: preview.standardUsefulLifeYears,
          monthlyDepreciationYen: preview.monthlyDepreciationYen,
          depreciationStartYearMonth: preview.depreciationStartYearMonth,
          depreciationEndYearMonth: preview.depreciationEndYearMonth,
          remainingBookValue: preview.remainingBookValue,
          status: preview.status,
          updatedBy: staffId,
        }

        const expensePatch = needsLinkedExpenseSync
          ? {
              receiptDate: draft.purchaseDate,
              description: draft.assetName.trim(),
              taxIncludedAmount: Number(draft.acquisitionCost),
              plTreatment: (nextKind === 'fixed' ? 'excluded' : 'expense') as 'excluded' | 'expense',
            }
          : undefined

        await updateFixedAssetWithOptionalLinkedExpense({
          assetId: originalAsset.id,
          linkedExpenseId: originalAsset.expenseId,
          requireLinkedExpense: needsLinkedExpenseSync,
          assetPatch,
          expensePatch,
        })
        onStatus('固定資産を更新しました。')
      }

      closeEdit()
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定資産の更新に失敗しました。')
    } finally {
      setIsSaving(false)
      setShowSaveConfirm(false)
    }
  }

  const handleDelete = async (assetId: string) => {
    const confirmed = window.confirm('この資産を削除しますか？')
    if (!confirmed) {
      return
    }

    try {
      await softDeleteAccountingFixedAsset({ assetId, deletedBy: staffId })
      onStatus('資産を削除しました。')
      if (editingAssetId === assetId) {
        closeEdit()
      }
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '資産の削除に失敗しました。')
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  const renderEditForm = (asset: StoredAccountingFixedAsset) => (
    <div className="accounting-fixed-asset-edit" aria-label="固定資産編集">
      <p className="accounting-note">
        紐付け経費:{' '}
        {linkedExpenseStatus === 'loading'
          ? '確認中…'
          : linkedExpenseStatus === 'missing'
            ? linkedExpenseLabel
            : linkedExpenseStatus === 'none'
              ? 'なし'
              : linkedExpenseLabel}
      </p>

      <label>
        1. 購入日
        <input
          type="date"
          value={draft.purchaseDate}
          onChange={(event) => updateDraft({ purchaseDate: event.target.value })}
        />
      </label>
      <label>
        2. 資産名
        <input
          type="text"
          value={draft.assetName}
          onChange={(event) => updateDraft({ assetName: event.target.value })}
        />
      </label>
      <label>
        3. 資産区分（登録タイプ）
        <select
          value={draft.registrationType}
          onChange={(event) =>
            requestRegistrationTypeChange(event.target.value as ExpenseRegistrationType)
          }
        >
          {EXPENSE_REGISTRATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {EXPENSE_REGISTRATION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        資産区分（品目）
        <select
          value={draft.assetCategory}
          onChange={(event) => updateDraft({ assetCategory: event.target.value })}
        >
          <option value="">選択してください</option>
          {categoryOptionsForKind(draft.registrationType === 'small' ? 'small' : 'fixed').map(
            (category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        4. 取得価額
        <input
          type="number"
          min={1}
          step={1}
          value={draft.acquisitionCost || ''}
          onChange={(event) =>
            updateDraft({ acquisitionCost: Number(event.target.value.replace(/[^\d.-]/g, '')) || 0 })
          }
        />
      </label>
      <label>
        5. 使用開始日
        <input
          type="date"
          value={draft.useStartDate}
          onChange={(event) => updateDraft({ useStartDate: event.target.value })}
        />
      </label>
      <label>
        6. 償却開始月（自動）
        <input type="month" value={preview.depreciationStartYearMonth} readOnly />
      </label>
      {draft.registrationType === 'fixed' ? (
        <label>
          7. 耐用年数
          <input
            type="number"
            min={1}
            value={draft.appliedUsefulLifeYears || ''}
            onChange={(event) =>
              updateDraft({
                appliedUsefulLifeYears: Number(event.target.value.replace(/[^\d]/g, '')) || 0,
              })
            }
          />
        </label>
      ) : (
        <p className="accounting-note">7. 耐用年数：少額資産／通常経費では月次償却しません。</p>
      )}

      {draft.assetCategory === '車両' ? (
        <div className="accounting-fixed-asset-vehicle-fields" aria-label="車両固有項目">
          <p className="accounting-note">8. 車両固有項目</p>
          <label>
            車両種別
            <select
              value={draft.vehicleType}
              onChange={(event) =>
                updateDraft({ vehicleType: event.target.value as FixedAssetEditDraft['vehicleType'] })
              }
            >
              <option value="">未選択</option>
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            新品／中古
            <select
              value={draft.condition}
              onChange={(event) =>
                updateDraft({ condition: event.target.value as FixedAssetEditDraft['condition'] })
              }
            >
              {ASSET_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </label>
          {draft.condition === '中古' ? (
            <label>
              初度登録年月
              <input
                type="month"
                value={draft.firstRegistrationYearMonth}
                onChange={(event) => updateDraft({ firstRegistrationYearMonth: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <p className="accounting-note">8. 車両固有項目：対象外</p>
      )}

      {draft.registrationType === 'fixed' &&
      preview.standardUsefulLifeYears !== draft.appliedUsefulLifeYears ? (
        <label>
          9. 変更理由
          <textarea
            rows={2}
            value={draft.usefulLifeChangeReason}
            onChange={(event) => updateDraft({ usefulLifeChangeReason: event.target.value })}
          />
        </label>
      ) : (
        <p className="accounting-note">9. 変更理由：標準耐用年数のままです。</p>
      )}

      <label>
        10. 備考
        <textarea rows={2} value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} />
      </label>

      <div className="accounting-fixed-asset-recalc" aria-label="再計算結果">
        <p className="accounting-note">11. 再計算結果</p>
        <dl>
          <div>
            <dt>月額償却費</dt>
            <dd>{formatFareYen(preview.monthlyDepreciationYen)}円</dd>
          </div>
          <div>
            <dt>償却終了予定月</dt>
            <dd>{preview.depreciationEndYearMonth || '―'}</dd>
          </div>
          <div>
            <dt>償却済み累計額</dt>
            <dd>{formatFareYen(preview.cumulativeDepreciationYen)}円</dd>
          </div>
          <div>
            <dt>未償却残高</dt>
            <dd>{formatFareYen(preview.remainingBookValue)}円</dd>
          </div>
          <div>
            <dt>状態</dt>
            <dd>{FIXED_ASSET_STATUS_LABELS[preview.status]}</dd>
          </div>
          <div>
            <dt>PLへの影響（当月償却 / 一括）</dt>
            <dd>
              {draft.registrationType === 'fixed'
                ? `毎月 ${formatFareYen(preview.monthlyDepreciationYen)}円`
                : `取得月に ${formatFareYen(draft.acquisitionCost)}円`}
            </dd>
          </div>
        </dl>
        {originalPreview &&
        (originalAsset?.acquisitionCost !== draft.acquisitionCost ||
          originalAsset.appliedUsefulLifeYears !== draft.appliedUsefulLifeYears ||
          originalAsset.useStartDate !== draft.useStartDate) ? (
          <p className="accounting-note">
            変更前: 取得 {formatFareYen(originalAsset?.acquisitionCost ?? 0)}円 / 耐用{' '}
            {originalAsset?.appliedUsefulLifeYears ?? '-'}年 / 使用開始 {originalAsset?.useStartDate} /
            月額 {formatFareYen(originalPreview.monthlyDepreciationYen)}円
            <br />
            変更後: 取得 {formatFareYen(draft.acquisitionCost)}円 / 耐用 {draft.appliedUsefulLifeYears}年 /
            使用開始 {draft.useStartDate} / 月額 {formatFareYen(preview.monthlyDepreciationYen)}円
          </p>
        ) : null}
      </div>

      <div className="accounting-form-actions">
        <button className="primary-action" type="button" disabled={isSaving} onClick={beginSave}>
          保存
        </button>
        <button className="secondary-action" type="button" disabled={isSaving} onClick={closeEdit}>
          キャンセル
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={isSaving}
          onClick={() => void handleDelete(asset.id)}
        >
          削除
        </button>
      </div>

      {pendingKindChange && kindImpact ? (
        <div className="accounting-fixed-asset-dialog" role="dialog" aria-label="資産区分変更の確認">
          <h4>資産区分の変更確認</h4>
          <ul>
            <li>
              変更前: {kindImpact.beforeKindLabel}
            </li>
            <li>
              変更後: {kindImpact.afterKindLabel}
            </li>
            <li>
              変更前のPL反映額: {formatFareYen(kindImpact.beforePlAmountYen)}円
            </li>
            <li>
              変更後のPL反映予定額: {formatFareYen(kindImpact.afterPlAmountYen)}円
            </li>
            <li>
              減価償却費: {formatFareYen(kindImpact.beforeMonthlyDepreciationYen)}円 →{' '}
              {formatFareYen(kindImpact.afterMonthlyDepreciationYen)}円 / 月
            </li>
            <li>{kindImpact.summary}</li>
            <li>保存後に再計算されます。</li>
          </ul>
          <div className="accounting-form-actions">
            <button className="primary-action" type="button" onClick={confirmRegistrationTypeChange}>
              区分変更を反映
            </button>
            <button className="secondary-action" type="button" onClick={() => setPendingKindChange(null)}>
              戻る
            </button>
          </div>
        </div>
      ) : null}

      {showSaveConfirm ? (
        <div className="accounting-fixed-asset-dialog" role="dialog" aria-label="保存確認">
          <h4>保存内容の確認</h4>
          <ul>
            <li>
              購入日: {originalAsset?.purchaseDate} → {draft.purchaseDate}
            </li>
            <li>
              資産名: {originalAsset?.assetName} → {draft.assetName}
            </li>
            <li>
              取得価額: {formatFareYen(originalAsset?.acquisitionCost ?? 0)}円 →{' '}
              {formatFareYen(draft.acquisitionCost)}円
            </li>
            <li>
              使用開始日: {originalAsset?.useStartDate} → {draft.useStartDate}
            </li>
            <li>
              耐用年数: {originalAsset?.appliedUsefulLifeYears}年 → {draft.appliedUsefulLifeYears}年
            </li>
            <li>
              月額償却費: {formatFareYen(originalPreview?.monthlyDepreciationYen ?? 0)}円 →{' '}
              {formatFareYen(preview.monthlyDepreciationYen)}円
            </li>
            <li>
              償却終了予定月: {originalPreview?.depreciationEndYearMonth} → {preview.depreciationEndYearMonth}
            </li>
            <li>
              未償却残高: {formatFareYen(originalPreview?.remainingBookValue ?? 0)}円 →{' '}
              {formatFareYen(preview.remainingBookValue)}円
            </li>
            <li>償却開始月（自動）: {toYearMonth(draft.useStartDate)}</li>
          </ul>
          <div className="accounting-form-actions">
            <button
              className="primary-action"
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveEdit()}
            >
              {isSaving ? '保存中…' : '確定して保存'}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={isSaving}
              onClick={() => setShowSaveConfirm(false)}
            >
              戻る
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )

  return (
    <section className="accounting-panel" aria-label="固定資産台帳">
      <h2>固定資産台帳</h2>
      <p className="accounting-note">
        登録済み資産の確認・編集画面です。新規登録は経費登録から行い、ここでは管理のみ行います。
      </p>

      <div className="accounting-fixed-asset-toolbar">
        <label>
          検索
          <input
            type="search"
            placeholder="資産名・区分・備考"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
      </div>

      <section className="accounting-small-asset-ledger" aria-label="少額資産一覧">
        <h3>少額資産</h3>
        <p className="accounting-note">
          少額資産として登録された資産です。減価償却対象ではなく、取得月の経費としてPLに一括計上されます。
        </p>
        {smallAssets.length > 0 ? (
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>購入日</th>
                  <th>資産名</th>
                  <th>資産区分</th>
                  <th>取得価額</th>
                  <th>PL反映月</th>
                  <th>備考</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {smallAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.purchaseDate}</td>
                    <td>{asset.assetName}</td>
                    <td>少額資産 / {asset.assetCategory}</td>
                    <td>{formatFareYen(asset.acquisitionCost)}円</td>
                    <td>{asset.depreciationStartYearMonth}</td>
                    <td>{asset.notes || '―'}</td>
                    <td>
                      {editingAssetId === asset.id ? (
                        renderEditForm(asset)
                      ) : (
                        <>
                          <button className="secondary-action" type="button" onClick={() => openEdit(asset)}>
                            編集
                          </button>
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => void handleDelete(asset.id)}
                          >
                            削除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="accounting-note">少額資産はありません。</p>
        )}
      </section>

      <h3>固定資産</h3>

      <div className="accounting-fixed-asset-cards">
        {filteredAssets.map((asset) => (
          <article key={asset.id} className="accounting-fixed-asset-card">
            <header>
              <strong>{asset.assetName}</strong>
              <span>{FIXED_ASSET_STATUS_LABELS[asset.status]}</span>
            </header>
            <dl>
              <div>
                <dt>購入日</dt>
                <dd>{asset.purchaseDate}</dd>
              </div>
              <div>
                <dt>資産区分</dt>
                <dd>{asset.assetCategory}</dd>
              </div>
              <div>
                <dt>取得価額</dt>
                <dd>{formatFareYen(asset.acquisitionCost)}円</dd>
              </div>
              <div>
                <dt>耐用年数</dt>
                <dd>{asset.appliedUsefulLifeYears}年</dd>
              </div>
              <div>
                <dt>月額償却費</dt>
                <dd>{formatFareYen(asset.monthlyDepreciationYen)}円</dd>
              </div>
              <div>
                <dt>未償却残高</dt>
                <dd>{formatFareYen(asset.remainingBookValue)}円</dd>
              </div>
              <div>
                <dt>備考</dt>
                <dd>{asset.notes || '―'}</dd>
              </div>
            </dl>
            {editingAssetId === asset.id ? (
              renderEditForm(asset)
            ) : (
              <div className="accounting-form-actions">
                <button className="secondary-action" type="button" onClick={() => openEdit(asset)}>
                  編集
                </button>
                <button className="secondary-action" type="button" onClick={() => void handleDelete(asset.id)}>
                  削除
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="accounting-table-wrap accounting-table-wrap--desktop">
        <table className="accounting-table accounting-table--desktop">
          <thead>
            <tr>
              {(
                [
                  ['purchaseDate', '購入日'],
                  ['assetName', '資産名'],
                  ['assetCategory', '資産区分'],
                  ['acquisitionCost', '取得価額'],
                  ['appliedUsefulLifeYears', '耐用年数'],
                  ['monthlyDepreciationYen', '月額償却費'],
                  ['remainingBookValue', '未償却残高'],
                  ['status', '状態'],
                ] as const
              ).map(([key, label]) => (
                <th key={key}>
                  <button type="button" className="accounting-sort-button" onClick={() => toggleSort(key)}>
                    {label}
                    {sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th>備考</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.length > 0 ? (
              filteredAssets.map((asset) => (
                <tr key={`desktop-${asset.id}`}>
                  <td>{asset.purchaseDate}</td>
                  <td>{asset.assetName}</td>
                  <td>{asset.assetCategory}</td>
                  <td>{formatFareYen(asset.acquisitionCost)}円</td>
                  <td>{asset.appliedUsefulLifeYears}年</td>
                  <td>{formatFareYen(asset.monthlyDepreciationYen)}円</td>
                  <td>{formatFareYen(asset.remainingBookValue)}円</td>
                  <td>{FIXED_ASSET_STATUS_LABELS[asset.status]}</td>
                  <td>{asset.notes || '―'}</td>
                  <td>
                    <button className="secondary-action" type="button" onClick={() => openEdit(asset)}>
                      編集
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleDelete(asset.id)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10}>固定資産はありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
