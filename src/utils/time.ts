export function formatElapsedTime(totalSeconds: number) {
  return formatMinutesSeconds(totalSeconds)
}

export function formatMinutesSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
}
