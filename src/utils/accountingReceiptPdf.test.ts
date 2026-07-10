import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDF_LOAD_ERROR_MESSAGE } from './accountingReceiptPdf'

const getPage = vi.fn()
const destroy = vi.fn()
const getDocument = vi.fn()

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => getDocument(...args),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/mock-pdf.worker.min.mjs',
}))

describe('createAccountingPdfPreview', () => {
  beforeEach(() => {
    getPage.mockReset()
    destroy.mockReset()
    getDocument.mockReset()

    vi.stubGlobal(
      'HTMLCanvasElement',
      class {
        width = 0
        height = 0
        getContext() {
          return {
            drawImage: vi.fn(),
          }
        }
        toBlob(callback: (blob: Blob | null) => void) {
          callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
        }
      },
    )

    // jsdom-less environments: ensure document.createElement('canvas') works via stub
    if (typeof document === 'undefined') {
      vi.stubGlobal('document', {
        createElement: (tag: string) => {
          if (tag === 'canvas') {
            return new (globalThis as unknown as { HTMLCanvasElement: new () => HTMLCanvasElement }).HTMLCanvasElement()
          }
          throw new Error(`Unexpected element: ${tag}`)
        },
      })
    } else {
      const original = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'canvas') {
          return new (globalThis as unknown as { HTMLCanvasElement: new () => HTMLCanvasElement }).HTMLCanvasElement() as unknown as HTMLElement
        }
        return original(tagName)
      })
    }
  })

  it('creates a JPEG preview from the first page and returns page count', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }))
    getPage.mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 800 * scale,
        height: 600 * scale,
      }),
      render,
    })
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        getPage,
        cleanup: destroy,
      }),
    })

    const { createAccountingPdfPreview } = await import('./accountingReceiptPdf')
    const source = new File([new Uint8Array([1, 2, 3])], 'amazon_invoice.pdf', {
      type: 'application/pdf',
    })
    const result = await createAccountingPdfPreview(source)

    expect(result.pageCount).toBe(3)
    expect(result.previewFile.type).toBe('image/jpeg')
    expect(result.previewFile.name).toBe('amazon_invoice-ocr-page-1.jpg')
    expect(getPage).toHaveBeenCalledWith(1)
    expect(render).toHaveBeenCalled()
  })

  it('throws a clear error for broken PDFs', async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error('Invalid PDF')),
    })

    const { createAccountingPdfPreview } = await import('./accountingReceiptPdf')
    const source = new File([new Uint8Array([1])], 'broken.pdf', { type: 'application/pdf' })

    await expect(createAccountingPdfPreview(source)).rejects.toThrow(PDF_LOAD_ERROR_MESSAGE)
  })
})
