export const isDebugLayoutMode = (search: string) => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get('debugLayout') === '1'
}

/** メーター横向き案内を出さず UI をそのまま見せる（screenshot / debugLayout） */
export const isMeterLandscapeNoticeBypass = (search: string) => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return (
    params.get('screenshot') === '1' ||
    params.get('devScreenshot') === '1' ||
    params.get('debugLayout') === '1'
  )
}
