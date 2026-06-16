import type { FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PaymentMethod } from '../../types/case'

type SettlementPanelProps = {
  breakdown: FareBreakdown
  paymentMethod: PaymentMethod
  saveMessage: string
  saveState: 'error' | 'idle' | 'saved' | 'saving'
  onPaymentMethodChange: (paymentMethod: PaymentMethod) => void
}

const paymentMethods: PaymentMethod[] = ['現金', 'クレジット', 'QR決済', '請求書', 'その他']

export function SettlementPanel({
  breakdown,
  paymentMethod,
  saveMessage,
  saveState,
  onPaymentMethodChange,
}: SettlementPanelProps) {
  const showTimeDiscount =
    breakdown.meterMode === 'time' &&
    breakdown.timeMeter?.timeDiscountEnabled === true

  const settlementLineItems = breakdown.lineItems.filter((item) => {
    if (showTimeDiscount && item.label === '時間制運賃') {
      return false
    }

    return true
  })

  return (
    <section className="settlement-panel" aria-labelledby="settlement-title">
      <h2 id="settlement-title">精算画面</h2>
      <div className="settlement-total">
        <span>合計金額</span>
        <strong>{formatFareYen(breakdown.totalFareYen)}円</strong>
      </div>
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
      <fieldset className="payment-methods">
        <legend>支払方法</legend>
        {paymentMethods.map((method) => (
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
      <p className={`save-note save-note--${saveState}`}>{saveMessage}</p>
    </section>
  )
}
