import {
  applyMeterEditChoice,
  applyRoundTripAddon,
  applyStepChoice,
  areRequiredAssistStepsComplete,
  ASSIST_STEP_TITLES,
  ASSISTANCE_CATALOG,
  computeAssistFeeBreakdown,
  EXTRA_SERVICE_CATALOG,
  getAssistanceOptions,
  getMobilityAssistanceRule,
  getNaturalActiveAssistStep,
  getStepSummaryLabel,
  MOBILITY_CATALOG,
  openStepForEdit,
  ROUND_TRIP_ADDON_CATALOG,
  STAIR_CATALOG,
  toggleExtraChoice,
} from '../../services/preFixedAssistSelection'
import type {
  AssistCatalogItem,
  AssistChoiceStepId,
  PreFixedAssistSelectionState,
} from '../../types/preFixedAssistSelection'
import { formatFareYen } from '../../services/fare'
import '../../styles/preFixedMeterDashboard.css'

export type PreFixedAssistFlowVariant = 'wizard' | 'meter-editor' | 'equipment-only'

type PreFixedAssistStepFlowProps = {
  value: PreFixedAssistSelectionState
  onChange: (next: PreFixedAssistSelectionState) => void
  isRoundTrip?: boolean
  error?: string
  /** wizard=作成フロー / meter-editor=運行中編集（全ステップ展開） / equipment-only=機材のみ */
  variant?: PreFixedAssistFlowVariant
}

const formatAmountLabel = (amount: number) =>
  amount > 0 ? `+${formatFareYen(amount)}円` : '追加料金なし'

const ChoiceCards = ({
  items,
  selectedId,
  onSelect,
  inputName,
}: {
  items: AssistCatalogItem[]
  selectedId: string
  onSelect: (id: string) => void
  inputName: string
}) => (
  <div className="pre-fixed-assist-choice-list" role="radiogroup" aria-label={inputName}>
    {items.map((item) => {
      const selected = selectedId === item.id
      return (
        <label
          key={item.id}
          className={`pre-fixed-assist-choice-card pre-fixed-meter-option-card${selected ? ' is-selected' : ''}`}
        >
          <input
            type="radio"
            name={inputName}
            value={item.id}
            checked={selected}
            onChange={() => onSelect(item.id)}
          />
          <span className="pre-fixed-assist-choice-card__body">
            <span className="pre-fixed-assist-choice-card__title">
              {selected ? '✓ ' : ''}
              {item.label}
              {selected ? <em className="pre-fixed-meter-option-card__badge">選択中</em> : null}
            </span>
            {item.description ? (
              <span className="pre-fixed-assist-choice-card__desc">{item.description}</span>
            ) : null}
          </span>
          <strong className="pre-fixed-assist-choice-card__amount">
            {formatAmountLabel(item.amount)}
          </strong>
        </label>
      )
    })}
  </div>
)

const ExtraCards = ({
  items,
  selectedIds,
  onToggle,
}: {
  items: AssistCatalogItem[]
  selectedIds: string[]
  onToggle: (id: string) => void
}) => (
  <div className="pre-fixed-assist-choice-list">
    {items.map((item) => {
      const selected = selectedIds.includes(item.id)
      return (
        <label
          key={item.id}
          className={`pre-fixed-assist-choice-card pre-fixed-meter-option-card${selected ? ' is-selected' : ''}`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(item.id)}
          />
          <span className="pre-fixed-assist-choice-card__body">
            <span className="pre-fixed-assist-choice-card__title">
              {selected ? '✓ ' : ''}
              {item.label}
              {selected ? <em className="pre-fixed-meter-option-card__badge">選択中</em> : null}
            </span>
            {item.description ? (
              <span className="pre-fixed-assist-choice-card__desc">{item.description}</span>
            ) : null}
          </span>
          <strong className="pre-fixed-assist-choice-card__amount">
            {formatAmountLabel(item.amount)}
          </strong>
        </label>
      )
    })}
  </div>
)

const StepSummary = ({
  stepNumber,
  stepId,
  state,
  onEdit,
}: {
  stepNumber: number
  stepId: AssistChoiceStepId
  state: PreFixedAssistSelectionState
  onEdit: () => void
}) => (
  <div className="pre-fixed-assist-step pre-fixed-assist-step--done">
    <div className="pre-fixed-assist-step__header">
      <p className="pre-fixed-assist-step__eyebrow">
        STEP{stepNumber} {ASSIST_STEP_TITLES[stepId]}
      </p>
      <button className="text-link" type="button" onClick={onEdit}>
        変更
      </button>
    </div>
    <p className="pre-fixed-assist-step__summary">{getStepSummaryLabel(state, stepId)}</p>
  </div>
)

export function PreFixedAssistStepFlow({
  value,
  onChange,
  isRoundTrip = false,
  error = '',
  variant = 'wizard',
}: PreFixedAssistStepFlowProps) {
  const isMeterEditor = variant === 'meter-editor'
  const isEquipmentOnly = variant === 'equipment-only'
  const applyChoice = isMeterEditor || isEquipmentOnly ? applyMeterEditChoice : applyStepChoice

  const activeStep = getNaturalActiveAssistStep(value)
  const fees = computeAssistFeeBreakdown(value)
  const assistanceRule = getMobilityAssistanceRule(value.mobilityId)
  const assistanceOptions = getAssistanceOptions(value.mobilityId)

  const renderActiveStep = (stepId: AssistChoiceStepId, stepNumber: number) => {
    if (stepId === 'mobility') {
      return (
        <div className="pre-fixed-assist-step is-active">
          <p className="pre-fixed-assist-step__eyebrow">
            STEP{stepNumber} {ASSIST_STEP_TITLES.mobility}
          </p>
          <h2 className="pre-fixed-assist-step__title">
            {isEquipmentOnly ? '機材を選択' : '移動方法を選択'}
          </h2>
          <ChoiceCards
            items={MOBILITY_CATALOG}
            selectedId={value.mobilityId}
            inputName="assist-mobility"
            onSelect={(id) => onChange(applyChoice(value, 'mobility', id))}
          />
        </div>
      )
    }

    if (stepId === 'assistance') {
      const note =
        assistanceRule?.mode === 'fixed'
          ? 'この移動方法では介助内容が自動選択されます。'
          : assistanceRule?.mode === 'required'
            ? 'いずれかを選択してください。'
            : '必要に応じて選択してください。'

      return (
        <div className="pre-fixed-assist-step is-active">
          <p className="pre-fixed-assist-step__eyebrow">
            STEP{stepNumber} {ASSIST_STEP_TITLES.assistance}
          </p>
          <h2 className="pre-fixed-assist-step__title">介助内容を選択</h2>
          <p className="pre-fixed-assist-step__note">{note}</p>
          {assistanceRule?.mode === 'fixed' ? (
            <div className="pre-fixed-assist-choice-card pre-fixed-meter-option-card is-selected is-fixed">
              <span className="pre-fixed-assist-choice-card__body">
                <span className="pre-fixed-assist-choice-card__title">
                  ✓{' '}
                  {ASSISTANCE_CATALOG.find((item) => item.id === value.assistanceId)?.label ||
                    '身体介助'}
                  <em className="pre-fixed-meter-option-card__badge">選択中</em>
                </span>
              </span>
              <strong className="pre-fixed-assist-choice-card__amount">
                {formatAmountLabel(
                  ASSISTANCE_CATALOG.find((item) => item.id === value.assistanceId)?.amount || 0,
                )}
              </strong>
            </div>
          ) : (
            <ChoiceCards
              items={assistanceOptions}
              selectedId={value.assistanceId}
              inputName="assist-assistance"
              onSelect={(id) => onChange(applyChoice(value, 'assistance', id))}
            />
          )}
        </div>
      )
    }

    if (stepId === 'stair') {
      return (
        <div className="pre-fixed-assist-step is-active">
          <p className="pre-fixed-assist-step__eyebrow">
            STEP{stepNumber} {ASSIST_STEP_TITLES.stair}
          </p>
          <h2 className="pre-fixed-assist-step__title">階段介助を選択</h2>
          <ChoiceCards
            items={STAIR_CATALOG}
            selectedId={value.stairId}
            inputName="assist-stair"
            onSelect={(id) => onChange(applyChoice(value, 'stair', id))}
          />
        </div>
      )
    }

    return (
      <div className="pre-fixed-assist-step is-active">
        <p className="pre-fixed-assist-step__eyebrow">
          STEP{stepNumber} {ASSIST_STEP_TITLES.extras}
        </p>
        <h2 className="pre-fixed-assist-step__title">その他サービス（任意）</h2>
        <ExtraCards
          items={EXTRA_SERVICE_CATALOG}
          selectedIds={value.extraIds}
          onToggle={(id) =>
            onChange(
              isMeterEditor ? toggleExtraChoice(value, id) : toggleExtraChoice(value, id),
            )
          }
        />
        {isRoundTrip ? (
          <>
            <p className="pre-fixed-assist-step__note">
              往復の場合、待機または付き添いを選択できます（任意）。
            </p>
            <ChoiceCards
              items={ROUND_TRIP_ADDON_CATALOG}
              selectedId={value.roundTripAddonId}
              inputName="assist-round-trip-addon"
              onSelect={(id) =>
                onChange(
                  isMeterEditor
                    ? applyRoundTripAddon(value, id)
                    : applyRoundTripAddon(value, id),
                )
              }
            />
          </>
        ) : null}
      </div>
    )
  }

  if (isEquipmentOnly) {
    return (
      <div className="pre-fixed-assist-flow pre-fixed-assist-flow--meter-editor">
        {renderActiveStep('mobility', 1)}
        {error ? <p className="pre-fixed-assist-flow__error">{error}</p> : null}
      </div>
    )
  }

  if (isMeterEditor) {
    const steps: AssistChoiceStepId[] = ['mobility', 'assistance', 'stair', 'extras']
    return (
      <div className="pre-fixed-assist-flow pre-fixed-assist-flow--meter-editor">
        {steps.map((stepId, index) => (
          <div key={stepId}>{renderActiveStep(stepId, index + 1)}</div>
        ))}
        <dl className="pre-fixed-assist-fee-summary" aria-label="介助料金内訳">
          <div>
            <dt>介助・サービス合計</dt>
            <dd>{formatFareYen(fees.serviceTotal)}円</dd>
          </div>
        </dl>
        {error ? <p className="pre-fixed-assist-flow__error">{error}</p> : null}
      </div>
    )
  }

  const steps: AssistChoiceStepId[] = ['mobility', 'assistance', 'stair', 'extras']

  return (
    <div className="pre-fixed-assist-flow">
      {steps.map((stepId, index) => {
        const stepNumber = index + 1
        const activeIndex = steps.indexOf(activeStep)
        const showAsSummary = index < activeIndex
        const showAsActive = index === activeIndex

        if (showAsSummary) {
          return (
            <StepSummary
              key={stepId}
              stepNumber={stepNumber}
              stepId={stepId}
              state={value}
              onEdit={() => onChange(openStepForEdit(value, stepId))}
            />
          )
        }
        if (showAsActive) {
          return <div key={stepId}>{renderActiveStep(stepId, stepNumber)}</div>
        }
        return null
      })}

      {areRequiredAssistStepsComplete(value) ? (
        <dl className="pre-fixed-assist-fee-summary" aria-label="介助料金内訳">
          <div>
            <dt>介助・サービス合計</dt>
            <dd>{formatFareYen(fees.serviceTotal)}円</dd>
          </div>
        </dl>
      ) : null}
      {error ? <p className="pre-fixed-assist-flow__error">{error}</p> : null}
    </div>
  )
}
