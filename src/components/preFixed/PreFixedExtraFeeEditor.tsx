import { useMemo, useState } from 'react'
import {
  EXTRA_SERVICE_CATALOG,
  normalizeExtraFeeSelectedIds,
  ROUND_TRIP_ADDON_CATALOG,
} from '../../services/preFixedAssistSelection'
import { formatFareYen } from '../../services/fare'
import type { DispatchMenuItem, SpecialVehicleMenuItem } from '../../services/fare'
import '../../styles/preFixedMeterDashboard.css'

export type PreFixedExtraFeeOption = {
  id: string
  label: string
  amountYen: number
  group: 'dispatch' | 'special' | 'extra' | 'planned'
}

type PreFixedExtraFeeEditorProps = {
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  selectedIds: Set<string>
  onClose: () => void
  onApply: (selected: PreFixedExtraFeeOption[]) => void
}

const buildOptions = (
  dispatchMenuItems: DispatchMenuItem[],
  specialVehicleMenuItems: SpecialVehicleMenuItem[],
): PreFixedExtraFeeOption[] => {
  const options: PreFixedExtraFeeOption[] = []

  for (const item of dispatchMenuItems.filter((entry) => entry.enabled)) {
    options.push({
      id: item.id,
      label: item.name,
      amountYen: Math.max(0, Math.round(item.amount)),
      group: 'dispatch',
    })
  }

  for (const item of specialVehicleMenuItems.filter((entry) => entry.enabled)) {
    options.push({
      id: item.id,
      label: item.name,
      amountYen: Math.max(0, Math.round(item.amount)),
      group: 'special',
    })
  }

  for (const item of EXTRA_SERVICE_CATALOG) {
    if (options.some((entry) => entry.id === item.id)) {
      continue
    }
    options.push({
      id: item.id,
      label: item.label,
      amountYen: Math.max(0, Math.round(item.amount)),
      group: 'extra',
    })
  }

  for (const item of ROUND_TRIP_ADDON_CATALOG) {
    options.push({
      id: item.id === 'waiting' ? 'waitingPlanned' : 'escortPlanned',
      label: item.label,
      amountYen: Math.max(0, Math.round(item.amount)),
      group: 'planned',
    })
  }

  return options
}

export function PreFixedExtraFeeEditor({
  dispatchMenuItems,
  specialVehicleMenuItems,
  selectedIds,
  onClose,
  onApply,
}: PreFixedExtraFeeEditorProps) {
  const options = useMemo(
    () => buildOptions(dispatchMenuItems, specialVehicleMenuItems),
    [dispatchMenuItems, specialVehicleMenuItems],
  )
  // savedSelection → draftSelection。キャンセルで破棄。
  const savedKey = Array.from(normalizeExtraFeeSelectedIds(selectedIds)).sort().join('|')
  const savedSelection = useMemo(
    () => normalizeExtraFeeSelectedIds(selectedIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedKey],
  )
  const [draftSelection, setDraftSelection] = useState<Set<string>>(
    () => new Set(savedSelection),
  )
  const [draftSourceKey, setDraftSourceKey] = useState(savedKey)
  if (draftSourceKey !== savedKey) {
    setDraftSourceKey(savedKey)
    setDraftSelection(new Set(savedSelection))
  }

  const totalYen = options
    .filter((option) => draftSelection.has(option.id) && option.amountYen > 0)
    .reduce((sum, option) => sum + option.amountYen, 0)

  const toggle = (id: string) => {
    setDraftSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="pre-fixed-extra-fee-title"
        aria-modal="true"
        className="settings-modal r9-operation-modal pre-fixed-extra-fee-editor pre-fixed-meter-extra-editor"
        role="dialog"
      >
        <header className="settings-header">
          <div>
            <span>BASIC</span>
            <h2 id="pre-fixed-extra-fee-title">基本（追加料金）編集</h2>
          </div>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <p className="pre-fixed-extra-fee-editor__note">
          事前確定時の選択を初期表示しています。反映するまで合計金額は変わりません。
        </p>

        <div className="pre-fixed-extra-fee-editor__list">
          {options.map((option) => {
            const checked = draftSelection.has(option.id)
            return (
              <button
                key={option.id}
                type="button"
                className={`pre-fixed-extra-fee-editor__item pre-fixed-meter-option-card${checked ? ' is-selected' : ''}`}
                aria-pressed={checked}
                onClick={() => toggle(option.id)}
              >
                <span className="pre-fixed-extra-fee-editor__label">
                  {checked ? '✓ ' : ''}
                  {option.label}
                  {checked ? (
                    <em className="pre-fixed-meter-option-card__badge">選択中</em>
                  ) : null}
                </span>
                <strong>{formatFareYen(option.amountYen)}円</strong>
              </button>
            )
          })}
        </div>

        <footer className="pre-fixed-extra-fee-editor__footer">
          <strong>選択合計 {formatFareYen(totalYen)}円</strong>
          <div>
            <button type="button" className="secondary-action" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              className="r9-flow-primary"
              onClick={() =>
                onApply(
                  options.filter(
                    (option) => draftSelection.has(option.id) && option.amountYen > 0,
                  ),
                )
              }
            >
              反映する
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
