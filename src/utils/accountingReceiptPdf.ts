import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** OCR 向け PDF 描画の目標長辺（px） */
export const PDF_OCR_TARGET_LONG_EDGE = 3000
/** 異常巨大化を防ぐ描画 scale 上限 */
export const PDF_OCR_MAX_SCALE = 4
/** PDF 由来 OCR JPEG の品質（第一候補） */
export const PDF_OCR_JPEG_QUALITY = 0.95

const PDF_OCR_FALLBACK_QUALITY = 0.9
const PDF_OCR_FALLBACK_LONG_EDGE = 2600
const MAX_OCR_JPEG_BYTES = 10 * 1024 * 1024

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
 * PDF 1 ページ目の OCR 描画倍率を算出します。
 * 小さいページは拡大し、巨大ページは scale 上限で抑えます。
 */
export function calculateAccountingPdfRenderScale(
  width: number,
  height: number,
  targetLongEdge: number = PDF_OCR_TARGET_LONG_EDGE,
  maxScale: number = PDF_OCR_MAX_SCALE,
): number {
  const safeWidth = Number.isFinite(width) ? Math.max(width, 0) : 0
  const safeHeight = Number.isFinite(height) ? Math.max(height, 0) : 0
  const longestEdge = Math.max(safeWidth, safeHeight, 1)
  const targetScale = targetLongEdge / longestEdge
  return Math.min(maxScale, Math.max(1, targetScale))
}

const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(PDF_LOAD_ERROR_MESSAGE))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      quality,
    )
  })

const renderPageToCanvas = async (
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  renderScale: number,
) => {
  const viewport = page.getViewport({ scale: renderScale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error(PDF_LOAD_ERROR_MESSAGE)
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({
    canvasContext: context,
    viewport,
    canvas,
  }).promise

  return canvas
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
    let renderScale = calculateAccountingPdfRenderScale(baseViewport.width, baseViewport.height)
    let quality = PDF_OCR_JPEG_QUALITY

    let canvas = await renderPageToCanvas(page, renderScale)
    let jpegBlob = await canvasToJpegBlob(canvas, quality)

    if (jpegBlob.size >= MAX_OCR_JPEG_BYTES) {
      quality = PDF_OCR_FALLBACK_QUALITY
      jpegBlob = await canvasToJpegBlob(canvas, quality)
    }

    if (jpegBlob.size >= MAX_OCR_JPEG_BYTES) {
      renderScale = calculateAccountingPdfRenderScale(
        baseViewport.width,
        baseViewport.height,
        PDF_OCR_FALLBACK_LONG_EDGE,
      )
      canvas = await renderPageToCanvas(page, renderScale)
      jpegBlob = await canvasToJpegBlob(canvas, PDF_OCR_FALLBACK_QUALITY)
      quality = PDF_OCR_FALLBACK_QUALITY
    }

    if (jpegBlob.size >= MAX_OCR_JPEG_BYTES) {
      throw new Error(
        'OCR用画像が10MB以上になりました。PDFページ数が多すぎるか、解像度が高すぎます。別形式でお試しください。',
      )
    }

    console.info('[Accounting PDF OCR] preview-created', {
      pageCount,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      fileSizeBytes: jpegBlob.size,
      quality,
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

    if (
      error instanceof Error &&
      error.message.includes('OCR用画像が10MB以上になりました')
    ) {
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
