/**
 * 予約なしで開始の画面順（介助先行）。
 * 地図・Directions・候補生成ロジックとは独立。
 */
export const PRE_FIXED_MANUAL_CREATE_STEPS = [
  'trip-type',
  'assist-items',
  'pickup',
  'destinations',
  'routes',
  'consent',
] as const

export type PreFixedManualCreateStep = (typeof PRE_FIXED_MANUAL_CREATE_STEPS)[number]

export const isPreFixedManualCreateStep = (value: unknown): value is PreFixedManualCreateStep =>
  typeof value === 'string' &&
  (PRE_FIXED_MANUAL_CREATE_STEPS as readonly string[]).includes(value)

/** 予約なしフローの「戻る」先。先頭なら null */
export const getPreFixedManualCreateBackStep = (
  step: PreFixedManualCreateStep,
): PreFixedManualCreateStep | null => {
  const index = PRE_FIXED_MANUAL_CREATE_STEPS.indexOf(step)
  if (index <= 0) {
    return null
  }
  return PRE_FIXED_MANUAL_CREATE_STEPS[index - 1] ?? null
}

/** 予約なしフローの「次へ」先。末尾なら null */
export const getPreFixedManualCreateForwardStep = (
  step: PreFixedManualCreateStep,
): PreFixedManualCreateStep | null => {
  const index = PRE_FIXED_MANUAL_CREATE_STEPS.indexOf(step)
  if (index < 0 || index >= PRE_FIXED_MANUAL_CREATE_STEPS.length - 1) {
    return null
  }
  return PRE_FIXED_MANUAL_CREATE_STEPS[index + 1] ?? null
}

/**
 * 送迎タイプ直後の遷移先。
 * 予約ありは介助・お迎え地をスキップして目的地へ。
 */
export const getPreFixedCreateStepAfterTripType = (isFromReservation: boolean): PreFixedManualCreateStep =>
  isFromReservation ? 'destinations' : 'assist-items'
