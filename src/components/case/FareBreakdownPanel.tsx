import type { FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'

type FareBreakdownPanelProps = {
  breakdown: FareBreakdown
}

export function FareBreakdownPanel({ breakdown }: FareBreakdownPanelProps) {
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
        <div className="fare-breakdown__total">
          <dt>合計金額</dt>
          <dd>{formatFareYen(breakdown.totalFareYen)}円</dd>
        </div>
      </dl>
    </section>
  )
}
