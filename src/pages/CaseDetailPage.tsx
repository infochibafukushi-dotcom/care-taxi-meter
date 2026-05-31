import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchCaseRecord } from '../services/caseRecords'
import { defaultMeterSettings, fetchMeterSettings } from '../services/meterSettings'
import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from '../utils/caseRecords'
import { formatElapsedTime } from '../utils/time'
import { downloadReceiptPdf } from '../utils/receiptPdf'

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'

const formatOptionalDateTime = (dateTime: string) =>
  dateTime ? formatCaseDateTime(dateTime) : '―'

const formatOptionalText = (value: string) =>
  value.trim() ? value : '未設定'

const formatDrivingDuration = (seconds: number, hasTimeData: boolean) =>
  hasTimeData ? formatElapsedTime(seconds) : '―'

type CaseDetailState = {
  caseRecord: StoredCaseRecord | null
  errorMessage: string
  isLoading: boolean
  meterSettings: MeterSettings
  settingsMessage: string
}

type ReceiptDialogState = {
  customerName: string
  issuerName: string
  receiptNote: string
  isOpen: boolean
}

export function CaseDetailPage() {
  const { caseRecordId } = useParams()
  const [state, setState] = useState<CaseDetailState>({
    caseRecord: null,
    errorMessage: '',
    isLoading: true,
    meterSettings: defaultMeterSettings,
    settingsMessage: '領収書設定を確認中です。',
  })
  const [receiptDialog, setReceiptDialog] = useState<ReceiptDialogState>({
    customerName: '',
    issuerName: '',
    receiptNote: defaultMeterSettings.receipt.defaultReceiptNote,
    isOpen: false,
  })

  useEffect(() => {
    let isMounted = true

    if (!caseRecordId) {
      return undefined
    }

    fetchCaseRecord(caseRecordId)
      .then((caseRecord) => {
        if (!isMounted) {
          return
        }

        setState((currentState) => ({
          ...currentState,
          caseRecord,
          errorMessage: caseRecord ? '' : '案件が見つかりませんでした。',
          isLoading: false,
        }))
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState((currentState) => ({
          ...currentState,
          caseRecord: null,
          errorMessage:
            error instanceof Error
              ? error.message
              : '案件詳細の取得に失敗しました。',
          isLoading: false,
        }))
      })

    return () => {
      isMounted = false
    }
  }, [caseRecordId])

  useEffect(() => {
    let isMounted = true

    fetchMeterSettings()
      .then((meterSettings) => {
        if (!isMounted) {
          return
        }

        setState((currentState) => ({
          ...currentState,
          meterSettings,
          settingsMessage: '会社情報・領収書設定を反映します。',
        }))
        setReceiptDialog((currentDialog) => ({
          ...currentDialog,
          issuerName: currentDialog.isOpen
            ? currentDialog.issuerName
            : meterSettings.receipt.issuerName,
          receiptNote: currentDialog.isOpen
            ? currentDialog.receiptNote
            : meterSettings.receipt.defaultReceiptNote,
        }))
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState((currentState) => ({
          ...currentState,
          settingsMessage:
            error instanceof Error
              ? `領収書設定を読み込めませんでした。${error.message}`
              : '領収書設定を読み込めませんでした。',
        }))
      })

    return () => {
      isMounted = false
    }
  }, [])

  const caseRecord = state.caseRecord
  const assistCharges = caseRecord?.assistCharges ?? []
  const caseAddressItems = caseRecord
    ? [
        { label: '伺い先住所', value: caseRecord.pickupAddress },
        { label: '送り先住所', value: caseRecord.dropoffAddress },
      ]
    : []
  const errorMessage = caseRecordId
    ? state.errorMessage
    : '案件IDが指定されていません。'
  const isLoading = caseRecordId ? state.isLoading : false

  const openReceiptDialog = () => {
    setReceiptDialog({
      customerName: '',
      issuerName: state.meterSettings.receipt.issuerName,
      receiptNote: state.meterSettings.receipt.defaultReceiptNote,
      isOpen: true,
    })
  }

  const closeReceiptDialog = () => {
    setReceiptDialog((currentDialog) => ({
      ...currentDialog,
      isOpen: false,
    }))
  }

  const handleReceiptDownload = async () => {
    if (!caseRecord) {
      return
    }

    await downloadReceiptPdf(caseRecord, state.meterSettings, {
      customerName: receiptDialog.customerName,
      issuerName: receiptDialog.issuerName,
      receiptNote: receiptDialog.receiptNote,
    })
    closeReceiptDialog()
  }

  return (
    <main className="page case-detail-page" aria-labelledby="case-detail-title">
      <section className="content-card case-detail-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Case Detail</p>
            <h1 id="case-detail-title">案件詳細</h1>
          </div>
          <Link className="text-link" to="/cases">
            一覧へ戻る
          </Link>
        </div>

        {isLoading ? (
          <p className="empty-note">Firestoreから案件詳細を取得中です。</p>
        ) : null}

        {errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {caseRecord ? (
          <>
            <p className="empty-note">{state.settingsMessage}</p>
            <button
              className="receipt-download-button"
              type="button"
              onClick={openReceiptDialog}
            >
              領収書発行
            </button>
            <div className="case-detail-grid" aria-label="案件詳細">
              <div>
                <span>案件番号</span>
                <strong>{caseRecord.caseNumber}</strong>
              </div>
              <div>
                <span>送迎開始時刻</span>
                <strong>{formatOptionalDateTime(caseRecord.startedAt)}</strong>
              </div>
              <div>
                <span>送迎終了時刻</span>
                <strong>{formatOptionalDateTime(caseRecord.endedAt)}</strong>
              </div>
              <div>
                <span>担当スタッフ</span>
                <strong>{formatOptionalText(caseRecord.staffName)}</strong>
              </div>
              <div>
                <span>使用車両</span>
                <strong>{formatOptionalText(caseRecord.vehicleName)}</strong>
              </div>
              <div>
                <span>車両ナンバー</span>
                <strong>{formatOptionalText(caseRecord.vehicleNumber)}</strong>
              </div>
              <div>
                <span>店舗</span>
                <strong>{formatOptionalText(caseRecord.storeName)}</strong>
              </div>
              <div>
                <span>運転時間（待機・付き添い除く）</span>
                <strong>
                  {formatDrivingDuration(
                    caseRecord.drivingSeconds,
                    Boolean(caseRecord.startedAt || caseRecord.endedAt),
                  )}
                </strong>
              </div>
              {caseAddressItems.map((addressItem) => (
                <div className="case-detail-address" key={addressItem.label}>
                  <span>{addressItem.label}</span>
                  <strong>{formatAddress(addressItem.value)}</strong>
                </div>
              ))}
              <div>
                <span>距離</span>
                <strong>{caseRecord.distanceKm.toFixed(3)} km</strong>
              </div>
              <div>
                <span>基本運賃</span>
                <strong>{formatFareYen(caseRecord.basicFareYen)}円</strong>
              </div>
              <div>
                <span>待機料金</span>
                <strong>{formatFareYen(caseRecord.waitingFareYen)}円</strong>
              </div>
              <div>
                <span>待機時間</span>
                <strong>{formatDrivingDuration(caseRecord.waitingSeconds, true)}</strong>
              </div>
              <div>
                <span>付き添い料金</span>
                <strong>{formatFareYen(caseRecord.escortFareYen)}円</strong>
              </div>
              <div>
                <span>付き添い時間</span>
                <strong>{formatDrivingDuration(caseRecord.accompanyingSeconds, true)}</strong>
              </div>
              <div className="case-detail-assist-charges">
                <span>介助料金</span>
                {assistCharges.length > 0 ? (
                  <div>
                    {assistCharges.map((assistCharge) => (
                      <p key={`${assistCharge.id}-${assistCharge.name}`}>
                        <span>{assistCharge.name}</span>
                        <strong>{formatFareYen(assistCharge.amount)}円</strong>
                      </p>
                    ))}
                    <p>
                      <span>合計</span>
                      <strong>{formatFareYen(caseRecord.careOptionFareYen)}円</strong>
                    </p>
                  </div>
                ) : (
                  <strong>{formatFareYen(caseRecord.careOptionFareYen)}円</strong>
                )}
              </div>
              <div>
                <span>実費</span>
                <strong>{formatFareYen(caseRecord.expenseFareYen)}円</strong>
              </div>
              <div>
                <span>合計金額</span>
                <strong>{formatFareYen(caseRecord.totalFareYen)}円</strong>
              </div>
              <div>
                <span>支払方法</span>
                <strong>{caseRecord.paymentMethod}</strong>
              </div>
            </div>
            <p className="osm-attribution">
              住所データ © Google
            </p>
          </>
        ) : null}
      </section>

      {receiptDialog.isOpen ? (
        <div className="receipt-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="receipt-dialog-title"
            aria-modal="true"
            className="receipt-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="eyebrow">Receipt</p>
                <h2 id="receipt-dialog-title">領収書発行設定</h2>
              </div>
            </header>

            <label>
              宛名（任意）
              <input
                placeholder="空欄でも発行できます"
                value={receiptDialog.customerName}
                onChange={(event) =>
                  setReceiptDialog((currentDialog) => ({
                    ...currentDialog,
                    customerName: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              発行担当者
              <input
                value={receiptDialog.issuerName}
                onChange={(event) =>
                  setReceiptDialog((currentDialog) => ({
                    ...currentDialog,
                    issuerName: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              但し書き
              <textarea
                placeholder="空欄でも発行できます"
                value={receiptDialog.receiptNote}
                onChange={(event) =>
                  setReceiptDialog((currentDialog) => ({
                    ...currentDialog,
                    receiptNote: event.target.value,
                  }))
                }
              />
            </label>

            <div className="receipt-dialog-actions">
              <button
                className="receipt-dialog-secondary"
                type="button"
                onClick={closeReceiptDialog}
              >
                キャンセル
              </button>
              <button
                className="receipt-dialog-primary"
                type="button"
                onClick={() => {
                  void handleReceiptDownload()
                }}
              >
                PDF出力
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
