export const isDevScreenshotMode = (search: string) => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get('screenshot') === '1' || params.get('devScreenshot') === '1'
}
