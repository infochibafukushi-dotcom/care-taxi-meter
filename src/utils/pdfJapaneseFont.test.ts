import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import {
  JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE,
  JAPANESE_PDF_FONT_NAME,
  arrayBufferToBinaryString,
  registerJapanesePdfFont,
  resetJapanesePdfFontCacheForTests,
  setJapanesePdfFont,
} from './pdfJapaneseFont'
import { buildAuditLinePdfBlob, buildAuditTablePdfBlob } from './accountingAuditPdf'

const FONT_PATH = resolve(process.cwd(), 'public/fonts/NotoSansJP-Regular.ttf')
const fontBytes = readFileSync(FONT_PATH)

const JAPANESE_SAMPLE_ROWS = [
  ['会社名', '株式会社千葉福祉サポート', ''],
  ['店舗', 'ちばケアタクシー', ''],
  ['帳票', '決算サマリー', ''],
  ['帳票', '損益計算書', ''],
  ['帳票', '貸借対照表', ''],
  ['帳票', '固定資産台帳', ''],
  ['帳票', '減価償却明細', ''],
  ['帳票', '消費税集計', ''],
  ['帳票', '申告前チェック', ''],
  ['取引先', '千葉公証役場', ''],
  ['取引先', 'アマゾンジャパン合同会社', ''],
  ['取引先', '地方公共団体情報システム機構', ''],
  ['金額', '￥41,080', '41080'],
  ['記号', '①②③', ''],
]

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

const stubFontFetchFailure = (status = 404) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('missing', { status, statusText: 'Not Found' })),
  )
}

const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

const decodePdfLatin1 = (bytes: Uint8Array): string => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]!)
  }
  return text
}

describe('pdfJapaneseFont', () => {
  beforeEach(() => {
    resetJapanesePdfFontCacheForTests()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetJapanesePdfFontCacheForTests()
  })

  it('arrayBufferToBinaryString converts font bytes without dropping length', () => {
    const sample = new Uint8Array([0, 65, 255, 128]).buffer
    const binary = arrayBufferToBinaryString(sample)
    expect(binary.length).toBe(4)
    expect(binary.charCodeAt(0)).toBe(0)
    expect(binary.charCodeAt(1)).toBe(65)
    expect(binary.charCodeAt(2)).toBe(255)
  })

  it('registers the Japanese font successfully', async () => {
    stubFontFetchSuccess()
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    await registerJapanesePdfFont(pdf)
    expect(pdf.getFont().fontName).toBe(JAPANESE_PDF_FONT_NAME)
    const list = pdf.getFontList()
    expect(list[JAPANESE_PDF_FONT_NAME]).toBeTruthy()
  })

  it('allows double registration without throwing', async () => {
    stubFontFetchSuccess()
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    await registerJapanesePdfFont(pdf)
    await expect(registerJapanesePdfFont(pdf)).resolves.toBeUndefined()
    setJapanesePdfFont(pdf)
    expect(pdf.getFont().fontName).toBe(JAPANESE_PDF_FONT_NAME)
  })

  it('fetches the font only once across multiple PDF instances', async () => {
    stubFontFetchSuccess()
    const pdfA = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pdfB = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    await Promise.all([registerJapanesePdfFont(pdfA), registerJapanesePdfFont(pdfB)])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pdfA.getFont().fontName).toBe(JAPANESE_PDF_FONT_NAME)
    expect(pdfB.getFont().fontName).toBe(JAPANESE_PDF_FONT_NAME)
  })

  it('throws a clear error when font fetch fails (no Helvetica fallback)', async () => {
    stubFontFetchFailure(500)
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    await expect(registerJapanesePdfFont(pdf)).rejects.toThrow(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
    expect(pdf.getFont().fontName).not.toBe(JAPANESE_PDF_FONT_NAME)
  })

  it('keeps Japanese font after addPage when re-applied', async () => {
    stubFontFetchSuccess()
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    await registerJapanesePdfFont(pdf)
    pdf.text('株式会社千葉福祉サポート', 14, 20)
    pdf.addPage()
    setJapanesePdfFont(pdf)
    pdf.text('ちばケアタクシー', 14, 20)
    expect(pdf.getNumberOfPages()).toBe(2)
    expect(pdf.getFont().fontName).toBe(JAPANESE_PDF_FONT_NAME)
  })
})

describe('accountingAuditPdf with Japanese font', () => {
  beforeEach(() => {
    resetJapanesePdfFontCacheForTests()
    stubFontFetchSuccess()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetJapanesePdfFontCacheForTests()
  })

  it('builds a portrait table Blob with valid PDF header, font name, and pages', async () => {
    const blob = await buildAuditTablePdfBlob({
      title: '決算サマリー 2026年度',
      headers: ['項目', '値', '金額(円)'],
      rows: JAPANESE_SAMPLE_ROWS,
      orientation: 'portrait',
    })

    expect(blob.size).toBeGreaterThan(1000)
    const bytes = await blobToUint8Array(blob)
    const header = String.fromCharCode(...bytes.subarray(0, 5))
    expect(header).toBe('%PDF-')
    const latin1 = decodePdfLatin1(bytes)
    expect(latin1).toContain(JAPANESE_PDF_FONT_NAME)
  })

  it('builds a landscape multi-page table PDF', async () => {
    const manyRows = Array.from({ length: 80 }, (_, index) => [
      `2026-${String((index % 12) + 1).padStart(2, '0')}`,
      `資産${index}`,
      '車両',
      '41666',
      String(41666 * (index + 1)),
      String(3_000_000 - 41_666 * (index + 1)),
    ])

    const blob = await buildAuditTablePdfBlob({
      title: '減価償却明細 2026年度',
      headers: ['対象月', '資産名', '区分', '当月償却', '累計', '残高'],
      rows: manyRows,
      orientation: 'landscape',
    })

    expect(blob.size).toBeGreaterThan(1000)
    const bytes = await blobToUint8Array(blob)
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
    expect(decodePdfLatin1(bytes)).toContain(JAPANESE_PDF_FONT_NAME)
  })

  it('builds a line PDF Blob for ZIP-style use', async () => {
    const blob = await buildAuditLinePdfBlob('申告前チェック', [
      '株式会社千葉福祉サポート',
      '地方公共団体情報システム機構',
      '￥41,080',
      '①②③',
    ])
    expect(blob.size).toBeGreaterThan(500)
    const bytes = await blobToUint8Array(blob)
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
    expect(decodePdfLatin1(bytes)).toContain(JAPANESE_PDF_FONT_NAME)
  })

  it('can generate multiple ZIP report PDFs in parallel', async () => {
    const blobs = await Promise.all([
      buildAuditTablePdfBlob({
        title: '損益計算書',
        headers: ['区分', '科目', '金額(円)'],
        rows: [['売上', '売上高', '1000000']],
        orientation: 'portrait',
      }),
      buildAuditTablePdfBlob({
        title: '固定資産台帳',
        headers: ['購入日', '資産名', '区分', '取得価額', '耐用年数', '月額償却', '残高'],
        rows: [['2024-04-01', '車両A', '車両', '3000000', '6', '41666', '2500000']],
        orientation: 'landscape',
      }),
      buildAuditTablePdfBlob({
        title: '消費税集計',
        headers: ['項目', '値', '金額(円)'],
        rows: [['課税売上', '', '900000']],
        orientation: 'portrait',
      }),
    ])

    expect(blobs).toHaveLength(3)
    for (const blob of blobs) {
      expect(blob.size).toBeGreaterThan(1000)
      const bytes = await blobToUint8Array(blob)
      expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
      expect(decodePdfLatin1(bytes)).toContain(JAPANESE_PDF_FONT_NAME)
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fails PDF generation when the Japanese font cannot be loaded', async () => {
    resetJapanesePdfFontCacheForTests()
    stubFontFetchFailure(404)
    await expect(
      buildAuditTablePdfBlob({
        title: '決算サマリー',
        headers: ['項目', '値'],
        rows: [['a', 'b']],
        orientation: 'portrait',
      }),
    ).rejects.toThrow(JAPANESE_PDF_FONT_LOAD_ERROR_MESSAGE)
  })
})
