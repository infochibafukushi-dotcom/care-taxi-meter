/** 会社ごとの会計年度方針（将来は会社マスタから供給可能） */
export type CompanyFiscalPolicy = {
  /** 設立日（YYYY-MM-DD） */
  incorporationDate: string
  /** 決算月（1–12。例: 3 = 3月31日決算） */
  fiscalYearEndMonth: number
}

/**
 * 会計年度（事業年度）の正規化結果。
 * `fiscalYear` は期間開始側の暦年（3月決算法人の通常年度では 4月開始年）。
 */
export type FiscalPeriod = {
  fiscalYear: number
  startDate: string
  endDate: string
  startYearMonth: string
  endYearMonth: string
  isShortFiscalYear: boolean
  monthCount: number
  label: string
}