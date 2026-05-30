import type { MeterMetric } from '../../types/case'

type MeterSummaryProps = {
  metrics: MeterMetric[]
}

export function MeterSummary({ metrics }: MeterSummaryProps) {
  return (
    <section className="meter-summary" aria-label="メーター情報">
      {metrics.map((metric) => (
        <div className="metric-card" key={metric.label}>
          <span className="metric-label">{metric.label}</span>
          <strong className="metric-value">
            {metric.value}
            {metric.unit ? <span>{metric.unit}</span> : null}
          </strong>
        </div>
      ))}
    </section>
  )
}
