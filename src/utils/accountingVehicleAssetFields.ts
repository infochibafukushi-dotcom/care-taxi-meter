/**
 * Fixed-asset vehicle management fields (chassis / model year).
 * Canonical store: accountingFixedAssets documents.
 */

const FULLWIDTH_ALNUM =
  /[Ａ-Ｚａ-ｚ０-９]/g
const FULLWIDTH_HYPHEN = /[－−‐﹘﹣]/g

const toHalfWidthAlnum = (value: string) =>
  value
    .replace(FULLWIDTH_ALNUM, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(FULLWIDTH_HYPHEN, '-')

/** Trim, half-width, uppercase. Empty → ''. */
export const normalizeChassisNumber = (raw: string | undefined | null): string => {
  if (raw == null) return ''
  return toHalfWidthAlnum(String(raw).trim()).toUpperCase()
}

export const isValidChassisNumberFormat = (normalized: string): boolean =>
  normalized === '' || /^[A-Z0-9-]+$/.test(normalized)

export const getCurrentCalendarYear = (now = new Date()) => now.getFullYear()

export const parseModelYearInput = (raw: string | number | '' | null | undefined): number | null => {
  if (raw === '' || raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isInteger(n)) return null
  return n
}

export const validateModelYearValue = (
  modelYear: number | null,
  options?: { now?: Date; firstRegistrationYearMonth?: string },
): { error: string | null; warning: string | null } => {
  if (modelYear == null) {
    return { error: null, warning: null }
  }

  const currentYear = getCurrentCalendarYear(options?.now)
  if (modelYear < 1000 || modelYear > 9999) {
    return { error: '年式は西暦4桁の整数で入力してください。', warning: null }
  }
  if (modelYear > currentYear + 1) {
    return { error: `年式は${currentYear + 1}年まで入力できます。`, warning: null }
  }
  if (modelYear < 1950) {
    return { error: null, warning: '年式が1950年より前です。入力内容を確認してください。' }
  }

  const firstYm = options?.firstRegistrationYearMonth?.trim()
  if (firstYm && /^\d{4}-\d{2}$/.test(firstYm)) {
    const firstYear = Number(firstYm.slice(0, 4))
    if (Number.isFinite(firstYear) && Math.abs(firstYear - modelYear) >= 3) {
      return {
        error: null,
        warning: `年式（${modelYear}）と初度登録年月（${firstYm}）が大きく離れています。`,
      }
    }
  }

  return { error: null, warning: null }
}

export const findDuplicateChassisAssets = <T extends { id: string; chassisNumber?: string; isDeleted?: boolean; assetCategory?: string }>(
  assets: T[],
  chassisNumber: string,
  options?: { excludeAssetId?: string },
): T[] => {
  const normalized = normalizeChassisNumber(chassisNumber)
  if (!normalized) return []

  return assets.filter((asset) => {
    if (asset.isDeleted) return false
    if (options?.excludeAssetId && asset.id === options.excludeAssetId) return false
    return normalizeChassisNumber(asset.chassisNumber) === normalized
  })
}

export const isVehicleAssetCategory = (assetCategory: string | undefined | null) =>
  assetCategory === '車両'

export const shouldShowVehicleManagementFields = (
  registrationType: string | undefined | null,
  assetCategory: string | undefined | null,
) => registrationType === 'fixed' && isVehicleAssetCategory(assetCategory)

export const hasIncompleteVehicleInfo = (asset: {
  assetCategory?: string
  chassisNumber?: string
  modelYear?: number | null
}) => {
  if (!isVehicleAssetCategory(asset.assetCategory)) return false
  const chassis = normalizeChassisNumber(asset.chassisNumber)
  const year = asset.modelYear
  return !chassis || year == null || !Number.isFinite(year)
}

export const formatChassisNumberDisplay = (value?: string | null) => {
  const normalized = normalizeChassisNumber(value)
  return normalized || '未入力'
}

export const formatModelYearDisplay = (value?: number | null) => {
  if (value == null || !Number.isFinite(value)) return '未入力'
  return String(value)
}
