import { beforeEach, describe, expect, it, vi } from 'vitest'

const normalizeAccountingReceiptImage = vi.fn()
const loadAccountingReceiptOcrImageBlob = vi.fn()
const recognize = vi.fn()
const createWorker = vi.fn()

vi.mock('../utils/accountingReceiptImage', () => ({
  normalizeAccountingReceiptImage: (...args: unknown[]) => normalizeAccountingReceiptImage(...args),
}))

vi.mock('./accountingReceipts', () => ({
  loadAccountingReceiptOcrImageBlob: (...args: unknown[]) => loadAccountingReceiptOcrImageBlob(...args),
}))

vi.mock('../utils/reviewDemo', () => ({
  isReviewDemoRuntimeEnabled: () => false,
}))

vi.mock('../utils/accountingTesseractPaths', () => ({
  getAccountingTesseractPaths: () => ({
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
  }),
  logAccountingTesseractPaths: vi.fn(),
  verifyAccountingTesseractAssets: vi.fn(async () => undefined),
}))

vi.mock('./invoiceRegistrantLookup', () => ({
  lookupInvoiceRegistrant: vi.fn(async () => ({ status: 'idle' as const })),
  applyInvoiceRegistrantLookupToParsedFields: <T,>(parsed: T) => parsed,
}))

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: (...args: unknown[]) => createWorker(...args),
}))

describe('runAccountingReceiptOcr prepared image path', () => {
  beforeEach(async () => {
    vi.resetModules()
    normalizeAccountingReceiptImage.mockReset()
    loadAccountingReceiptOcrImageBlob.mockReset()
    recognize.mockReset()
    createWorker.mockReset()

    recognize.mockResolvedValue({
      data: {
        text: '日付 2026-06-30\n合計 1,978円\n消費税 180円',
        confidence: 80,
      },
    })
    createWorker.mockResolvedValue({
      recognize,
      terminate: vi.fn(async () => undefined),
    })

    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        setTimeout,
        clearTimeout,
      })
    }
  })

  it('skips normalizeAccountingReceiptImage when isPreparedOcrImage is true', async () => {
    const prepared = new File([new Uint8Array([1, 2, 3, 4])], 'prepared-ocr.jpg', {
      type: 'image/jpeg',
    })
    loadAccountingReceiptOcrImageBlob.mockResolvedValue(prepared)

    const { runAccountingReceiptOcr, resetAccountingOcrWorker } = await import('./accountingReceiptOcr')
    await resetAccountingOcrWorker()
    const result = await runAccountingReceiptOcr({
      imageBlob: prepared,
      isPreparedOcrImage: true,
    })

    expect(normalizeAccountingReceiptImage).not.toHaveBeenCalled()
    expect(recognize).toHaveBeenCalledWith(prepared)
    expect(result.status).toBe('success')
  })

  it('normalizes camera/image uploads when isPreparedOcrImage is false', async () => {
    const source = new File([new Uint8Array([9, 9, 9])], 'camera.jpg', { type: 'image/jpeg' })
    const normalized = new File([new Uint8Array([8, 8])], 'camera.jpg', { type: 'image/jpeg' })
    loadAccountingReceiptOcrImageBlob.mockResolvedValue(source)
    normalizeAccountingReceiptImage.mockResolvedValue(normalized)

    const { runAccountingReceiptOcr, resetAccountingOcrWorker } = await import('./accountingReceiptOcr')
    await resetAccountingOcrWorker()
    const result = await runAccountingReceiptOcr({
      imageBlob: source,
      isPreparedOcrImage: false,
    })

    expect(normalizeAccountingReceiptImage).toHaveBeenCalledWith(source)
    expect(recognize).toHaveBeenCalledWith(normalized)
    expect(result.status).toBe('success')
  })

  it('keeps legacy image OCR behavior when isPreparedOcrImage is omitted', async () => {
    const source = new File([new Uint8Array([5])], 'legacy.png', { type: 'image/png' })
    const normalized = new File([new Uint8Array([6])], 'legacy.jpg', { type: 'image/jpeg' })
    loadAccountingReceiptOcrImageBlob.mockResolvedValue(source)
    normalizeAccountingReceiptImage.mockResolvedValue(normalized)

    const { runAccountingReceiptOcr, resetAccountingOcrWorker } = await import('./accountingReceiptOcr')
    await resetAccountingOcrWorker()
    const result = await runAccountingReceiptOcr({
      imageBlob: source,
    })

    expect(normalizeAccountingReceiptImage).toHaveBeenCalledWith(source)
    expect(recognize).toHaveBeenCalledWith(normalized)
    expect(result.status).toBe('success')
  })
})
