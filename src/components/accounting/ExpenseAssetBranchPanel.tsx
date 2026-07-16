import { useMemo, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import {
  calculateDepreciationSchedule,
  calculateSmallAssetUsageForYear,
  calculateUsefulLifeYears,
  getSmallAssetAmountRecommendationLabel,
  getSmallAssetAmountRecommendation,
} from '../../utils/accountingDepreciation'
import { getCurrentCalendarYearInJapan } from '../../utils/accountingPl'
import {
  detectFixedAssetRegistrationWarning,
  FIXED_ASSET_OVERRIDE_WARNING,
} from '../../utils/accountingAssetDetection'
import {
  buildNormalExpenseOverrideJudgmentKey,
  NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID,
  NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID,
  NORMAL_EXPENSE_OVERRIDE_SECTION_ID,
} from '../../utils/accountingNormalExpenseOverride'
import {
  ASSET_CONDITIONS,
  EXPENSE_REGISTRATION_TYPES,
  EXPENSE_REGISTRATION_TYPE_LABELS,
  FIXED_ASSET_ITEM_TYPES,
  SMALL_ASSET_ITEM_TYPES,
  VEHICLE_TYPES,
  type ExpenseAssetRegistrationDraft,
  type ExpenseRegistrationType,
  type StoredAccountingFixedAsset,
} from '../../types/accountingFixedAssets'
import {
  findDuplicateChassisAssets,
  getCurrentCalendarYear,
  hasIncompleteVehicleInfo,
  normalizeChassisNumber,
  parseModelYearInput,
  shouldShowVehicleManagementFields,
  validateModelYearValue,
} from '../../utils/accountingVehicleAssetFields'

type ExpenseAssetBranchPanelProps = {
  hasExpenseCategory: boolean
  draft: ExpenseAssetRegistrationDraft
  defaultAmount: number
  defaultPurchaseDate: string
  description: string
  vendorName: string
  suggestedCategory?: string
  smallAssetUsageAssets: Array<Pick<StoredAccountingFixedAsset, 'assetKind' | 'purchaseDate' | 'acquisitionCost' | 'isDeleted'>>
  /** 車台番号重複チェック用（アクティブ資産） */
  existingFixedAssets?: Array<
    Pick<StoredAccountingFixedAsset, 'id' | 'chassisNumber' | 'isDeleted' | 'assetCategory' | 'assetName'>
  >
  onChange: (draft: ExpenseAssetRegistrationDraft) => void
}

export function ExpenseAssetBranchPanel({
  hasExpenseCategory,
  draft,
  defaultAmount,
  defaultPurchaseDate,
  description,
  vendorName,
  suggestedCategory = '',
  smallAssetUsageAssets,
  existingFixedAssets = [],
  onChange,
}: ExpenseAssetBranchPanelProps) {
  const [showFixedDetails, setShowFixedDetails] = useState(draft.registrationType === 'fixed')

  const currentYear = getCurrentCalendarYearInJapan()
  const smallAssetUsage = useMemo(
    () => calculateSmallAssetUsageForYear(smallAssetUsageAssets, currentYear),
    [currentYear, smallAssetUsageAssets],
  )

  const chassisDuplicateWarning = useMemo(() => {
    if (draft.registrationType !== 'fixed' || draft.assetCategory !== '車両') return ''
    const duplicates = findDuplicateChassisAssets(existingFixedAssets, draft.chassisNumber)
    if (duplicates.length === 0) return ''
    const names = duplicates.map((asset) => asset.assetName || asset.id).join('、')
    return `同じ車台番号の資産が既にあります（${names}）。重複の可能性があるため確認してください。`
  }, [draft.assetCategory, draft.chassisNumber, draft.registrationType, existingFixedAssets])

  const modelYearWarning = useMemo(() => {
    if (draft.registrationType !== 'fixed' || draft.assetCategory !== '車両') return ''
    return (
      validateModelYearValue(parseModelYearInput(draft.modelYear), {
        firstRegistrationYearMonth: draft.firstRegistrationYearMonth,
      }).warning ?? ''
    )
  }, [
    draft.assetCategory,
    draft.firstRegistrationYearMonth,
    draft.modelYear,
    draft.registrationType,
  ])

  const incompleteVehicleWarning = useMemo(() => {
    if (!shouldShowVehicleManagementFields(draft.registrationType, draft.assetCategory)) return ''
    if (
      !hasIncompleteVehicleInfo({
        assetCategory: draft.assetCategory,
        chassisNumber: draft.chassisNumber,
        modelYear: parseModelYearInput(draft.modelYear) ?? undefined,
      })
    ) {
      return ''
    }
    return '車両情報未入力（車台番号・年式は後から固定資産台帳で追記できます）'
  }, [draft.assetCategory, draft.chassisNumber, draft.modelYear, draft.registrationType])

  if (!hasExpenseCategory) {
    return null
  }

  const updateDraft = (patch: Partial<ExpenseAssetRegistrationDraft>) => {
    onChange({ ...draft, ...patch })
  }

  const recalculateSchedule = (next: ExpenseAssetRegistrationDraft) => {
    if (next.registrationType !== 'fixed' || !next.useStartDate || !next.assetCategory) {
      return next
    }

    const standardUsefulLifeYears = calculateUsefulLifeYears({
      assetCategory: next.assetCategory,
      condition: next.condition,
      vehicleType: next.vehicleType || undefined,
      firstRegistrationYearMonth: next.firstRegistrationYearMonth || undefined,
      useStartDate: next.useStartDate,
    })
    const appliedUsefulLifeYears = next.appliedUsefulLifeYears || standardUsefulLifeYears
    const schedule = calculateDepreciationSchedule({
      acquisitionCost: next.acquisitionCost || defaultAmount,
      usefulLifeYears: appliedUsefulLifeYears,
      useStartDate: next.useStartDate,
    })

    return {
      ...next,
      standardUsefulLifeYears,
      appliedUsefulLifeYears,
      monthlyDepreciationYen: schedule.monthlyDepreciationYen,
      depreciationStartYearMonth: schedule.depreciationStartYearMonth,
      depreciationEndYearMonth: schedule.depreciationEndYearMonth,
    }
  }

  const handleRegistrationTypeChange = (registrationType: ExpenseRegistrationType) => {
    const base: ExpenseAssetRegistrationDraft = {
      ...draft,
      registrationType,
      acquisitionCost: draft.acquisitionCost || defaultAmount,
      purchaseDate: draft.purchaseDate || defaultPurchaseDate,
      useStartDate: draft.useStartDate || defaultPurchaseDate,
    }

    if (registrationType === 'normal') {
      onChange({
        ...base,
        assetCategory: '',
        assetName: '',
        normalExpenseOverrideReason: '',
        normalExpenseOverrideConfirmed: false,
        normalExpenseOverrideJudgmentKey: '',
      })
      setShowFixedDetails(false)
      return
    }

    if (registrationType === 'small') {
      onChange({
        ...base,
        assetCategory: base.assetCategory || SMALL_ASSET_ITEM_TYPES[0],
        assetName: base.assetName || SMALL_ASSET_ITEM_TYPES[0],
      })
      setShowFixedDetails(false)
      return
    }

    onChange(
      recalculateSchedule({
        ...base,
        assetCategory: base.assetCategory || FIXED_ASSET_ITEM_TYPES[0],
        assetName: base.assetName || FIXED_ASSET_ITEM_TYPES[0],
      }),
    )
    setShowFixedDetails(true)
  }

  const amountRecommendation = getSmallAssetAmountRecommendation(draft.acquisitionCost || defaultAmount)
  const registrationWarning = detectFixedAssetRegistrationWarning({
    amountYen: draft.acquisitionCost || defaultAmount,
    description,
    vendorName,
    assetCategory: draft.assetCategory,
    suggestedCategory,
  })

  return (
    <section className="accounting-asset-branch" aria-label="資産登録区分">
      <h3>資産登録区分</h3>
      <fieldset className="accounting-radio-fieldset">
        <legend className="accounting-visually-hidden">登録区分</legend>
        <div className="accounting-radio-row">
          {EXPENSE_REGISTRATION_TYPES.map((type) => (
            <label key={type} className="accounting-radio-label">
              <input
                type="radio"
                name="expenseRegistrationType"
                checked={draft.registrationType === type}
                onChange={() => handleRegistrationTypeChange(type)}
              />
              {EXPENSE_REGISTRATION_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </fieldset>

      {draft.registrationType === 'normal' && registrationWarning.shouldWarn ? (
        <div
          className="accounting-asset-warning"
          id={NORMAL_EXPENSE_OVERRIDE_SECTION_ID}
          role="alert"
        >
          <p className="accounting-note accounting-asset-warning-message">{FIXED_ASSET_OVERRIDE_WARNING}</p>
          {registrationWarning.amountMatch ? (
            <p className="accounting-note">取得価額が10万円以上です。</p>
          ) : null}
          {registrationWarning.keywordMatch ? (
            <p className="accounting-note">内容・品目が固定資産候補キーワードに一致しています。</p>
          ) : null}
          <label className="accounting-checkbox-label">
            <input
              id={NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID}
              type="checkbox"
              checked={draft.normalExpenseOverrideConfirmed}
              onChange={(event) =>
                updateDraft({
                  normalExpenseOverrideConfirmed: event.target.checked,
                  normalExpenseOverrideReason: event.target.checked
                    ? draft.normalExpenseOverrideReason
                    : '',
                  normalExpenseOverrideJudgmentKey: event.target.checked
                    ? buildNormalExpenseOverrideJudgmentKey(registrationWarning)
                    : '',
                })
              }
            />
            通常経費のまま登録する
          </label>
          {draft.normalExpenseOverrideConfirmed ? (
            <label>
              通常経費で登録する理由（必須）
              <textarea
                id={NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID}
                rows={2}
                value={draft.normalExpenseOverrideReason}
                onChange={(event) => updateDraft({ normalExpenseOverrideReason: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {draft.registrationType === 'small' ? (
        <div className="accounting-asset-branch-fields">
          <p className="accounting-note accounting-asset-pl-note">
            少額資産として一括経費計上します。この資産は減価償却費ではなく、取得月の経費としてPLに反映されます。
          </p>
          <label>
            購入したもの
            <select
              value={draft.assetCategory}
              onChange={(event) =>
                updateDraft({
                  assetCategory: event.target.value,
                  assetName: event.target.value,
                })
              }
            >
              {SMALL_ASSET_ITEM_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            取得価額
            <input
              inputMode="numeric"
              type="number"
              min={0}
              value={draft.acquisitionCost || defaultAmount || ''}
              onChange={(event) =>
                updateDraft({
                  acquisitionCost: Number(event.target.value) || 0,
                })
              }
            />
          </label>
          <p className="accounting-note accounting-asset-recommendation">
            {getSmallAssetAmountRecommendationLabel(amountRecommendation)}
          </p>
          <label>
            購入日
            <input
              type="date"
              value={draft.purchaseDate || defaultPurchaseDate}
              onChange={(event) => updateDraft({ purchaseDate: event.target.value })}
            />
          </label>
          <label>
            使用開始日
            <input
              type="date"
              value={draft.useStartDate || defaultPurchaseDate}
              onChange={(event) => updateDraft({ useStartDate: event.target.value })}
            />
          </label>
          <div className="accounting-small-asset-usage">
            <h4>今年の少額資産枠</h4>
            <ul className="accounting-pl-list">
              <li>
                <span>年間上限</span>
                <strong>{formatFareYen(smallAssetUsage.annualLimitYen)}円</strong>
              </li>
              <li>
                <span>使用済み</span>
                <strong>{formatFareYen(smallAssetUsage.usedYen)}円</strong>
              </li>
              <li>
                <span>残額</span>
                <strong>{formatFareYen(smallAssetUsage.remainingYen)}円</strong>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {draft.registrationType === 'fixed' ? (
        <div className="accounting-asset-branch-fields">
          <label>
            購入したもの
            <select
              value={draft.assetCategory}
              onChange={(event) => {
                const assetCategory = event.target.value
                onChange(
                  recalculateSchedule({
                    ...draft,
                    assetCategory,
                    assetName: assetCategory,
                    vehicleType: assetCategory === '車両' ? '普通車' : '',
                    chassisNumber: assetCategory === '車両' ? draft.chassisNumber : '',
                    modelYear: assetCategory === '車両' ? draft.modelYear : '',
                    firstRegistrationYearMonth:
                      assetCategory === '車両' ? draft.firstRegistrationYearMonth : '',
                  }),
                )
              }}
            >
              {FIXED_ASSET_ITEM_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          {shouldShowVehicleManagementFields(draft.registrationType, draft.assetCategory) ? (
            <>
              <fieldset className="accounting-radio-fieldset">
                <legend>車種</legend>
                <div className="accounting-radio-row">
                  {VEHICLE_TYPES.map((vehicleType) => (
                    <label key={vehicleType} className="accounting-radio-label">
                      <input
                        type="radio"
                        name="vehicleType"
                        checked={draft.vehicleType === vehicleType}
                        onChange={() =>
                          onChange(
                            recalculateSchedule({
                              ...draft,
                              vehicleType,
                            }),
                          )
                        }
                      />
                      {vehicleType}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label>
                車台番号（車体番号）
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="未確定の場合は空欄可"
                  value={draft.chassisNumber}
                  onChange={(event) => updateDraft({ chassisNumber: event.target.value })}
                  onBlur={() =>
                    updateDraft({ chassisNumber: normalizeChassisNumber(draft.chassisNumber) })
                  }
                />
              </label>
              {chassisDuplicateWarning ? (
                <p className="accounting-warning" role="status">
                  {chassisDuplicateWarning}
                </p>
              ) : null}

              <label>
                年式
                <input
                  type="number"
                  inputMode="numeric"
                  min={1950}
                  max={getCurrentCalendarYear() + 1}
                  placeholder="例：2024"
                  value={draft.modelYear === '' ? '' : draft.modelYear}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    updateDraft({ modelYear: raw === '' ? '' : Number(raw) || '' })
                  }}
                />
              </label>
              {modelYearWarning ? (
                <p className="accounting-warning" role="status">
                  {modelYearWarning}
                </p>
              ) : null}
              {incompleteVehicleWarning ? (
                <p className="accounting-warning" role="status">
                  {incompleteVehicleWarning}
                </p>
              ) : null}
            </>
          ) : null}

          <fieldset className="accounting-radio-fieldset">
            <legend>新品・中古</legend>
            <div className="accounting-radio-row">
              {ASSET_CONDITIONS.map((condition) => (
                <label key={condition} className="accounting-radio-label">
                  <input
                    type="radio"
                    name="assetCondition"
                    checked={draft.condition === condition}
                    onChange={() =>
                      onChange(
                        recalculateSchedule({
                          ...draft,
                          condition,
                        }),
                      )
                    }
                  />
                  {condition}
                </label>
              ))}
            </div>
          </fieldset>

          {draft.assetCategory === '車両' ? (
            <label>
              初度登録年月
              <input
                type="month"
                value={draft.firstRegistrationYearMonth}
                onChange={(event) =>
                  onChange(
                    recalculateSchedule({
                      ...draft,
                      firstRegistrationYearMonth: event.target.value,
                    }),
                  )
                }
              />
              {draft.condition === '中古' ? (
                <span className="accounting-note">中古車の場合は耐用年数計算のため入力してください。</span>
              ) : (
                <span className="accounting-note">任意。年式とは別項目です。</span>
              )}
            </label>
          ) : null}

          <label>
            取得価額
            <input
              inputMode="numeric"
              type="number"
              min={0}
              value={draft.acquisitionCost || defaultAmount || ''}
              onChange={(event) =>
                onChange(
                  recalculateSchedule({
                    ...draft,
                    acquisitionCost: Number(event.target.value) || 0,
                  }),
                )
              }
            />
          </label>
          <label>
            購入日
            <input
              type="date"
              value={draft.purchaseDate || defaultPurchaseDate}
              onChange={(event) => updateDraft({ purchaseDate: event.target.value })}
            />
          </label>
          <label>
            使用開始日
            <input
              type="date"
              value={draft.useStartDate || defaultPurchaseDate}
              onChange={(event) =>
                onChange(
                  recalculateSchedule({
                    ...draft,
                    useStartDate: event.target.value,
                  }),
                )
              }
            />
          </label>

          {showFixedDetails ? (
            <>
              <label>
                標準耐用年数
                <input readOnly type="number" value={draft.standardUsefulLifeYears || ''} />
              </label>
              <label>
                適用耐用年数
                <input
                  type="number"
                  min={1}
                  value={draft.appliedUsefulLifeYears || draft.standardUsefulLifeYears || ''}
                  onChange={(event) =>
                    onChange(
                      recalculateSchedule({
                        ...draft,
                        appliedUsefulLifeYears: Number(event.target.value) || 0,
                      }),
                    )
                  }
                />
              </label>
              {draft.appliedUsefulLifeYears !== draft.standardUsefulLifeYears ? (
                <label>
                  変更理由（必須）
                  <textarea
                    rows={2}
                    value={draft.usefulLifeChangeReason}
                    onChange={(event) => updateDraft({ usefulLifeChangeReason: event.target.value })}
                  />
                </label>
              ) : null}
              <p className="accounting-note">
                月額償却費: {formatFareYen(draft.monthlyDepreciationYen)}円 / 償却開始:{' '}
                {draft.depreciationStartYearMonth || '―'} / 償却終了:{' '}
                {draft.depreciationEndYearMonth || '―'}
              </p>
            </>
          ) : null}

          <label>
            備考
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(event) => updateDraft({ notes: event.target.value })}
            />
          </label>
        </div>
      ) : null}
    </section>
  )
}
