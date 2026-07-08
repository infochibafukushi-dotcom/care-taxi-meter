/** 消費税率プリセット（%） */
export const TAX_RATE_PRESETS = [0, 8, 10] as const

export type TaxRatePreset = (typeof TAX_RATE_PRESETS)[number]

export const TAX_CALCULATION_MODES = ['auto', 'manual', 'ocr'] as const

export type TaxCalculationMode = (typeof TAX_CALCULATION_MODES)[number]

export const TAX_CALCULATION_MODE_LABELS: Record<TaxCalculationMode, string> = {
  auto: '自動計算',
  manual: '手入力',
  ocr: 'OCR',
}

/**
 * Firestore / フォームから消費税率を正規化。
 * 未設定・空欄は null（既存でキー欠落も null）。
 */
export const normalizeTaxRate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/%/g, '')
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export const normalizeTaxAmount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(Math.round(value), 0) : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/[,，円]/g, '')
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : null
  }

  return null
}

export const normalizeTaxCalculationMode = (value: unknown): TaxCalculationMode => {
  if (value === 'manual' || value === 'ocr' || value === 'auto') {
    return value
  }
  return 'auto'
}

/**
 * 税込金額と税率から消費税額を計算。
 * 税率未設定または 0% 以下は 0（0% は税額なし）。
 */
export const calculateConsumptionTaxFromIncluded = (
  taxIncludedAmount: number,
  taxRate: number | null | undefined,
): number => {
  if (!Number.isFinite(taxIncludedAmount) || taxIncludedAmount <= 0) {
    return 0
  }

  const rate = normalizeTaxRate(taxRate)
  if (rate === null || rate <= 0) {
    return 0
  }

  return Math.round((taxIncludedAmount * rate) / (100 + rate))
}

export const calculateTaxExcludedAmount = (
  taxIncludedAmount: number,
  taxAmount: number | null | undefined,
): number | null => {
  if (!Number.isFinite(taxIncludedAmount)) {
    return null
  }

  const amount = normalizeTaxAmount(taxAmount)
  if (amount === null) {
    return null
  }

  return Math.max(Math.round(taxIncludedAmount) - amount, 0)
}

export const isPresetTaxRate = (taxRate: number | null | undefined): taxRate is TaxRatePreset =>
  taxRate !== null &&
  taxRate !== undefined &&
  (TAX_RATE_PRESETS as readonly number[]).includes(taxRate)

export const deriveTaxFields = ({
  taxIncludedAmount,
  taxRate,
  taxAmount,
  taxCalculationMode,
}: {
  taxIncludedAmount: number
  taxRate: number | null | undefined
  taxAmount?: number | null
  taxCalculationMode?: TaxCalculationMode | unknown
}) => {
  const normalizedRate = normalizeTaxRate(taxRate)
  const mode = normalizeTaxCalculationMode(taxCalculationMode)
  const resolvedTaxAmount =
    mode === 'auto'
      ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, normalizedRate)
      : (normalizeTaxAmount(taxAmount) ??
        calculateConsumptionTaxFromIncluded(taxIncludedAmount, normalizedRate))

  return {
    taxRate: normalizedRate,
    taxAmount: resolvedTaxAmount,
    /** 後方互換: consumptionTaxAmount と同一値を保存 */
    consumptionTaxAmount: resolvedTaxAmount,
    taxExcludedAmount: calculateTaxExcludedAmount(taxIncludedAmount, resolvedTaxAmount),
    taxCalculationMode: mode,
  }
}
