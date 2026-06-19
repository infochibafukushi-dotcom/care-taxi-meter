import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  cancelCaseRecord,
  recordReceiptReissue,
  recordSettlementAdjustment,
  restoreCaseRecord,
  softDeleteCaseRecord,
  fetchCaseRecord,
  updateCaseRecordEditableValues,
} from '../services/caseRecords'
import { defaultMeterSettings, fetchMeterSettings } from '../services/meterSettings'
import { useWorkSession } from '../hooks/useWorkSession'
import { loadAuthStaffSession } from '../services/authSession'
import { tenantAccessScopeFromSessionSource, tenantScopeFromSession } from '../services/tenancy'
import type { CaseRecordEditableValues, StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import type { PaymentMethod, TaxiTicket } from '../types/case'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from '../utils/caseRecords'
import { formatElapsedTime } from '../utils/time'
import { downloadReceiptPdf } from '../utils/receiptPdf'
import { downloadStatementPdf } from '../utils/statementPdf'
import { canCancelCaseRecord, canDeleteCaseRecord, canManageCaseRecord, canRestoreCaseRecord } from '../types/permissions'

const paymentMethodOptions: PaymentMethod[] = ['現金', 'クレジット', 'QR決済', '請求書', 'その他']

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'


const formatOptionalText = (value: string) =>
  value.trim() ? value : '未設定'

const formatDrivingDuration = (seconds: number, hasTimeData: boolean) =>
  hasTimeData ? formatElapsedTime(seconds) : '―'

const toEditableValues = (caseRecord: StoredCaseRecord): CaseRecordEditableValues => ({
  careOptionFareYen: caseRecord.careOptionFareYen,
  dispatchFareYen: caseRecord.dispatchFareYen,
  specialVehicleFareYen: caseRecord.specialVehicleFareYen,
  expenseFareYen: caseRecord.expenseFareYen,
  paymentMethod: caseRecord.paymentMethod,
  remarks: caseRecord.remarks,
})

const toNumberInputValue = (value: number) => String(Math.max(Math.round(value), 0))

const formatChangeDateTime = (changedAt: string) => {
  const date = new Date(changedAt)
  return Number.isNaN(date.getTime()) ? '日時未記録' : formatCaseDateTime(changedAt)
}

type CaseDetailState = {
  caseRecord: StoredCaseRecord | null
  errorMessage: string
  isLoading: boolean
  meterSettings: MeterSettings
  settingsMessage: string
  statusMessage: string
}

type ReceiptDialogState = {
  customerName: string
  issuerName: string
  receiptNote: string
  reissueReason: string
  isOpen: boolean
}

type AdjustmentState = {
  amount: number
  isOpen: boolean
  municipality: string
  reason: string
  receiptName: string
  ticketNumber: string
}

export function CaseDetailPage() {
  const navigate = useNavigate()
  const workSession = useWorkSession()
  const authSession = useMemo(() => loadAuthStaffSession(), [])
  const sessionSource = workSession.currentSession ?? authSession
  const accessScope = useMemo(
    () => tenantAccessScopeFromSessionSource(sessionSource),
    [sessionSource],
  )
  const currentScope = tenantScopeFromSession(sessionSource)
  const currentFranchiseeId = currentScope.franchiseeId
  const currentStoreId = currentScope.storeId
  const { caseRecordId } = useParams()
  const currentSession = workSession.currentSession
  const currentRole = accessScope.role ?? ''
  const isAdmin = canManageCaseRecord(currentRole)
  const canCancel = canCancelCaseRecord(currentRole)
  const canDelete = canDeleteCaseRecord(currentRole)
  const canRestore = canRestoreCaseRecord(currentRole)
  const auditActor = currentSession
    ? { userId: currentSession.staffId, userName: currentSession.staffName, role: currentSession.staffRole }
    : null
  const [state, setState] = useState<CaseDetailState>({
    caseRecord: null,
    errorMessage: '',
    isLoading: true,
    meterSettings: defaultMeterSettings,
    settingsMessage: '領収書設定を確認中です。',
    statusMessage: '',
  })
  const [receiptDialog, setReceiptDialog] = useState<ReceiptDialogState>({
    customerName: '',
    issuerName: '',
    receiptNote: defaultMeterSettings.receipt.defaultReceiptNote,
    reissueReason: '領収書再発行',
    isOpen: false,
  })
  const [isEditing, setIsEditing] = useState(false)
  const [adjustment, setAdjustment] = useState<AdjustmentState>({
    amount: 0,
    isOpen: false,
    municipality: '',
    reason: '精算後タクシー券提示',
    receiptName: '',
    ticketNumber: '',
  })
  const [editValues, setEditValues] = useState<CaseRecordEditableValues>({
    careOptionFareYen: 0,
    dispatchFareYen: 0,
    specialVehicleFareYen: 0,
    expenseFareYen: 0,
    paymentMethod: '未設定',
    remarks: '',
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
        if (caseRecord) {
          setEditValues(toEditableValues(caseRecord))
        }
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
    if (!receiptDialog.isOpen) {
      return undefined
    }

    const scrollY = window.scrollY
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousPosition = body.style.position
    const previousTop = body.style.top
    const previousWidth = body.style.width

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    return () => {
      body.style.overflow = previousOverflow
      body.style.position = previousPosition
      body.style.top = previousTop
      body.style.width = previousWidth
      window.scrollTo(0, scrollY)
    }
  }, [receiptDialog.isOpen])

  useEffect(() => {
    let isMounted = true

    fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
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
  }, [currentFranchiseeId, currentStoreId])

  const caseRecord = state.caseRecord
  const isSameAccountingDate = caseRecord
    ? new Date(caseRecord.closedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) ===
      new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
    : false
  const canAdjustSettlement = Boolean(currentSession && caseRecord && (isAdmin || isSameAccountingDate))
  const assistCharges = caseRecord?.assistCharges ?? []
  const dispatchCharges = caseRecord?.dispatchCharges ?? []
  const expenseCharges = caseRecord?.expenseCharges ?? []
  const taxiTickets = caseRecord?.taxiTickets ?? []
  const payments = caseRecord?.payments ?? []
  const caseAddressItems = caseRecord
    ? [
        { label: '出発地', value: caseRecord.pickupAddress },
        { label: '到着地', value: caseRecord.dropoffAddress },
      ]
    : []
  const errorMessage = caseRecordId
    ? state.errorMessage
    : '案件IDが指定されていません。'
  const isLoading = caseRecordId ? state.isLoading : false

  const openReceiptDialog = async () => {
    const latestMeterSettings = await fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
    setState((currentState) => ({ ...currentState, meterSettings: latestMeterSettings }))
    setReceiptDialog({
      customerName: '',
      issuerName: latestMeterSettings.receipt.issuerName,
      receiptNote: latestMeterSettings.receipt.defaultReceiptNote,
      reissueReason: '領収書再発行',
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

    const reason = receiptDialog.reissueReason.trim() || '領収書再発行'
    const updatedRecord = await recordReceiptReissue(caseRecord, { actor: auditActor, reason })
    setState((currentState) => ({ ...currentState, caseRecord: updatedRecord, statusMessage: '領収書再発行履歴を保存しました。' }))
    const latestMeterSettings = await fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
    await downloadReceiptPdf(updatedRecord, latestMeterSettings, {
      customerName: receiptDialog.customerName,
      issuerName: receiptDialog.issuerName || latestMeterSettings.receipt.issuerName,
      isReissue: true,
      receiptNote: receiptDialog.receiptNote || latestMeterSettings.receipt.defaultReceiptNote,
    })
    closeReceiptDialog()
  }

  const handleStatementDownload = async () => {
    if (!caseRecord) {
      return
    }

    const reason = receiptDialog.reissueReason.trim() || '利用明細再発行'
    const updatedRecord = await recordReceiptReissue(caseRecord, { actor: auditActor, reason })
    setState((currentState) => ({ ...currentState, caseRecord: updatedRecord, statusMessage: '利用明細再発行履歴を保存しました。' }))
    const latestMeterSettings = await fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
    await downloadStatementPdf(updatedRecord, latestMeterSettings, {
      customerName: receiptDialog.customerName,
      issuerName: receiptDialog.issuerName || latestMeterSettings.receipt.issuerName,
      isReissue: true,
      receiptNote: receiptDialog.receiptNote || latestMeterSettings.receipt.defaultReceiptNote,
    })
    closeReceiptDialog()
  }

  const updateNumberEditValue = (
    key: 'careOptionFareYen' | 'dispatchFareYen' | 'specialVehicleFareYen' | 'expenseFareYen',
    value: string,
  ) => {
    setEditValues((currentValues) => ({
      ...currentValues,
      [key]: Math.max(Number(value) || 0, 0),
    }))
  }

  const handleSave = async () => {
    if (!caseRecord) {
      return
    }

    setState((currentState) => ({ ...currentState, statusMessage: '変更を保存中です。' }))
    try {
      const reason = window.prompt('修正理由を入力してください。', '明細修正')
      if (!reason) {
        setState((currentState) => ({ ...currentState, statusMessage: '修正理由が未入力のため保存しませんでした。' }))
        return
      }

      const updatedRecord = await updateCaseRecordEditableValues(caseRecord, editValues, auditActor, reason)
      setState((currentState) => ({
        ...currentState,
        caseRecord: updatedRecord,
        errorMessage: '',
        statusMessage: '変更を保存しました。売上分析へ反映されます。',
      }))
      setEditValues(toEditableValues(updatedRecord))
      setIsEditing(false)
    } catch (error) {
      setState((currentState) => ({
        ...currentState,
        statusMessage: '',
        errorMessage:
          error instanceof Error ? error.message : '案件の保存に失敗しました。',
      }))
    }
  }

  const handleCancelCase = async () => {
    if (!caseRecord || caseRecord.status === 'canceled') {
      return
    }

    const reason = window.prompt('キャンセル理由を入力してください。', '利用者都合')
    if (!reason) {
      return
    }

    if (!window.confirm('この案件をキャンセル済に変更しますか。売上集計から除外されます。')) {
      return
    }

    const updatedRecord = await cancelCaseRecord(caseRecord, { actor: auditActor, reason })
    setState((currentState) => ({
      ...currentState,
      caseRecord: updatedRecord,
      statusMessage: '案件をキャンセル済にしました。',
    }))
  }

  const handleStartGuidance = () => {
    if (!caseRecord) {
      return
    }

    if (!currentSession) {
      setState((currentState) => ({
        ...currentState,
        statusMessage: '出勤してから案内開始してください。',
      }))
      return
    }

    const params = new URLSearchParams({ caseRecordId: caseRecord.id })
    if (caseRecord.vehicleId) {
      params.set('vehicleId', caseRecord.vehicleId)
    }

    navigate(`/case?${params.toString()}`)
  }

  const openAdjustment = () => {
    if (!caseRecord) {
      return
    }
    setAdjustment({
      amount: 0,
      isOpen: true,
      municipality: '',
      reason: '精算後タクシー券提示',
      receiptName: caseRecord.receiptName,
      ticketNumber: '',
    })
  }

  const handleSettlementAdjustment = async () => {
    if (!caseRecord) {
      return
    }
    const reason = adjustment.reason.trim()
    if (!reason) {
      setState((currentState) => ({ ...currentState, statusMessage: '訂正理由を入力してください。' }))
      return
    }
    const ticket: TaxiTicket | null = adjustment.municipality.trim() && adjustment.amount > 0
      ? {
          amount: Math.max(Math.round(adjustment.amount), 0),
          id: `adjustment-ticket-${Date.now()}`,
          municipality: adjustment.municipality.trim(),
          ticketNumber: adjustment.ticketNumber.trim(),
        }
      : null
    const nextTickets = ticket ? [...caseRecord.taxiTickets, ticket] : caseRecord.taxiTickets
    const updatedRecord = await recordSettlementAdjustment(caseRecord, {
      actor: auditActor,
      reason,
      receiptName: adjustment.receiptName,
      taxiTickets: nextTickets,
    })
    setState((currentState) => ({
      ...currentState,
      caseRecord: updatedRecord,
      statusMessage: '訂正処理を保存しました。元精算データは変更せず、訂正履歴と監査ログへ記録しました。',
    }))
    setAdjustment((current) => ({ ...current, isOpen: false }))

    const latestMeterSettings = await fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
    const latestAdjustment = updatedRecord.settlementAdjustments.at(-1)
    if (latestAdjustment) {
      await downloadReceiptPdf({
        ...updatedRecord,
        receiptName: latestAdjustment.receiptName,
        taxiTickets: latestAdjustment.taxiTickets,
        taxiTicketAmountYen: latestAdjustment.taxiTickets.reduce((total, currentTicket) => total + currentTicket.amount, 0),
        totalFareYen: latestAdjustment.adjustedTotalFareYen,
        payments: updatedRecord.payments.map((payment) =>
          payment.type === '現金'
            ? { ...payment, amount: Math.max(payment.amount - latestAdjustment.refundYen, 0) }
            : payment,
        ),
      }, latestMeterSettings, {
        customerName: latestAdjustment.receiptName,
        issuerName: latestMeterSettings.receipt.issuerName,
        isReissue: true,
        receiptNote: `訂正領収書: ${latestAdjustment.reason} / 返金 ${formatFareYen(latestAdjustment.refundYen)}円`,
      })
    }
  }

  const handleSoftDelete = async () => {
    if (!caseRecord || !canDelete || caseRecord.deleted) {
      return
    }

    const reason = window.prompt(
      "削除理由を入力してください（入力ミス / 重複登録 / キャンセル / その他）。",
      "入力ミス",
    )
    const allowedReasons = ["入力ミス", "重複登録", "キャンセル", "その他"]
    if (!reason || !allowedReasons.includes(reason)) {
      setState((currentState) => ({
        ...currentState,
        statusMessage: "削除理由は 入力ミス / 重複登録 / キャンセル / その他 から選択してください。",
      }))
      return
    }

    if (!window.confirm("この案件を削除済みに変更しますか。物理削除は行いません。")) {
      return
    }

    const updatedRecord = await softDeleteCaseRecord(caseRecord, { actor: auditActor, reason })
    setState((currentState) => ({
      ...currentState,
      caseRecord: updatedRecord,
      statusMessage: "案件を削除済みにしました。監査ログへ記録しました。",
    }))
  }


  const handleRestoreCase = async () => {
    if (!caseRecord || !canRestore || !caseRecord.deleted) {
      return
    }

    const reason = window.prompt('復元理由を入力してください。', '削除取り消し')
    if (!reason) {
      return
    }

    const updatedRecord = await restoreCaseRecord(caseRecord, { actor: auditActor, reason })
    setState((currentState) => ({
      ...currentState,
      caseRecord: updatedRecord,
      statusMessage: '案件を復元しました。監査ログへ記録しました。',
    }))
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

        {state.statusMessage ? (
          <p className="save-note" role="status">{state.statusMessage}</p>
        ) : null}

        {caseRecord ? (
          <>
            <p className="empty-note">{state.settingsMessage}</p>
            <div className="case-detail-actions">
              <button
                className="primary-action"
                type="button"
                disabled={!currentSession || caseRecord.deleted || caseRecord.status === 'canceled'}
                onClick={handleStartGuidance}
              >
                案内開始
              </button>
              <button className="receipt-download-button" type="button" onClick={openReceiptDialog}>
                領収書再発行 / 利用明細再発行
              </button>
              <button
                className="case-detail-secondary-button"
                type="button"
                disabled={!canAdjustSettlement || caseRecord.deleted || caseRecord.status === 'canceled'}
                onClick={openAdjustment}
              >
                訂正処理
              </button>
              {isAdmin ? (
                <>
                  <button className="case-detail-secondary-button" type="button" disabled={caseRecord.deleted} onClick={() => {
                    setEditValues(toEditableValues(caseRecord))
                    setIsEditing((current) => !current)
                  }}>
                    {isEditing ? '編集を閉じる' : '編集'}
                  </button>
                </>
              ) : null}
              {canCancel ? (
                <button
                  className="case-detail-danger-button"
                  type="button"
                  disabled={caseRecord.status === 'canceled' || caseRecord.deleted}
                  onClick={() => { void handleCancelCase() }}
                >
                  キャンセル
                </button>
              ) : null}
              {canDelete && !caseRecord.deleted ? (
                <button className="case-detail-danger-button case-detail-danger-button--delete" type="button" onClick={() => { void handleSoftDelete() }}>
                  削除済みにする
                </button>
              ) : null}
              {canRestore && caseRecord.deleted ? (
                <button className="case-detail-secondary-button" type="button" onClick={() => { void handleRestoreCase() }}>
                  復元する
                </button>
              ) : null}
            </div>

            {caseRecord.deleted ? (
              <p className="case-error">【削除済】削除理由: {caseRecord.deleteReason || '未記録'}。売上集計から除外されます。</p>
            ) : null}

            {caseRecord.status === 'canceled' ? (
              <p className="case-status-badge">キャンセル済（売上集計対象外） 理由: {caseRecord.cancelReason || '未記録'}</p>
            ) : null}

            {isEditing ? (
              <section className="case-edit-panel" aria-labelledby="case-edit-title">
                <h2 id="case-edit-title">案件修正</h2>
                <div className="case-edit-grid">
                  <label>
                    介助料金
                    <input type="number" min="0" value={toNumberInputValue(editValues.careOptionFareYen)} onChange={(event) => updateNumberEditValue('careOptionFareYen', event.target.value)} />
                  </label>
                  <label>
                    予約迎車料金
                    <input type="number" min="0" value={toNumberInputValue(editValues.dispatchFareYen)} onChange={(event) => updateNumberEditValue('dispatchFareYen', event.target.value)} />
                  </label>
                  <label>
                    特殊車両料金
                    <input type="number" min="0" value={toNumberInputValue(editValues.specialVehicleFareYen)} onChange={(event) => updateNumberEditValue('specialVehicleFareYen', event.target.value)} />
                  </label>
                  <label>
                    実費
                    <input type="number" min="0" value={toNumberInputValue(editValues.expenseFareYen)} onChange={(event) => updateNumberEditValue('expenseFareYen', event.target.value)} />
                  </label>
                  <label>
                    支払方法
                    <select value={editValues.paymentMethod} onChange={(event) => setEditValues((currentValues) => ({ ...currentValues, paymentMethod: event.target.value }))}>
                      <option value="未設定">未設定</option>
                      {paymentMethodOptions.map((paymentMethod) => (
                        <option key={paymentMethod} value={paymentMethod}>{paymentMethod}</option>
                      ))}
                    </select>
                  </label>
                  <label className="case-edit-wide">
                    備考
                    <textarea value={editValues.remarks} onChange={(event) => setEditValues((currentValues) => ({ ...currentValues, remarks: event.target.value }))} />
                  </label>
                </div>
                <div className="receipt-dialog-actions">
                  <button className="receipt-dialog-secondary" type="button" onClick={() => {
                    setEditValues(toEditableValues(caseRecord))
                    setIsEditing(false)
                  }}>
                    取り消し
                  </button>
                  <button className="receipt-dialog-primary" type="button" onClick={() => { void handleSave() }}>
                    保存
                  </button>
                </div>
              </section>
            ) : null}

            {adjustment.isOpen ? (
              <section className="case-edit-panel" aria-labelledby="settlement-adjustment-title">
                <h2 id="settlement-adjustment-title">訂正処理</h2>
                <p className="empty-note">元データは直接編集せず、訂正履歴・監査ログとして保存します。タクシー券追加時は返金額を自動計算し、訂正領収書を発行します。</p>
                <div className="case-edit-grid">
                  <label>
                    訂正理由
                    <input value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} />
                  </label>
                  <label>
                    領収書宛名
                    <input value={adjustment.receiptName} onChange={(event) => setAdjustment((current) => ({ ...current, receiptName: event.target.value }))} />
                  </label>
                  <label>
                    自治体名
                    <input value={adjustment.municipality} onChange={(event) => setAdjustment((current) => ({ ...current, municipality: event.target.value }))} />
                  </label>
                  <label>
                    タクシー券番号
                    <input value={adjustment.ticketNumber} onChange={(event) => setAdjustment((current) => ({ ...current, ticketNumber: event.target.value }))} />
                  </label>
                  <label>
                    タクシー券金額
                    <input min="0" type="number" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: Math.max(Number(event.target.value) || 0, 0) }))} />
                  </label>
                </div>
                <div className="receipt-dialog-actions">
                  <button className="receipt-dialog-secondary" type="button" onClick={() => setAdjustment((current) => ({ ...current, isOpen: false }))}>
                    閉じる
                  </button>
                  <button className="receipt-dialog-primary" type="button" onClick={() => { void handleSettlementAdjustment() }}>
                    訂正保存・訂正領収書発行
                  </button>
                </div>
              </section>
            ) : null}

            <div className="case-detail-grid" aria-label="案件詳細">
              <div>
                <span>案件番号</span>
                <strong>{caseRecord.caseNumber}</strong>
              </div>
              <div>
                <span>日時</span>
                <strong>{formatCaseDateTime(caseRecord.closedAt)}</strong>
              </div>
              <div>
                <span>個人情報</span>
                <strong>顧客氏名・電話番号・介護情報は保存しません</strong>
              </div>
              {caseAddressItems.map((addressItem) => (
                <div className="case-detail-address" key={addressItem.label}>
                  <span>{addressItem.label}</span>
                  <strong>{formatAddress(addressItem.value)}</strong>
                </div>
              ))}
              <div>
                <span>運賃距離</span>
                <strong>{caseRecord.chargeableDistanceKm.toFixed(3)} km</strong>
              </div>
              <div>
                <span>営業距離</span>
                <strong>{caseRecord.businessDistanceKm.toFixed(3)} km</strong>
              </div>
              <div>
                <span>運行時間</span>
                <strong>{formatDrivingDuration(caseRecord.drivingSeconds, Boolean(caseRecord.startedAt || caseRecord.endedAt))}</strong>
              </div>
              <div>
                <span>基本運賃</span>
                <strong>{formatFareYen(caseRecord.basicFareYen)}円</strong>
              </div>
              <div>
                <span>時間距離併用運賃</span>
                <strong>{formatFareYen(caseRecord.meterTimeFareYen)}円</strong>
              </div>
              <div>
                <span>待機/付き添い料金</span>
                <strong>{formatFareYen(caseRecord.waitingFareYen + caseRecord.escortFareYen)}円</strong>
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
              <div className="case-detail-assist-charges">
                <span>予約迎車料金</span>
                {dispatchCharges.length > 0 ? (
                  <div>
                    {dispatchCharges.map((dispatchCharge) => (
                      <p key={`${dispatchCharge.id}-${dispatchCharge.name}`}>
                        <span>{dispatchCharge.name}</span>
                        <strong>{formatFareYen(dispatchCharge.amount)}円</strong>
                      </p>
                    ))}
                    <p>
                      <span>合計</span>
                      <strong>{formatFareYen(caseRecord.dispatchFareYen)}円</strong>
                    </p>
                  </div>
                ) : (
                  <strong>{formatFareYen(caseRecord.dispatchFareYen)}円</strong>
                )}
              </div>
              <div className="case-detail-assist-charges">
                <span>実費</span>
                {expenseCharges.length > 0 ? (
                  <div>
                    {expenseCharges.map((expenseCharge) => (
                      <p key={`${expenseCharge.id}-${expenseCharge.name}`}>
                        <span>{expenseCharge.name}</span>
                        <strong>{formatFareYen(expenseCharge.amount)}円</strong>
                      </p>
                    ))}
                    <p>
                      <span>合計</span>
                      <strong>{formatFareYen(caseRecord.expenseFareYen)}円</strong>
                    </p>
                  </div>
                ) : (
                  <strong>{formatFareYen(caseRecord.expenseFareYen)}円</strong>
                )}
              </div>
              <div>
                <span>割引</span>
                <strong>{caseRecord.isDisabilityDiscount ? `${formatFareYen(caseRecord.disabilityDiscountAmount)}円` : '未適用'}</strong>
              </div>
              <div className="case-detail-assist-charges">
                <span>タクシー券</span>
                {taxiTickets.length > 0 ? (
                  <div>
                    {taxiTickets.map((ticket) => (
                      <p key={ticket.id}>
                        <span>{ticket.municipality} {ticket.ticketNumber || '番号未入力'}</span>
                        <strong>{formatFareYen(ticket.amount)}円</strong>
                      </p>
                    ))}
                    <p>
                      <span>適用額</span>
                      <strong>{formatFareYen(caseRecord.taxiTicketAmountYen)}円</strong>
                    </p>
                  </div>
                ) : (
                  <strong>未使用</strong>
                )}
              </div>
              <div>
                <span>支払方法</span>
                <strong>{caseRecord.paymentMethod}</strong>
              </div>
              <div className="case-detail-assist-charges">
                <span>支払内訳</span>
                {payments.length > 0 ? (
                  <div>
                    {payments.map((payment) => (
                      <p key={payment.id}>
                        <span>{payment.type}</span>
                        <strong>{formatFareYen(payment.amount)}円</strong>
                      </p>
                    ))}
                  </div>
                ) : (
                  <strong>{caseRecord.paymentMethod}</strong>
                )}
              </div>
              <div>
                <span>合計金額</span>
                <strong>{formatFareYen(caseRecord.totalFareYen)}円</strong>
              </div>
              <div className="case-detail-address">
                <span>備考</span>
                <strong>{formatOptionalText(caseRecord.remarks)}</strong>
              </div>
            </div>

            <section className="case-change-history" aria-labelledby="case-change-history-title">
              <h2 id="case-change-history-title">変更履歴</h2>
              {caseRecord.changeHistory.length > 0 ? (
                <div className="case-change-history-list">
                  {caseRecord.changeHistory.map((changeEntry, index) => (
                    <article key={`${changeEntry.changedAt}-${changeEntry.fieldLabel}-${index}`}>
                      <time>{formatChangeDateTime(changeEntry.changedAt)}</time>
                      <strong>{changeEntry.fieldLabel}</strong>
                      <p>{changeEntry.previousValue}→{changeEntry.nextValue}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-note">変更履歴はありません。</p>
              )}
            </section>

            <section className="case-change-history" aria-labelledby="case-reissue-history-title">
              <h2 id="case-reissue-history-title">領収書再発行履歴</h2>
              {caseRecord.receiptReissues.length > 0 ? (
                <div className="case-change-history-list">
                  {caseRecord.receiptReissues.map((reissue, index) => (
                    <article key={`${reissue.reissuedAt}-${index}`}>
                      <time>{formatChangeDateTime(reissue.reissuedAt)}</time>
                      <strong>再発行</strong>
                      <p>{reissue.reason || '理由未記録'} / 実行者: {reissue.reissuedBy || '未記録'}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-note">領収書再発行履歴はありません。</p>
              )}
            </section>

            <section className="case-change-history" aria-labelledby="settlement-adjustment-history-title">
              <h2 id="settlement-adjustment-history-title">訂正処理履歴</h2>
              {caseRecord.settlementAdjustments.length > 0 ? (
                <div className="case-change-history-list">
                  {caseRecord.settlementAdjustments.map((entry, index) => (
                    <article key={`${entry.adjustedAt}-${index}`}>
                      <time>{formatChangeDateTime(entry.adjustedAt)}</time>
                      <strong>{entry.reason}</strong>
                      <p>
                        訂正前 {formatFareYen(entry.previousTotalFareYen)}円 → 訂正後 {formatFareYen(entry.adjustedTotalFareYen)}円 / 返金 {formatFareYen(entry.refundYen)}円
                      </p>
                      <p>宛名: {entry.receiptName || '未設定'} / タクシー券: {entry.taxiTickets.map((ticket) => `${ticket.municipality} ${ticket.ticketNumber || '番号未入力'} ${formatFareYen(ticket.amount)}円`).join('、') || '変更なし'}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-note">訂正処理履歴はありません。</p>
              )}
            </section>

            <p className="osm-attribution">住所データ © Google</p>
          </>
        ) : null}
      </section>

      {receiptDialog.isOpen ? (
        <div className="receipt-dialog-backdrop" role="presentation">
          <section aria-labelledby="receipt-dialog-title" aria-modal="true" className="receipt-dialog" role="dialog">
            <header>
              <div>
                <p className="eyebrow">Receipt</p>
                <h2 id="receipt-dialog-title">再発行設定</h2>
              </div>
            </header>

            <label>
              宛名（任意・保存しません）
              <input placeholder="空欄でも発行できます" value={receiptDialog.customerName} onChange={(event) => setReceiptDialog((currentDialog) => ({ ...currentDialog, customerName: event.target.value }))} />
            </label>

            <label>
              発行担当者
              <input value={receiptDialog.issuerName} onChange={(event) => setReceiptDialog((currentDialog) => ({ ...currentDialog, issuerName: event.target.value }))} />
            </label>

            <label>
              但し書き
              <textarea placeholder="空欄でも発行できます" value={receiptDialog.receiptNote} onChange={(event) => setReceiptDialog((currentDialog) => ({ ...currentDialog, receiptNote: event.target.value }))} />
            </label>

            <label>
              再発行理由
              <input value={receiptDialog.reissueReason} onChange={(event) => setReceiptDialog((currentDialog) => ({ ...currentDialog, reissueReason: event.target.value }))} />
            </label>

            <div className="receipt-dialog-actions receipt-dialog-actions--wrap">
              <button className="receipt-dialog-secondary" type="button" onClick={closeReceiptDialog}>閉じる</button>
              <button className="receipt-dialog-primary" type="button" onClick={() => { void handleStatementDownload() }}>利用明細再発行</button>
              <button className="receipt-dialog-primary" type="button" onClick={() => { void handleReceiptDownload() }}>領収書再発行</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
