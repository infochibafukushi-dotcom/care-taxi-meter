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
  if (!import.meta.env.DEV) {
    return
  }
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (new URLSearchParams(window.location.search).get('debugAccounting') !== '1') {
      return
    }
  } catch {
    return
  }
  console.info('[Accounting OCR] tesseract paths', {
    baseUrl: paths.baseUrl,
    hasWorkerPath: Boolean(paths.workerPath),
    hasCorePath: Boolean(paths.corePath),
    hasLangPath: Boolean(paths.langPath),
  })
}

export const verifyAccountingTesseractAsset = async (url: string, label: string) => {
  const response = await fetch(url, { method: 'HEAD' })
  if (import.meta.env.DEV) {
    try {
      if (
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debugAccounting') === '1'
      ) {
        console.info('[Accounting OCR] asset check', {
          label,
          ok: response.ok,
          status: response.status,
        })
      }
    } catch {
      // ignore
    }
  }

  if (!response.ok) {
    throw new Error(`${label} の読み込みに失敗しました (${response.status})`)
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
