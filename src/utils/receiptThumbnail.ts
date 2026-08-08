import { canvasToWebpBlob } from './receiptImageOrientation'

const THUMB_MAX_EDGE = 500
const THUMB_QUALITY = 0.7

/**
 * 一覧表示用 WebP サムネイル。法定マスターの代替には使わない。
 */
export async function createReceiptThumbnailWebp(
  source: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
): Promise<{ blob: Blob; width: number; height: number }> {
  const sourceWidth =
    'naturalWidth' in source && source.naturalWidth
      ? source.naturalWidth
      : (source as { width: number }).width
  const sourceHeight =
    'naturalHeight' in source && source.naturalHeight
      ? source.naturalHeight
      : (source as { height: number }).height

  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(sourceWidth, sourceHeight, 1))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('WebPサムネイルの生成に失敗しました。')
  }
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)

  try {
    const blob = await canvasToWebpBlob(canvas, THUMB_QUALITY)
    return { blob, width, height }
  } catch {
    // WebP 非対応環境向け JPEG フォールバック（MIME は呼び出し側で扱う）
    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', THUMB_QUALITY)
    })
    if (!jpeg) {
      throw new Error('WebPサムネイルの生成に失敗しました。')
    }
    return { blob: jpeg, width, height }
  }
}
