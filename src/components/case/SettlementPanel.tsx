import { useState } from 'react'
import type { FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PaymentMethod } from '../../types/case'

type SettlementPanelProps = {
  breakdown: FareBreakdown
}

const paymentMethods: PaymentMethod[] = ['現金', 'クレジット', 'QR決済', 'その他']

export function SettlementPanel({ breakdown }: SettlementPanelProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('現金')

  return (
    <section className="settlement-panel" aria-labelledby="settlement-title">
      <h2 id="settlement-title">精算画面</h2>
      <div className="settlement-total">
        <span>合計金額</span>
        <strong>{formatFareYen(breakdown.totalFareYen)}円</strong>
      </div>
      <div className="settlement-lines" aria-label="精算内訳">
        {breakdown.lineItems.map((item) => (
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
              onChange={() => setPaymentMethod(method)}
            />
            {method}
          </label>
        ))}
      </fieldset>
      <p className="empty-note">今回は画面表示のみです。保存処理は未実装です。</p>
    </section>
  )
}
