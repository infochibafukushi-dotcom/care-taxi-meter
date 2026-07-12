import type { DiscountSettings, FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import {
  calculateSettlementSummary,
  SETTLEMENT_PAYMENT_METHODS,
} from '../../services/settlementSummary'
import type { PaymentMethod, TaxiTicket } from '../../types/case'

type SettlementPanelProps = {
  breakdown: FareBreakdown
  businessDistanceKm: number
  chargeableDistanceKm: number
  hideDistanceBreakdown?: boolean
  isDisabilityDiscount: boolean
  settlementDiscount: DiscountSettings
  paymentAmounts: Record<PaymentMethod, number>
  paymentMethod: PaymentMethod
  receiptName: string
  saveMessage: string
  saveState: 'error' | 'idle' | 'saved' | 'saving'
  taxiTickets: TaxiTicket[]
  onAddTaxiTicket: (ticket: Omit<TaxiTicket, 'id'>) => void
  onDisabilityDiscountChange: (isDisabilityDiscount: boolean) => void
  onSettlementDiscountChange: (discount: DiscountSettings) => void
  onPaymentAmountChange: (paymentMethod: PaymentMethod, amount: number) => void
  onPaymentMethodChange: (paymentMethod: PaymentMethod) => void
  onReceiptNameChange: (receiptName: string) => void
  onRemoveTaxiTicket: (ticketId: string) => void
  onSettlePaymentRemainder: () => void
}

export function SettlementPanel({
  breakdown,
  businessDistanceKm,
  chargeableDistanceKm,
  hideDistanceBreakdown = false,
  isDisabilityDiscount,
  settlementDiscount,
  paymentAmounts,
  paymentMethod,
  receiptName,
  saveMessage,
  saveState,
  taxiTickets,
  onAddTaxiTicket,
  onDisabilityDiscountChange,
  onSettlementDiscountChange,
  onPaymentAmountChange,
  onPaymentMethodChange,
  onReceiptNameChange,
  onRemoveTaxiTicket,
  onSettlePaymentRemainder,
}: SettlementPanelProps) {
  const settlementSummary = calculateSettlementSummary({
    grossAmountYen: breakdown.grossFareYen,
    discountAmountYen: breakdown.disabilityDiscountAmount,
    taxiTicketAmountYen: breakdown.taxiTicketAmountYen,
    finalChargeAmountYen: breakdown.totalFareYen,
    paymentAmounts,
  })

  const showTimeDiscount =
    breakdown.meterMode === 'time' &&
    breakdown.timeMeter?.timeDiscountEnabled === true

  const settlementLineItems = breakdown.lineItems.filter((item) => {
    if (showTimeDiscount && item.label === '時間制運賃') {
      return false
    }

    // 割引行は上部サマリーで表示するため、内訳の重複を避ける
    if (item.amountYen < 0 && item.label === breakdown.discountName) {
      return false
    }

    return item.amountYen !== 0
  })

  return (
    <section className="settlement-panel" aria-labelledby="settlement-title">
      <h2 id="settlement-title">精算画面</h2>
      <div className="settlement-total">
        <span>請求額</span>
        <strong>{formatFareYen(settlementSummary.finalChargeAmountYen)}円</strong>
      </div>
      <div className="settlement-lines" aria-label="請求額サマリー">
        <div>
          <span>割引前総額</span>
          <strong>{formatFareYen(settlementSummary.grossAmountYen)}円</strong>
        </div>
        {settlementSummary.discountAmountYen > 0 ? (
          <div>
            <span>
              {breakdown.discountName}
              （
              {breakdown.discountMethod === 'percentage'
                ? `${breakdown.discountValue}％`
                : `${formatFareYen(breakdown.discountValue)}円`}
              ）
            </span>
            <strong>▲{formatFareYen(settlementSummary.discountAmountYen)}円</strong>
          </div>
        ) : null}
        <div>
          <span>最終請求額</span>
          <strong>{formatFareYen(settlementSummary.finalChargeAmountYen)}円</strong>
        </div>
      </div>
      {hideDistanceBreakdown ? null : (
        <div className="settlement-lines" aria-label="距離内訳">
          <div>
            <span>運賃距離</span>
            <strong>{chargeableDistanceKm.toFixed(3)}km</strong>
          </div>
          <div>
            <span>営業距離</span>
            <strong>{businessDistanceKm.toFixed(3)}km</strong>
          </div>
        </div>
      )}
      <label className="settlement-control">
        宛名（PDF発行時のみ使用・案件ログに保存しません）
        <input
          placeholder="空欄・上様・任意入力可"
          type="text"
          value={receiptName}
          onChange={(event) => onReceiptNameChange(event.target.value)}
        />
      </label>
      <label className="settlement-check">
        <input
          checked={isDisabilityDiscount}
          type="checkbox"
          onChange={(event) => onDisabilityDiscountChange(event.target.checked)}
        />
        割引を適用する
      </label>
      {isDisabilityDiscount ? (
        <fieldset className="payment-methods">
          <legend>割引設定</legend>
          <label>
            割引名
            <input
              type="text"
              value={settlementDiscount.name}
              onChange={(event) => onSettlementDiscountChange({ ...settlementDiscount, name: event.target.value })}
            />
          </label>
          <label>
            <input
              checked={settlementDiscount.method === 'percentage'}
              name="settlement-discount-method"
              type="radio"
              onChange={() => onSettlementDiscountChange({ ...settlementDiscount, method: 'percentage', value: Math.min(settlementDiscount.value, 100) })}
            />
            割合割引（％）
          </label>
          <label>
            <input
              checked={settlementDiscount.method === 'fixed'}
              name="settlement-discount-method"
              type="radio"
              onChange={() => onSettlementDiscountChange({ ...settlementDiscount, method: 'fixed' })}
            />
            金額割引（円）
          </label>
          <label>
            {settlementDiscount.method === 'percentage' ? '割合' : '金額'}
            <input
              min="0"
              max={settlementDiscount.method === 'percentage' ? '100' : undefined}
              step="1"
              type="number"
              value={settlementDiscount.value}
              onChange={(event) => {
                const rawValue = Math.max(Number(event.target.value) || 0, 0)
                const value = settlementDiscount.method === 'percentage' ? Math.min(rawValue, 100) : rawValue
                onSettlementDiscountChange({ ...settlementDiscount, value })
              }}
            />
            {settlementDiscount.method === 'percentage' ? '％' : '円'}
          </label>
          <p className="empty-note">
            割引対象額：{formatFareYen(breakdown.discountableFareYen)}円 /
            {breakdown.discountName}（{breakdown.discountMethod === 'percentage' ? `${breakdown.discountValue}％` : `${formatFareYen(breakdown.discountValue)}円`}）
            ▲{formatFareYen(breakdown.disabilityDiscountAmount)}円
          </p>
        </fieldset>
      ) : null}
      <div className="settlement-lines" aria-label="精算内訳">
        {showTimeDiscount && breakdown.timeMeter ? (
          <>
            <div>
              <span>時間制運賃</span>
              <strong>{formatFareYen(breakdown.timeMeter.legalTimeFare)}円</strong>
            </div>
            <div>
              <span>時間割引</span>
              <strong>-{formatFareYen(breakdown.timeMeter.timeDiscountAmount)}円</strong>
            </div>
          </>
        ) : null}
        {settlementLineItems.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{formatFareYen(item.amountYen)}円</strong>
          </div>
        ))}
      </div>
      <TaxiTicketEditor
        taxiTickets={taxiTickets}
        onAddTaxiTicket={onAddTaxiTicket}
        onRemoveTaxiTicket={onRemoveTaxiTicket}
      />
      <fieldset className="payment-methods">
        <legend>代表支払方法</legend>
        {SETTLEMENT_PAYMENT_METHODS.map((method) => (
          <label key={method}>
            <input
              checked={paymentMethod === method}
              name="payment-method"
              type="radio"
              value={method}
              onChange={() => onPaymentMethodChange(method)}
            />
            {method}
          </label>
        ))}
      </fieldset>
      <fieldset className="payment-methods">
        <legend>支払内訳</legend>
        {SETTLEMENT_PAYMENT_METHODS.map((method) => (
          <label key={method}>
            {method}
            <input
              min="0"
              step="1"
              type="number"
              value={paymentAmounts[method]}
              onChange={(event) => onPaymentAmountChange(method, Number(event.target.value) || 0)}
            />
            円
          </label>
        ))}
        <button type="button" onClick={onSettlePaymentRemainder}>
          支払総額を請求額に合わせる
        </button>
        <p>
          支払総額：{formatFareYen(settlementSummary.paymentTotalYen)}円 / 差額：
          {settlementSummary.differenceYen === 0
            ? '0円'
            : `${settlementSummary.differenceYen > 0 ? '+' : '▲'}${formatFareYen(Math.abs(settlementSummary.differenceYen))}円`}
        </p>
      </fieldset>
      <p className={`save-note save-note--${saveState}`}>{saveMessage}</p>
    </section>
  )
}

function TaxiTicketEditor({
  taxiTickets,
  onAddTaxiTicket,
  onRemoveTaxiTicket,
}: {
  taxiTickets: TaxiTicket[]
  onAddTaxiTicket: (ticket: Omit<TaxiTicket, 'id'>) => void
  onRemoveTaxiTicket: (ticketId: string) => void
}) {
  const handleSubmit = (formData: FormData) => {
    const municipality = String(formData.get('municipality') ?? '').trim()
    const ticketNumber = String(formData.get('ticketNumber') ?? '').trim()
    const amount = Math.max(Math.round(Number(formData.get('amount')) || 0), 0)

    if (!municipality || amount <= 0) {
      return
    }

    onAddTaxiTicket({ amount, municipality, ticketNumber })
  }

  return (
    <fieldset className="payment-methods">
      <legend>タクシー券</legend>
      {taxiTickets.length > 0 ? (
        <div className="settlement-lines" aria-label="タクシー券一覧">
          {taxiTickets.map((ticket) => (
            <div key={ticket.id}>
              <span>{ticket.municipality} {ticket.ticketNumber || '番号未入力'}</span>
              <strong>{formatFareYen(ticket.amount)}円</strong>
              <button type="button" onClick={() => onRemoveTaxiTicket(ticket.id)}>
                削除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-note">タクシー券は未登録です。</p>
      )}
      <form action={handleSubmit}>
        <label>
          自治体名
          <input name="municipality" placeholder="千葉市" />
        </label>
        <label>
          券番号
          <input name="ticketNumber" placeholder="任意" />
        </label>
        <label>
          金額
          <input min="1" name="amount" step="1" type="number" />
        </label>
        <button type="submit">タクシー券追加</button>
      </form>
    </fieldset>
  )
}
