export function formatElapsedTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

export function formatMinutesSeconds(totalSeconds: number) {
  const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)
  const minutes = Math.floor(normalizedSeconds / 60)
  const seconds = normalizedSeconds % 60

  return `${minutes}分 ${seconds}秒`
}
