import type { FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PaymentMethod } from '../../types/case'

type FareBreakdownPanelProps = {
  breakdown: FareBreakdown
  hideTotal?: boolean
  paymentMethod?: PaymentMethod
}

export function FareBreakdownPanel({ breakdown, hideTotal, paymentMethod }: FareBreakdownPanelProps) {
  const meterLineItems =
    breakdown.meterMode === 'time'
      ? breakdown.lineItems.filter((item) => item.label === '時間制運賃')
      : breakdown.lineItems

  return (
    <section className="fare-breakdown" aria-labelledby="fare-breakdown-title">
      <h2 id="fare-breakdown-title">料金内訳</h2>
      <dl>
        {meterLineItems.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{formatFareYen(item.amountYen)}円</dd>
          </div>
        ))}
        {paymentMethod ? (
          <div>
            <dt>支払方法</dt>
            <dd>{paymentMethod}</dd>
          </div>
        ) : null}
        {!hideTotal ? (
          <div className="fare-breakdown__total">
            <dt>合計金額</dt>
            <dd>{formatFareYen(breakdown.totalFareYen)}円</dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}
