import { useMemo, useState } from 'react'
import {
  areRequiredAssistStepsComplete,
  assistItemsFromSelectionState,
  buildAssistFeeLineItems,
  computeAssistFeeBreakdown,
  selectionStateFromAssistItems,
} from '../../services/preFixedAssistSelection'
import type { AssistItem } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PreFixedAssistSelectionState } from '../../types/preFixedAssistSelection'
import { PreFixedAssistStepFlow } from './PreFixedAssistStepFlow'

const selectionFingerprint = (items: AssistItem[]) =>
  items
    .filter((item) => item.enabled)
    .map((item) => `${item.id}:${item.amount}`)
    .sort()
    .join('|')

type PreFixedAssistEditDialogProps = {
  initialItems: AssistItem[]
  isRoundTrip: boolean
  /** assist=介助STEP全体 / equipment=機材（移動方法）のみ */
  mode?: 'assist' | 'equipment'
  onClose: () => void
  onApply: (payload: {
    selection: PreFixedAssistSelectionState
    items: AssistItem[]
    serviceFees: Array<{ key: string; label: string; amount: number }>
    assistFeesYen: number
  }) => void
}

export function PreFixedAssistEditDialog({
  initialItems,
  isRoundTrip,
  mode = 'assist',
  onClose,
  onApply,
}: PreFixedAssistEditDialogProps) {
  // savedSelection: 開いた時点の保存値。キャンセル時は本体へ反映しない。
  const initialFingerprint = selectionFingerprint(initialItems)
  const savedSelection = useMemo(
    () => selectionStateFromAssistItems(initialItems),
    // fingerprint で内容が変わったときだけ再計算（開いた瞬間の選択を固定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialFingerprint],
  )
  const [draftSelection, setDraftSelection] = useState<PreFixedAssistSelectionState>(savedSelection)
  const [draftSourceKey, setDraftSourceKey] = useState(initialFingerprint)
  if (draftSourceKey !== initialFingerprint) {
    setDraftSourceKey(initialFingerprint)
    setDraftSelection(savedSelection)
  }
  const [error, setError] = useState('')

  const assistFeesYen = useMemo(
    () => computeAssistFeeBreakdown(draftSelection).serviceTotal,
    [draftSelection],
  )

  const handleApply = () => {
    if (mode === 'assist' && !areRequiredAssistStepsComplete(draftSelection)) {
      setError('移動方法・介助内容・階段介助を選択してください。')
      return
    }
    if (mode === 'equipment' && !draftSelection.mobilityId) {
      setError('機材を選択してください。')
      return
    }
    setError('')
    // 機材のみ変更時も介助・階段の保存値は維持した draft を保存する
    const items = assistItemsFromSelectionState(draftSelection, initialItems)
    const serviceFees = buildAssistFeeLineItems(draftSelection)
      .filter((line) => line.amount > 0 || Boolean(line.label))
      .map((line) => {
        const matched = items.find((item) => item.enabled && item.name === line.label)
        return {
          key: matched?.id || line.label,
          label: line.label,
          amount: line.amount,
        }
      })
    onApply({
      selection: draftSelection,
      items,
      serviceFees,
      assistFeesYen,
    })
  }

  const title = mode === 'equipment' ? '機材編集' : '介助編集'

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="pre-fixed-assist-edit-title"
        aria-modal="true"
        className="settings-modal r9-operation-modal pre-fixed-assist-edit-dialog pre-fixed-meter-assist-editor"
        role="dialog"
      >
        <header className="settings-header">
          <div>
            <span>ASSIST</span>
            <h2 id="pre-fixed-assist-edit-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <p className="pre-fixed-assist-edit-dialog__note">
          事前確定時の選択を初期表示しています。反映するまで合計金額は変わりません。
        </p>

        <PreFixedAssistStepFlow
          value={draftSelection}
          onChange={(next) => {
            setError('')
            setDraftSelection(next)
          }}
          isRoundTrip={isRoundTrip}
          error={error}
          variant={mode === 'equipment' ? 'equipment-only' : 'meter-editor'}
        />

        <footer className="pre-fixed-assist-edit-dialog__footer">
          <strong>介助・サービス合計 {formatFareYen(assistFeesYen)}円</strong>
          <div>
            <button type="button" className="secondary-action" onClick={onClose}>
              キャンセル
            </button>
            <button type="button" className="r9-flow-primary" onClick={handleApply}>
              反映する
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
