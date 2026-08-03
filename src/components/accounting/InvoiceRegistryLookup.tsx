import { useEffect, useRef, useState } from 'react'
import {
  checkInvoiceRegistry,
  getTodayYmdInJapan,
} from '../../services/invoiceRegistryCheck'
import type { InvoiceRegistryCheckData } from '../../types/invoiceRegistry'
import {
  INVOICE_REGISTRY_DISCLAIMER,
  INVOICE_REGISTRY_STATUS_LABELS,
  INVOICE_REGISTRY_TAX_NOTE,
  INVOICE_REGISTRY_VENDOR_MISMATCH_WARNING,
} from '../../types/invoiceRegistry'
import {
  INVOICE_REGISTRATION_NUMBER_ERROR,
  isVendorNameMismatch,
  normalizeInvoiceRegistrationNumberForUi,
} from '../../utils/invoiceRegistryNormalize'

export type InvoiceRegistryLookupProps = {
  /** 初期登録番号（経費フォーム連携） */
  initialRegistrationNumber?: string
  /** 判定基準日の初期値（証憑日など）。未指定時は当日 */
  initialBasisDate?: string
  /** 入力中の取引先名（相違警告用） */
  vendorName?: string
  /** 確認成功時（有効・無効問わず結果あり） */
  onResult?: (data: InvoiceRegistryCheckData) => void
  /** 国税庁名称を仕入先へ反映する操作を許可する場合 */
  onApplyVendorName?: (name: string) => void
  compact?: boolean
}

const formatDisplay = (value: string | null | undefined) => {
  if (!value) return '—'
  return value
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', { hour12: false })
}

export function InvoiceRegistryLookup({
  initialRegistrationNumber = '',
  initialBasisDate,
  vendorName = '',
  onResult,
  onApplyVendorName,
  compact = false,
}: InvoiceRegistryLookupProps) {
  const today = getTodayYmdInJapan()
  const [registrationNumber, setRegistrationNumber] = useState(initialRegistrationNumber)
  const [basisDate, setBasisDate] = useState(initialBasisDate || today)
  const [inputError, setInputError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<InvoiceRegistryCheckData | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    setRegistrationNumber(initialRegistrationNumber)
  }, [initialRegistrationNumber])

  useEffect(() => {
    if (initialBasisDate) {
      setBasisDate(initialBasisDate)
    }
  }, [initialBasisDate])

  const handleCheck = async () => {
    if (inFlightRef.current || isChecking) {
      return
    }

    setInputError('')
    setErrorMessage('')
    setResult(null)

    const normalized = normalizeInvoiceRegistrationNumberForUi(registrationNumber)
    if (!normalized) {
      setInputError(INVOICE_REGISTRATION_NUMBER_ERROR)
      return
    }

    inFlightRef.current = true
    setIsChecking(true)
    try {
      const response = await checkInvoiceRegistry({
        registrationNumber: normalized,
        basisDate: basisDate || undefined,
      })

      if (!response.ok) {
        setErrorMessage(response.error.message)
        return
      }

      setResult(response.data)
      setRegistrationNumber(response.data.registrationNumber)
      onResult?.(response.data)
    } finally {
      inFlightRef.current = false
      setIsChecking(false)
    }
  }

  const vendorMismatch =
    result && result.name ? isVendorNameMismatch(vendorName, result.name) : false

  return (
    <section
      className={`invoice-registry-lookup${compact ? ' invoice-registry-lookup--compact' : ''}`}
      aria-label="インボイス登録確認"
    >
      {!compact ? <h2 className="invoice-registry-lookup__title">インボイス登録確認</h2> : null}

      <div className="invoice-registry-lookup__form">
        <label>
          インボイス登録番号
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="T1234567890123"
            value={registrationNumber}
            disabled={isChecking}
            onChange={(event) => setRegistrationNumber(event.target.value)}
          />
        </label>
        <label>
          判定基準日
          <input
            type="date"
            max={today}
            value={basisDate}
            disabled={isChecking}
            onChange={(event) => setBasisDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={isChecking || !registrationNumber.trim()}
          onClick={() => void handleCheck()}
        >
          {isChecking ? '確認中…' : '確認'}
        </button>
      </div>

      {inputError ? (
        <p className="accounting-warning" role="alert">
          {inputError}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="accounting-quote-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {result ? (
        <div className="invoice-registry-lookup__result">
          <p
            className={`invoice-registry-status-badge invoice-registry-status-badge--${result.status}`}
            role="status"
          >
            {INVOICE_REGISTRY_STATUS_LABELS[result.status]}
          </p>
          {result.environment === 'verification' ? (
            <p className="accounting-note" role="status">
              現在は国税庁の検証環境を利用しています。
            </p>
          ) : null}
          <dl className="invoice-registry-lookup__dl">
            <div>
              <dt>登録番号</dt>
              <dd>{result.registrationNumber}</dd>
            </div>
            <div>
              <dt>事業者名</dt>
              <dd>{formatDisplay(result.name)}</dd>
            </div>
            <div>
              <dt>主たる屋号</dt>
              <dd>{formatDisplay(result.tradeName)}</dd>
            </div>
            <div>
              <dt>所在地</dt>
              <dd>{formatDisplay(result.address)}</dd>
            </div>
            <div>
              <dt>登録年月日</dt>
              <dd>{formatDisplay(result.registrationDate)}</dd>
            </div>
            <div>
              <dt>失効年月日</dt>
              <dd>{formatDisplay(result.expirationDate)}</dd>
            </div>
            <div>
              <dt>取消年月日</dt>
              <dd>{formatDisplay(result.cancellationDate)}</dd>
            </div>
            <div>
              <dt>判定基準日</dt>
              <dd>{formatDisplay(result.basisDate)}</dd>
            </div>
            <div>
              <dt>国税庁情報の最終更新日</dt>
              <dd>{formatDisplay(result.ntaLastUpdateDate)}</dd>
            </div>
            <div>
              <dt>システム確認日時</dt>
              <dd>{formatDateTime(result.checkedAt)}</dd>
            </div>
          </dl>

          {vendorMismatch ? (
            <p className="accounting-warning" role="status">
              {INVOICE_REGISTRY_VENDOR_MISMATCH_WARNING}
            </p>
          ) : null}

          {result.name && onApplyVendorName ? (
            <button
              type="button"
              className="secondary-action"
              onClick={() => onApplyVendorName(result.name!)}
            >
              公表名称を仕入先へ反映
            </button>
          ) : null}

          {result.isQualifiedAtBasisDate ? (
            <p className="accounting-quote-success" role="status">
              判定基準日時点で登録有効です（確認済み）。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="invoice-registry-lookup__notes">
        <p className="accounting-note">{INVOICE_REGISTRY_DISCLAIMER}</p>
        <p className="accounting-note">{INVOICE_REGISTRY_TAX_NOTE}</p>
      </div>
    </section>
  )
}
