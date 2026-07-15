import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaxAdvisorPdfSamplePackage } from './accountingTaxAdvisorPdfSample'
import { buildTaxAdvisorPackagePdfBlob } from './accountingTaxAdvisorExport'
import {
  JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE,
  JAPANESE_PDF_FONT_NAME,
  resetJapanesePdfFontCacheForTests,
} from './pdfJapaneseFont'

const FONT_PATH = resolve(process.cwd(), 'public/fonts/NotoSansJP-Regular.ttf')
const fontBytes = readFileSync(FONT_PATH)

const stubFontFetchSuccess = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('NotoSansJP-Regular.ttf')) {
        return new Response(fontBytes, {
          status: 200,
          headers: { 'Content-Type': 'font/ttf' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

const stubFontFetchFailure = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('missing', { status: 500, statusText: 'Error' })),
  )
}

const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer())

const decodePdfLatin1 = (bytes: Uint8Array): string => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]!)
  }
  return text
}

describe('buildTaxAdvisorPackagePdfBlob Japanese font', () => {
  beforeEach(() => {
    resetJapanesePdfFontCacheForTests()
    stubFontFetchSuccess()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetJapanesePdfFontCacheForTests()
  })

  it('builds a multi-page Blob with PDF header and embedded Japanese font name', async () => {
    const t0 = Date.now()
    const blob = await buildTaxAdvisorPackagePdfBlob(createTaxAdvisorPdfSamplePackage())
    const ms = Date.now() - t0
    expect(blob.size).toBeGreaterThan(1000)

    const bytes = await blobToUint8Array(blob)
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
    expect(decodePdfLatin1(bytes)).toContain(JAPANESE_PDF_FONT_NAME)
    expect(fetch).toHaveBeenCalled()

    const outDir = resolve('.smoke-artifacts/pdf-font-phase2')
    mkdirSync(outDir, { recursive: true })
    try {
      writeFileSync(resolve(outDir, `tax-advisor-package-after-${Date.now()}.pdf`), Buffer.from(bytes))
    } catch (error) {
      // Windows may lock a previously opened smoke PDF; size logging still succeeds.
      if (!(error instanceof Error) || !/EBUSY|EPERM|EACCES/.test(error.message)) {
        throw error
      }
    }
    // eslint-disable-next-line no-console
    console.log(`MEASURE\tlabel=after\tsize=${blob.size}\tms=${ms}`)
  }, 120_000)

  it('keeps Japanese font after addPage across portrait and landscape sections', async () => {
    const blob = await buildTaxAdvisorPackagePdfBlob(createTaxAdvisorPdfSamplePackage())
    const bytes = await blobToUint8Array(blob)
    const latin1 = decodePdfLatin1(bytes)

    // Cover is portrait; table sections include landscape (固定・減価償却) and portrait.
    expect(latin1).toContain(JAPANESE_PDF_FONT_NAME)
    // Multiple page objects indicate multi-page document
    const pageCount = (latin1.match(/\/Type\s*\/Page\b/g) ?? []).length
    expect(pageCount).toBeGreaterThan(3)
    expect(blob.size).toBeGreaterThan(10_000)
  }, 120_000)

  it('fails without generating a garbled PDF when font load fails', async () => {
    resetJapanesePdfFontCacheForTests()
    stubFontFetchFailure()
    await expect(
      buildTaxAdvisorPackagePdfBlob(createTaxAdvisorPdfSamplePackage()),
    ).rejects.toThrow(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
  })
})
