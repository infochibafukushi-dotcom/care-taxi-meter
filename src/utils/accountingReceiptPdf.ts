import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_PREVIEW_DIMENSION = 1600
const JPEG_QUALITY = 0.8

export const PDF_LOAD_ERROR_MESSAGE =
  'PDFを読み込めませんでした。パスワード保護またはファイル破損の可能性があります。'

export type AccountingPdfPreviewResult = {
  previewFile: File
  pageCount: number
}

const toOcrPreviewFileName = (sourceName: string) => {
  const base = sourceName.replace(/\.[^.]+$/, '').trim() || 'receipt'
  return `${base}-ocr-page-1.jpg`
}

/**
 * PDF の 1 ページ目を OCR / プレビュー向け JPEG に変換します。
 * 原本 PDF は変換せず、呼び出し側で別途保存してください。
 */
export async function createAccountingPdfPreview(source: File): Promise<AccountingPdfPreviewResult> {
  let pdfDocument: PDFDocumentProxy | null = null

  try {
    const data = new Uint8Array(await source.arrayBuffer())
    const loadingTask = getDocument({ data, useSystemFonts: true })
    pdfDocument = await loadingTask.promise

    const pageCount = pdfDocument.numPages
    if (!pageCount || pageCount < 1) {
      throw new Error(PDF_LOAD_ERROR_MESSAGE)
    }

    const page = await pdfDocument.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const longestEdge = Math.max(baseViewport.width, baseViewport.height, 1)
    const fitScale = Math.min(1, MAX_PREVIEW_DIMENSION / longestEdge)
    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const viewport = page.getViewport({ scale: Math.max(fitScale * Math.min(pixelRatio, 2), 0.5) })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error(PDF_LOAD_ERROR_MESSAGE)
    }

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(PDF_LOAD_ERROR_MESSAGE))
            return
          }
          resolve(blob)
        },
        'image/jpeg',
        JPEG_QUALITY,
      )
    })

    return {
      previewFile: new File([jpegBlob], toOcrPreviewFileName(source.name), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }),
      pageCount,
    }
  } catch (error) {
    if (error instanceof Error && error.message === PDF_LOAD_ERROR_MESSAGE) {
      throw error
    }

    throw new Error(PDF_LOAD_ERROR_MESSAGE, { cause: error })
  } finally {
    if (pdfDocument) {
      try {
        await pdfDocument.cleanup()
      } catch {
        // ignore cleanup failures
      }
    }
  }
}
