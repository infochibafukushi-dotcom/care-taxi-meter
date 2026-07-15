import type { jsPDF } from 'jspdf'

/** Logical font family name registered with jsPDF (embedded in PDF). */
export const JAPANESE_PDF_FONT_NAME = 'NotoSansJP'

const VFS_FILENAME = 'NotoSansJP-Regular.ttf'
const FONT_URL_PATH = `fonts/${VFS_FILENAME}`

export const JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE =
  '日本語フォントの読み込みに失敗しました。\n通信状態を確認してから、もう一度PDFまたはZIPを生成してください。'

type JsPdfInstance = jsPDF

/** jsPDF instances that already have the Japanese font registered in VFS. */
const registeredPdfs = new WeakSet<object>()

/** Shared in-flight / completed font load (module-scoped, one network fetch). */
let fontBinaryPromise: Promise<string> | null = null

const buildFontUrl = (): string => {
  const envBase =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/'
  const base = envBase || '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return `${normalizedBase}${FONT_URL_PATH}`
}

/**
 * Convert ArrayBuffer to a binary string for jsPDF addFileToVFS.
 * Chunked to avoid call-stack limits on large CJK fonts (~5MB).
 */
export const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return binary
}

const fetchJapaneseFontBinaryString = async (): Promise<string> => {
  const url = buildFontUrl()
  let response: Response
  try {
    response = await fetch(url)
  } catch (cause) {
    const error = new Error(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    ;(error as Error & { cause?: unknown }).cause = cause
    throw error
  }

  if (!response.ok) {
    const error = new Error(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    ;(error as Error & { cause?: unknown }).cause = {
      url,
      status: response.status,
      statusText: response.statusText,
    }
    throw error
  }

  try {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) {
      throw new Error('empty font body')
    }
    return arrayBufferToBinaryString(buffer)
  } catch (cause) {
    const error = new Error(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    ;(error as Error & { cause?: unknown }).cause = cause
    throw error
  }
}

/**
 * Load the Japanese TTF once (shared Promise). Retries are allowed after failure.
 * Exposed for tests.
 */
export const loadJapanesePdfFontBinary = (): Promise<string> => {
  if (!fontBinaryPromise) {
    fontBinaryPromise = fetchJapaneseFontBinaryString().catch((error) => {
      fontBinaryPromise = null
      throw error
    })
  }
  return fontBinaryPromise
}

/** Test helper — clears the cached font Promise between cases. */
export const resetJapanesePdfFontCacheForTests = (): void => {
  fontBinaryPromise = null
}

export const setJapanesePdfFont = (pdf: JsPdfInstance): void => {
  pdf.setFont(JAPANESE_PDF_FONT_NAME, 'normal')
}

/**
 * Register Noto Sans JP on a jsPDF instance and set it as the active font.
 * Safe to call multiple times on the same instance. Does not fall back to Helvetica.
 */
export const registerJapanesePdfFont = async (pdf: JsPdfInstance): Promise<void> => {
  if (registeredPdfs.has(pdf)) {
    setJapanesePdfFont(pdf)
    return
  }

  let binary: string
  try {
    binary = await loadJapanesePdfFontBinary()
  } catch (cause) {
    if (cause instanceof Error && cause.message === JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE) {
      throw cause
    }
    const error = new Error(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    ;(error as Error & { cause?: unknown }).cause = cause
    throw error
  }

  try {
    pdf.addFileToVFS(VFS_FILENAME, binary)
    pdf.addFont(VFS_FILENAME, JAPANESE_PDF_FONT_NAME, 'normal')
  } catch (cause) {
    const error = new Error(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    ;(error as Error & { cause?: unknown }).cause = cause
    throw error
  }

  registeredPdfs.add(pdf)
  setJapanesePdfFont(pdf)
}
