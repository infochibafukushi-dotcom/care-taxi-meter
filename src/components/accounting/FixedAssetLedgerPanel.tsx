import { useMemo, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import {
  softDeleteAccountingFixedAsset,
  updateAccountingFixedAsset,
} from '../../services/accountingFixedAssets'
import {
  calculateDepreciationSchedule,
  calculateRemainingBookValue,
  deriveFixedAssetStatus,
} from '../../utils/accountingDepreciation'
import { getCurrentYearMonthInJapan } from '../../utils/accountingPl'
import {
  FIXED_ASSET_STATUS_LABELS,
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
  const [editNotes, setEditNotes] = useState('')
  const [editAppliedUsefulLifeYears, setEditAppliedUsefulLifeYears] = useState(0)
  const [editUsefulLifeChangeReason, setEditUsefulLifeChangeReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const visibleAssets = useMemo(
    () =>
      fixedAssets
        .filter((asset) => !asset.isDeleted && asset.assetKind === 'fixed')
        .map((asset) => ({
          ...asset,
          remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
          status: deriveFixedAssetStatus(
            {
              ...asset,
              remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
            },
            asOfYearMonth,
          ),
        })),
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

  const openEdit = (asset: StoredAccountingFixedAsset) => {
    setEditingAssetId(asset.id)
    setEditNotes(asset.notes ?? '')
    setEditAppliedUsefulLifeYears(asset.appliedUsefulLifeYears)
    setEditUsefulLifeChangeReason(asset.usefulLifeChangeReason ?? '')
  }

  const handleSaveEdit = async (asset: StoredAccountingFixedAsset) => {
    if (
      editAppliedUsefulLifeYears !== asset.standardUsefulLifeYears &&
      !editUsefulLifeChangeReason.trim()
    ) {
      onError('耐用年数を変更した場合は変更理由を入力してください。')
      return
    }

    setIsSaving(true)
    onError('')

    try {
      const schedule = calculateDepreciationSchedule({
        acquisitionCost: asset.acquisitionCost,
        usefulLifeYears: editAppliedUsefulLifeYears,
        useStartDate: asset.useStartDate,
      })

      await updateAccountingFixedAsset(asset.id, {
        notes: editNotes,
        appliedUsefulLifeYears: editAppliedUsefulLifeYears,
        usefulLifeChangeReason: editUsefulLifeChangeReason,
        monthlyDepreciationYen: schedule.monthlyDepreciationYen,
        depreciationStartYearMonth: schedule.depreciationStartYearMonth,
        depreciationEndYearMonth: schedule.depreciationEndYearMonth,
        remainingBookValue: calculateRemainingBookValue(
          {
            ...asset,
            appliedUsefulLifeYears: editAppliedUsefulLifeYears,
            monthlyDepreciationYen: schedule.monthlyDepreciationYen,
            depreciationStartYearMonth: schedule.depreciationStartYearMonth,
            depreciationEndYearMonth: schedule.depreciationEndYearMonth,
          },
          asOfYearMonth,
        ),
        updatedBy: staffId,
      })

      setEditingAssetId('')
      onStatus('固定資産を更新しました。')
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定資産の更新に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (assetId: string) => {
    const confirmed = window.confirm('この固定資産を削除しますか？')
    if (!confirmed) {
      return
    }

    try {
      await softDeleteAccountingFixedAsset({ assetId, deletedBy: staffId })
      onStatus('固定資産を削除しました。')
      await onReload()
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定資産の削除に失敗しました。')
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
              <div className="accounting-fixed-asset-edit">
                <label>
                  適用耐用年数
                  <input
                    type="number"
                    min={1}
                    value={editAppliedUsefulLifeYears}
                    onChange={(event) => setEditAppliedUsefulLifeYears(Number(event.target.value) || 0)}
                  />
                </label>
                {editAppliedUsefulLifeYears !== asset.standardUsefulLifeYears ? (
                  <label>
                    変更理由
                    <textarea
                      rows={2}
                      value={editUsefulLifeChangeReason}
                      onChange={(event) => setEditUsefulLifeChangeReason(event.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  備考
                  <textarea rows={2} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} />
                </label>
                <div className="accounting-form-actions">
                  <button
                    className="primary-action"
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleSaveEdit(asset)}
                  >
                    保存
                  </button>
                  <button className="secondary-action" type="button" onClick={() => setEditingAssetId('')}>
                    キャンセル
                  </button>
                </div>
              </div>
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
                <tr key={asset.id}>
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
                    <button className="secondary-action" type="button" onClick={() => void handleDelete(asset.id)}>
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
