/** 国税庁インボイス公表システムから取得した登録事業者情報 */
export type InvoiceRegistrantInfo = {
  invoiceNumber: string
  corporateNumber: string
  registeredName: string
  tradeName?: string
  address?: string
  registrationStatus: string
  registrationDate?: string
  updateDate?: string
  disposalDate?: string
  expireDate?: string
  kind?: string
  process?: string
  lookupMethod: 'インボイス番号検索' | 'fallback'
  lookedUpAt: string
  source: 'nta-invoice-api' | 'cache' | 'fallback'
}

export type InvoiceRegistrantLookupResult =
  | {
      status: 'success'
      registrant: InvoiceRegistrantInfo
      invoiceCheckStatus: '確認済'
      /** API 失敗時に既知番号フォールバックを使った場合 true */
      usedFallback?: boolean
      fallbackReason?: string
    }
  | {
      status: 'not_found'
      invoiceNumber: string
      invoiceCheckStatus: '登録なし'
      message: string
    }
  | {
      status: 'error'
      invoiceNumber?: string
      invoiceCheckStatus: '未確認'
      message: string
    }
  | {
      status: 'skipped'
      invoiceNumber?: string
      invoiceCheckStatus: '未確認'
      message: string
    }
