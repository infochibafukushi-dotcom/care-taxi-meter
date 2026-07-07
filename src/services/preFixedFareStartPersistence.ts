export const shouldPersistPreFixedFareStartAtMeterEntry = ({
  meterMode,
  consentAt,
  workSessionId,
  reviewDemoMode,
}: {
  meterMode: string
  consentAt: string
  workSessionId: string
  reviewDemoMode: boolean
}) =>
  !reviewDemoMode &&
  meterMode === 'fixed' &&
  consentAt.trim().length > 0 &&
  workSessionId.trim().length > 0

export const buildPreFixedFareStartPersistKey = ({
  workSessionId,
  reservationId,
  snapshotHash,
}: {
  workSessionId: string
  reservationId: string
  snapshotHash: string
}) => `${workSessionId}:${reservationId}:${snapshotHash}`
