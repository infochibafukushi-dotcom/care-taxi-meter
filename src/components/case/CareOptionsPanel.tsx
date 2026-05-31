import type { ChangeEvent } from 'react'
import type { CareOptionMasterItem } from '../../services/fare'
import type { SelectedCareOption } from '../../types/case'
import { formatFareYen } from '../../services/fare'

type CareOptionsPanelProps = {
  careOptionMaster: CareOptionMasterItem[]
  selectedCareOptions: SelectedCareOption[]
  onAdd: (masterItem: CareOptionMasterItem) => void
  onAmountChange: (id: string, amountYen: number) => void
  onRemove: (id: string) => void
}

export function CareOptionsPanel({
  careOptionMaster,
  selectedCareOptions,
  onAdd,
  onAmountChange,
  onRemove,
}: CareOptionsPanelProps) {
  const handleSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const masterItem = careOptionMaster.find(
      (item) => item.id === event.target.value,
    )

    if (masterItem) {
      onAdd(masterItem)
      event.target.value = ''
    }
  }

  return (
    <section className="input-panel" aria-labelledby="care-options-title">
      <div className="input-panel__header">
        <h2 id="care-options-title">介助料金</h2>
        <span>{selectedCareOptions.length}件</span>
      </div>
      <label className="field-label">
        介助メニューを追加
        <select defaultValue="" onChange={handleSelect}>
          <option value="" disabled>
            選択してください
          </option>
          {careOptionMaster.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}（{formatFareYen(item.amount)}円）
            </option>
          ))}
        </select>
      </label>
      <div className="line-item-list">
        {selectedCareOptions.length === 0 ? (
          <p className="empty-note">介助料金は未追加です。</p>
        ) : null}
        {selectedCareOptions.map((option) => (
          <div className="editable-line-item" key={option.id}>
            <span>{option.name}</span>
            <label>
              金額
              <input
                inputMode="numeric"
                min="0"
                type="number"
                value={option.amountYen}
                onChange={(event) =>
                  onAmountChange(option.id, Number(event.target.value))
                }
              />
            </label>
            <button type="button" onClick={() => onRemove(option.id)}>
              削除
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
