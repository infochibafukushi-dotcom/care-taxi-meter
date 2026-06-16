export function formatElapsedTime(totalSeconds: number) {
  return formatMinutesSeconds(totalSeconds)
}

export function formatMinutesSeconds(totalSeconds: number) {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const minutes = Math.floor(normalizedSeconds / 60)
  const seconds = normalizedSeconds % 60

  return `${minutes}分 ${seconds}秒`
}
