/** e-Tax転記欄との将来マッピング用ID */
export type ETaxMappingId = string

export type ETaxValueStatus = 'set' | 'unset' | 'planned'

export type ETaxReportLine = {
  mappingId: ETaxMappingId
  label: string
  displayValue: string
  amountYen?: number | null
  status: ETaxValueStatus
}

export type ETaxSectionId =
  | 'summary'
  | 'pl'
  | 'bs'
  | 'bs-input'
  | 'fixed-assets'
  | 'small-assets'
  | 'account-breakdown'
  | 'account-breakdown-detail'
  | 'business-overview'
  | 'consumption-tax'
  | 'auxiliary-input'
  | 'input-status'
  | 'missing-items'
  | 'auxiliary-data'
  | 'pdf-bulk'
  | 'csv-bulk'

export type ETaxExportableSectionId = Exclude<
  ETaxSectionId,
  'pdf-bulk' | 'csv-bulk' | 'auxiliary-input' | 'input-status' | 'missing-items'
>

export type ETaxCompanyProfile = {
  companyName: string
  fiscalYearLabel: string
  targetYear: number
  corporateNumber: string
  address: string
  representativeName: string
}

export type ETaxFixedAssetRow = {
  mappingId: ETaxMappingId
  assetName: string
  assetCategory: string
  purchaseDate: string
  acquisitionCost: number
  usefulLifeYears: number
  depreciationMethod: string
  monthlyDepreciationYen: number
  annualDepreciationYen: number
  cumulativeDepreciationYen: number
  remainingBookValue: number
}

export type ETaxSmallAssetRow = {
  mappingId: ETaxMappingId
  purchaseDate: string
  assetName: string
  acquisitionCost: number
  treatment: string
  plPostingYearMonth: string
  notes: string
}

export type ETaxBreakdownDetailRow = {
  mappingId: ETaxMappingId
  values: string[]
}

export type ETaxAccountBreakdownSection = {
  sectionId: string
  sectionLabel: string
  mappingIdPrefix: string
  headers: string[]
  rows: ETaxBreakdownDetailRow[]
}

export type ETaxMissingItem = {
  mappingId: ETaxMappingId
  label: string
  status: 'unset' | 'planned'
  category: string
}

export type ETaxInputStatusSummary = {
  totalChecks: number
  completedChecks: number
  missingItems: ETaxMissingItem[]
}

export type ETaxPackage = {
  company: ETaxCompanyProfile
  summary: ETaxReportLine[]
  pl: import('./accounting').MonthlyProfitLoss
  balanceSheet: ETaxReportLine[]
  bsInput: ETaxReportLine[]
  fixedAssets: ETaxFixedAssetRow[]
  smallAssets: ETaxSmallAssetRow[]
  accountBreakdown: ETaxReportLine[]
  accountBreakdownDetail: ETaxAccountBreakdownSection[]
  businessOverview: ETaxReportLine[]
  consumptionTax: ETaxReportLine[]
  auxiliaryDataLines: ETaxReportLine[]
  inputStatus: ETaxInputStatusSummary
  missingItems: ETaxMissingItem[]
}
