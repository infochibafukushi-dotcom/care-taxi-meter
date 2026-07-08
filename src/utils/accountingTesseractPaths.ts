export type AccountingTesseractPaths = {
  workerPath: string
  corePath: string
  langPath: string
  baseUrl: string
}

const normalizeBaseUrl = () => {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

const resolvePublicAssetUrl = (relativePath: string) => {
  const base = normalizeBaseUrl()
  if (typeof window === 'undefined') {
    return `${base}${relativePath.replace(/^\//, '')}`
  }

  return new URL(relativePath.replace(/^\//, ''), window.location.origin + base).href
}

export const getAccountingTesseractPaths = (): AccountingTesseractPaths => {
  const baseUrl = normalizeBaseUrl()

  return {
    baseUrl,
    workerPath: resolvePublicAssetUrl('tesseract/worker.min.js'),
    corePath: resolvePublicAssetUrl('tesseract/core'),
    langPath: resolvePublicAssetUrl('tesseract/lang/'),
  }
}

export const logAccountingTesseractPaths = (paths: AccountingTesseractPaths) => {
  console.info('[Accounting OCR] tesseract paths', paths)
}

export const verifyAccountingTesseractAsset = async (url: string, label: string) => {
  const response = await fetch(url, { method: 'HEAD' })
  console.info('[Accounting OCR] asset check', {
    label,
    url,
    ok: response.ok,
    status: response.status,
  })

  if (!response.ok) {
    throw new Error(`${label} の読み込みに失敗しました (${response.status}): ${url}`)
  }
}

export const verifyAccountingTesseractAssets = async (paths: AccountingTesseractPaths) => {
  await verifyAccountingTesseractAsset(paths.workerPath, 'worker')
  await verifyAccountingTesseractAsset(
    `${paths.corePath.replace(/\/$/, '')}/tesseract-core-simd-lstm.wasm.js`,
    'core',
  )
  await verifyAccountingTesseractAsset(`${paths.langPath}jpn.traineddata.gz`, 'lang-jpn')
  await verifyAccountingTesseractAsset(`${paths.langPath}eng.traineddata.gz`, 'lang-eng')
}
