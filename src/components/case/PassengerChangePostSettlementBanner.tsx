type PassengerChangePostSettlementBannerProps = {
  compact?: boolean
  onStartRegularMeterTrip: () => void
}

export function PassengerChangePostSettlementBanner({
  compact = false,
  onStartRegularMeterTrip,
}: PassengerChangePostSettlementBannerProps) {
  return (
    <section
      className={`r9-post-settlement-banner r9-post-settlement-banner--passenger-change ${compact ? 'r9-post-settlement-banner--compact' : ''}`}
      role="status"
      aria-label="事前確定運賃途中終了"
    >
      <p>
        事前確定運賃の運送を終了しました。
        {!compact ? (
          <>
            <br />
            この後の運送は、通常メーター運行として新しい案件を開始してください。
          </>
        ) : null}
      </p>
      <button className="r9-flow-primary" type="button" onClick={onStartRegularMeterTrip}>
        通常メーターで新規運行を開始
      </button>
    </section>
  )
}
