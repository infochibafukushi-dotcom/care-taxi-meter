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
  | 'fixed-assets'
  | 'small-assets'
  | 'account-breakdown'
  | 'business-overview'
  | 'consumption-tax'
  | 'pdf-bulk'
  | 'csv-bulk'

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

export type ETaxPackage = {
  company: ETaxCompanyProfile
  summary: ETaxReportLine[]
  pl: import('./accounting').MonthlyProfitLoss
  balanceSheet: ETaxReportLine[]
  fixedAssets: ETaxFixedAssetRow[]
  smallAssets: ETaxSmallAssetRow[]
  accountBreakdown: ETaxReportLine[]
  businessOverview: ETaxReportLine[]
  consumptionTax: ETaxReportLine[]
}
