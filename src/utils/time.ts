export function formatElapsedTime(totalSeconds: number) {
  return formatMinutesSeconds(totalSeconds)
}

export function formatMinutesSeconds(totalSeconds: number) {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const minutes = Math.floor(normalizedSeconds / 60)
  const seconds = normalizedSeconds % 60

  return `${minutes}分 ${seconds}秒`
}

const formatClockSegment = (value: number) => value.toString().padStart(2, '0')

export function formatDurationHoursMinutesJapanese(totalSeconds: number) {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)

  return `${hours}時間${String(minutes).padStart(2, '0')}分`
}

export function formatBreakMinutes(totalSeconds: number) {
  return `${Math.floor(Math.max(totalSeconds, 0) / 60)}分`
}

export function formatTimerClock(totalSeconds: number, includesHours = false) {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  return includesHours
    ? `${formatClockSegment(hours)}:${formatClockSegment(minutes)}:${formatClockSegment(seconds)}`
    : `${formatClockSegment(minutes + hours * 60)}:${formatClockSegment(seconds)}`
}
