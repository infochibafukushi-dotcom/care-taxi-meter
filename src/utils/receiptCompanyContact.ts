import {
  LEGACY_INCORRECT_RECEIPT_PHONE_NUMBERS,
  OFFICIAL_COMPANY_PROFILE,
} from '../constants/officialCompanyProfile'
import type { CompanySettings } from '../services/meterSettings'

const legacyIncorrectPhoneDigits = new Set(
  LEGACY_INCORRECT_RECEIPT_PHONE_NUMBERS.map((phone) => phone.replaceAll(/\D/g, '')),
)

export function normalizePhoneDigits(phoneNumber: string) {
  return phoneNumber.replaceAll(/\D/g, '')
}

export function resolveReceiptPhoneNumber(phoneNumber: string) {
  const trimmed = phoneNumber.trim()
  if (!trimmed) {
    return OFFICIAL_COMPANY_PROFILE.phoneNumber
  }

  const digits = normalizePhoneDigits(trimmed)
  if (
    LEGACY_INCORRECT_RECEIPT_PHONE_NUMBERS.includes(trimmed as (typeof LEGACY_INCORRECT_RECEIPT_PHONE_NUMBERS)[number])
    || legacyIncorrectPhoneDigits.has(digits)
  ) {
    return OFFICIAL_COMPANY_PROFILE.phoneNumber
  }

  return trimmed
}

export function resolveReceiptCompanySettings(company: CompanySettings): CompanySettings {
  const legacyCompanyName = company.companyName.trim()
  const corporateName = company.corporateName.trim() || legacyCompanyName
  const tradeName = company.tradeName.trim() || legacyCompanyName

  return {
    ...company,
    tradeName: tradeName || OFFICIAL_COMPANY_PROFILE.tradeName,
    corporateName: corporateName || OFFICIAL_COMPANY_PROFILE.corporateName,
    companyName: legacyCompanyName || OFFICIAL_COMPANY_PROFILE.corporateName,
    postalCode: company.postalCode.trim() || OFFICIAL_COMPANY_PROFILE.postalCode,
    address: company.address.trim() || OFFICIAL_COMPANY_PROFILE.address,
    phoneNumber: resolveReceiptPhoneNumber(company.phoneNumber),
  }
}
