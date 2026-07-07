import type { ReactNode } from 'react'
import type { FareBreakdown } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PaymentMethod } from '../../types/case'

type FareBreakdownPanelProps = {
  breakdown: FareBreakdown
  headerEnd?: ReactNode
  hideTotal?: boolean
  paymentMethod?: PaymentMethod
  title?: string
  totalLabel?: string
  footerNote?: string
}

export function FareBreakdownPanel({
  breakdown,
  headerEnd,
  hideTotal,
  paymentMethod,
  title = '料金内訳',
  totalLabel = '合計金額',
  footerNote,
}: FareBreakdownPanelProps) {
  return (
    <section className="fare-breakdown" aria-labelledby="fare-breakdown-title">
      <div className="fare-breakdown__header">
        <h2 id="fare-breakdown-title">{title}</h2>
        {headerEnd}
      </div>
      <dl>
        {breakdown.lineItems
          .filter((item) => item.amountYen !== 0)
          .map((item) => (
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
            <dt>{totalLabel}</dt>
            <dd>{formatFareYen(breakdown.totalFareYen)}円</dd>
          </div>
        ) : null}
      </dl>
      {footerNote ? <p className="fare-breakdown__note">{footerNote}</p> : null}
    </section>
  )
}
