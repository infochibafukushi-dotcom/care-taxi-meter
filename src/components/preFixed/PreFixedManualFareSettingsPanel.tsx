import type { ReactNode } from 'react'
import { OWN_WHEELCHAIR_ID } from '../../constants/preFixedManual'
import { formatFareYen } from '../../services/fare'
import { STAIR_FLOOR_OPTIONS } from '../../services/fareMasterService'
import {
  applyWaitingEscortPlan,
  buildOwnWheelchairItem,
  formatWaitingEscortUnitLabel,
  rentalEquipmentDisplayName,
  resolveStairFloorOption,
} from '../../services/preFixedManualFare'
import {
  dedupeStoreAssistItems,
  listManualFlowOtherEquipmentItems,
  listManualFlowRentalItems,
} from '../../services/preFixedManualAssistCatalog'
import {
  formatConfiguredFareLabel,
  isAssistItemConfigured,
  isDispatchMenuItemConfigured,
  isSpecialVehicleMenuItemConfigured,
  resolveConfiguredAssistAmount,
  resolveConfiguredMenuItemAmount,
} from '../../services/preFixedManualMeterSettings'
import type { MeterSettings } from '../../services/meterSettings'
import { isSpecialVehicleEligibleFromVehicleType } from '../../services/specialVehicleEligibility'
import type {
  ManualWaitingEscortPlan,
  PreFixedManualFareSelection,
} from '../../types/preFixedMeterSession'

const waitingEscortLabels: Record<ManualWaitingEscortPlan, string> = {
  none: 'なし',
  waiting: '待機予定あり',
  escort: '付添予定あり',
  both: '待機・付添あり',
}

type FareOptionCardProps = {
  categoryClass: string
  selected: boolean
  disabled?: boolean
  title: string
  amountLabel: string
  onToggle: () => void
  children?: ReactNode
}

function FareOptionCard({
  categoryClass,
  selected,
  disabled = false,
  title,
  amountLabel,
  onToggle,
  children,
}: FareOptionCardProps) {
  return (
    <div
      className={`pre-fixed-fare-option-card ${categoryClass}${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        type="button"
        className="pre-fixed-fare-option-card__button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onToggle}
      >
        <span className="pre-fixed-fare-option-card__title">{title}</span>
        <span className="pre-fixed-fare-option-card__amount">{amountLabel}</span>
        {selected ? <span className="pre-fixed-fare-option-card__check" aria-hidden="true">✓</span> : null}
      </button>
      {children}
    </div>
  )
}

type PreFixedManualFareSettingsPanelProps = {
  storeMeterSettings: MeterSettings
  vehicleType?: string
  fareSelection: PreFixedManualFareSelection
  routeFareYen: number
  preFixedTotalYen: number
  stepError?: string
  onFareSelectionChange: (
    updater: (current: PreFixedManualFareSelection) => PreFixedManualFareSelection,
  ) => void
  onConfirm: () => void
}

export function PreFixedManualFareSettingsPanel({
  storeMeterSettings,
  vehicleType,
  fareSelection,
  routeFareYen,
  preFixedTotalYen,
  stepError,
  onFareSelectionChange,
  onConfirm,
}: PreFixedManualFareSettingsPanelProps) {
  const dedupedAssistItems = dedupeStoreAssistItems(storeMeterSettings.assistItems)
  const rentalItems = listManualFlowRentalItems(dedupedAssistItems)
  const otherEquipment = listManualFlowOtherEquipmentItems(dedupedAssistItems)
  const ownWheelchairSelected = fareSelection.equipmentItems.some((item) => item.id === OWN_WHEELCHAIR_ID)

  const dispatchConfigured = isDispatchMenuItemConfigured(
    storeMeterSettings.dispatchMenuItems,
    'reservedPickup',
  )
  const specialVehicleConfigured = isSpecialVehicleMenuItemConfigured(
    storeMeterSettings.specialVehicleMenuItems,
    'oneBoxLift',
  )
  const vehicleEligible = isSpecialVehicleEligibleFromVehicleType(vehicleType)
  const boardingAssistConfigured = isAssistItemConfigured(dedupedAssistItems, 'boardingAssist')
  const bodyAssistConfigured = isAssistItemConfigured(dedupedAssistItems, 'bodyAssist')
  const stairsAssistConfigured = isAssistItemConfigured(dedupedAssistItems, 'stairsAssist')

  const dispatchItem = storeMeterSettings.dispatchMenuItems.find((item) => item.id === 'reservedPickup')
  const specialItem = storeMeterSettings.specialVehicleMenuItems.find((item) => item.id === 'oneBoxLift')

  return (
    <div className="pre-fixed-fare-settings-panel">
      <dl className="pre-fixed-detail-grid">
        <div>
          <dt>運賃</dt>
          <dd>{formatFareYen(routeFareYen)}円</dd>
        </div>
      </dl>

      <section className="pre-fixed-fare-category pre-fixed-fare-category--auto">
        <h2 className="pre-fixed-fare-category__title">自動料金</h2>
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--auto"
          selected={fareSelection.dispatchEnabled}
          disabled={!dispatchConfigured}
          title={dispatchItem?.name ?? '予約迎車'}
          amountLabel={formatConfiguredFareLabel(
            dispatchConfigured ? fareSelection.dispatchFareYen : null,
          )}
          onToggle={() =>
            onFareSelectionChange((current) => ({
              ...current,
              dispatchEnabled: !current.dispatchEnabled,
              dispatchFareYen: !current.dispatchEnabled
                ? resolveConfiguredMenuItemAmount(storeMeterSettings.dispatchMenuItems, 'reservedPickup') ?? 0
                : 0,
            }))
          }
        />
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--auto"
          selected={fareSelection.specialVehicleEnabled}
          disabled={!specialVehicleConfigured || !vehicleEligible}
          title={specialItem?.name ?? '1BOXリフト車両'}
          amountLabel={formatConfiguredFareLabel(
            specialVehicleConfigured ? fareSelection.specialVehicleFareYen : null,
          )}
          onToggle={() =>
            onFareSelectionChange((current) => ({
              ...current,
              specialVehicleEnabled: !current.specialVehicleEnabled,
              specialVehicleFareYen: !current.specialVehicleEnabled
                ? resolveConfiguredMenuItemAmount(storeMeterSettings.specialVehicleMenuItems, 'oneBoxLift') ?? 0
                : 0,
            }))
          }
        />
      </section>

      <section className="pre-fixed-fare-category pre-fixed-fare-category--assist">
        <h2 className="pre-fixed-fare-category__title">介助</h2>
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--assist"
          selected={fareSelection.boardingAssist}
          disabled={!boardingAssistConfigured}
          title="乗降介助"
          amountLabel={formatConfiguredFareLabel(
            boardingAssistConfigured ? fareSelection.boardingAssistFareYen : null,
          )}
          onToggle={() =>
            onFareSelectionChange((current) => ({
              ...current,
              boardingAssist: !current.boardingAssist,
              boardingAssistFareYen: !current.boardingAssist
                ? resolveConfiguredAssistAmount(dedupedAssistItems, 'boardingAssist') ?? 0
                : 0,
            }))
          }
        />
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--assist"
          selected={fareSelection.bodyAssist}
          disabled={!bodyAssistConfigured}
          title="身体介助"
          amountLabel={formatConfiguredFareLabel(
            bodyAssistConfigured ? fareSelection.bodyAssistFareYen : null,
          )}
          onToggle={() =>
            onFareSelectionChange((current) => ({
              ...current,
              bodyAssist: !current.bodyAssist,
              bodyAssistFareYen: !current.bodyAssist
                ? resolveConfiguredAssistAmount(dedupedAssistItems, 'bodyAssist') ?? 0
                : 0,
            }))
          }
        />
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--assist"
          selected={fareSelection.stairsAssist}
          disabled={!stairsAssistConfigured}
          title="階段介助"
          amountLabel={formatConfiguredFareLabel(
            stairsAssistConfigured ? fareSelection.stairAssistFareYen : null,
          )}
          onToggle={() =>
            onFareSelectionChange((current) => ({
              ...current,
              stairsAssist: !current.stairsAssist,
              stairFloorId: !current.stairsAssist ? current.stairFloorId : undefined,
              stairFloorLabel: !current.stairsAssist ? current.stairFloorLabel : undefined,
              stairAssistFareYen: !current.stairsAssist ? current.stairAssistFareYen : 0,
            }))
          }
        >
          {fareSelection.stairsAssist ? (
            <label className="pre-fixed-fare-option-card__extra">
              介助先の建物階数を選択してください
              <select
                value={fareSelection.stairFloorId ?? ''}
                onChange={(event) => {
                  const option = resolveStairFloorOption(event.target.value)
                  onFareSelectionChange((current) => ({
                    ...current,
                    stairFloorId: option?.id,
                    stairFloorLabel: option?.label,
                    stairAssistFareYen: option?.amount ?? 0,
                  }))
                }}
              >
                <option value="">選択してください</option>
                {STAIR_FLOOR_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}（{formatFareYen(option.amount)}円）
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </FareOptionCard>
      </section>

      <section className="pre-fixed-fare-category pre-fixed-fare-category--rental">
        <h2 className="pre-fixed-fare-category__title">車いす・機材レンタル</h2>
        <FareOptionCard
          categoryClass="pre-fixed-fare-category--rental"
          selected={ownWheelchairSelected}
          title="利用者所有の車いす"
          amountLabel="0円"
          onToggle={() => {
            const ownItem = buildOwnWheelchairItem()
            onFareSelectionChange((current) => {
              if (ownWheelchairSelected) {
                return {
                  ...current,
                  equipmentItems: current.equipmentItems.filter((item) => item.id !== OWN_WHEELCHAIR_ID),
                }
              }
              return {
                ...current,
                equipmentItems: [
                  ...current.equipmentItems.filter((item) => item.id !== OWN_WHEELCHAIR_ID),
                  ownItem,
                ],
              }
            })
          }}
        />
        {rentalItems.map((item) => {
          const selected = fareSelection.equipmentItems.some((entry) => entry.id === item.id)
          return (
            <FareOptionCard
              key={item.id}
              categoryClass="pre-fixed-fare-category--rental"
              selected={selected}
              title={rentalEquipmentDisplayName(item.id, item.name)}
              amountLabel={formatFareYen(item.amount)}
              onToggle={() =>
                onFareSelectionChange((current) => {
                  if (selected) {
                    return {
                      ...current,
                      equipmentItems: current.equipmentItems.filter((entry) => entry.id !== item.id),
                    }
                  }
                  return {
                    ...current,
                    equipmentItems: [
                      ...current.equipmentItems.filter((entry) => entry.id !== item.id),
                      {
                        id: item.id,
                        name: rentalEquipmentDisplayName(item.id, item.name),
                        amountYen: Math.max(item.amount, 0),
                      },
                    ],
                  }
                })
              }
            />
          )
        })}
        {otherEquipment.map((item) => {
          const selected = fareSelection.equipmentItems.some((entry) => entry.id === item.id)
          return (
            <FareOptionCard
              key={item.id}
              categoryClass="pre-fixed-fare-category--rental"
              selected={selected}
              title={item.name}
              amountLabel={formatFareYen(item.amount)}
              onToggle={() =>
                onFareSelectionChange((current) => {
                  if (selected) {
                    return {
                      ...current,
                      equipmentItems: current.equipmentItems.filter((entry) => entry.id !== item.id),
                    }
                  }
                  return {
                    ...current,
                    equipmentItems: [
                      ...current.equipmentItems.filter((entry) => entry.id !== item.id),
                      {
                        id: item.id,
                        name: item.name,
                        amountYen: Math.max(item.amount, 0),
                      },
                    ],
                  }
                })
              }
            />
          )
        })}
      </section>

      <section className="pre-fixed-fare-category pre-fixed-fare-category--waiting">
        <h2 className="pre-fixed-fare-category__title">待機・付添</h2>
        {(Object.keys(waitingEscortLabels) as ManualWaitingEscortPlan[]).map((plan) => (
          <FareOptionCard
            key={plan}
            categoryClass="pre-fixed-fare-category--waiting"
            selected={fareSelection.waitingEscortPlan === plan}
            title={waitingEscortLabels[plan]}
            amountLabel={
              plan === 'waiting'
                ? formatWaitingEscortUnitLabel(fareSelection.waitingUnitFareYen)
                : plan === 'escort'
                  ? formatWaitingEscortUnitLabel(fareSelection.escortUnitFareYen)
                  : plan === 'both'
                    ? `${formatWaitingEscortUnitLabel(fareSelection.waitingUnitFareYen)} / ${formatWaitingEscortUnitLabel(fareSelection.escortUnitFareYen)}`
                    : '—'
            }
            onToggle={() => onFareSelectionChange((current) => applyWaitingEscortPlan(current, plan))}
          />
        ))}
      </section>

      <div className="pre-fixed-consent-summary__total">
        <p>事前確定料金</p>
        <p className="pre-fixed-amount">{formatFareYen(preFixedTotalYen)}円</p>
      </div>

      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button className="primary-action" type="button" onClick={onConfirm}>
          確認画面へ
        </button>
      </div>
    </div>
  )
}
