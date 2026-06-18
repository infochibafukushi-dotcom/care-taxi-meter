type PostSettlementBannerProps = {
  caseNumber: string
  compact?: boolean
  onStartNewCase: () => void
}

export function PostSettlementBanner({
  caseNumber,
  compact = false,
  onStartNewCase,
}: PostSettlementBannerProps) {
  return (
    <section
      className={`r9-post-settlement-banner ${compact ? 'r9-post-settlement-banner--compact' : ''}`}
      role="status"
      aria-label="精算完了"
    >
      <p>
        案件 <strong>{caseNumber}</strong> の精算が完了しました。
        {!compact ? '「新しい案件を開始」から次の案件へ進めます。' : null}
      </p>
      <button className="r9-flow-primary" type="button" onClick={onStartNewCase}>
        新しい案件を開始
      </button>
    </section>
  )
}
