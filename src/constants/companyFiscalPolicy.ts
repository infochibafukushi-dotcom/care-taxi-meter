import type { CompanyFiscalPolicy } from '../types/accountingFiscalPeriod'

/**
 * 株式会社千葉福祉サポートの会計年度方針。
 * Phase 1A では定数。将来は会社マスタから供給する想定。
 */
export const COMPANY_FISCAL_POLICY: CompanyFiscalPolicy = {
  incorporationDate: '2026-07-07',
  fiscalYearEndMonth: 3,
}