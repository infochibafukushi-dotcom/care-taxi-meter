/**
 * Production-safe selective pre-opening reset eligibility.
 * Independent from developmentResetGuard (dev full wipe isolation).
 */

export const PRE_OPENING_COMPANY_STATUSES = ['screening', 'preparing'] as const

export type PreOpeningCompanyStatus = (typeof PRE_OPENING_COMPANY_STATUSES)[number]

export type PreOpeningResetEligibility =
  | {
      allowed: true
      companyStatus: string
      locked: boolean
    }
  | {
      allowed: false
      reason: string
      companyStatus: string
      locked: boolean
    }

export function isPreOpeningCompanyStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
  return (PRE_OPENING_COMPANY_STATUSES as readonly string[]).includes(normalized)
}

export function evaluatePreOpeningResetEligibility(input: {
  companyStatus?: string | null
  locked?: boolean | null
}): PreOpeningResetEligibility {
  const companyStatus = String(input.companyStatus ?? '').trim() || 'unknown'
  const locked = input.locked === true

  if (locked) {
    return {
      allowed: false,
      reason: '開業前リセットは実行済みのためロックされています。',
      companyStatus,
      locked: true,
    }
  }

  if (!isPreOpeningCompanyStatus(companyStatus)) {
    return {
      allowed: false,
      reason: '開業前モード中の加盟店のみ実行できます。開業後は利用できません。',
      companyStatus,
      locked: false,
    }
  }

  return {
    allowed: true,
    companyStatus,
    locked: false,
  }
}

export function matchesStoreIdConfirmText(
  confirmText: string | null | undefined,
  storeId: string,
): boolean {
  return String(confirmText ?? '').trim() === String(storeId ?? '').trim() && Boolean(storeId.trim())
}
