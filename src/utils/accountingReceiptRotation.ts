export type ReceiptRotationDegrees = 0 | 90 | 180 | 270

export const RECEIPT_ROTATION_ERROR_MESSAGE =
  '画像を回転できませんでした。画像を再度アップロードしてください。'

export const RECEIPT_ROTATION_OCR_RERUN_MESSAGE =
  '画像の向きを変更しました。OCRを再実行してください'

const ROTATION_JPEG_QUALITY = 0.92

const loadImageElement = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(RECEIPT_ROTATION_ERROR_MESSAGE))
    }

    image.src = objectUrl
  })

const loadImageSource = async (blob: Blob) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall back to Image() for formats createImageBitmap cannot decode.
    }
  }

  return loadImageElement(blob)
}

const getImageDimensions = (imageSource: ImageBitmap | HTMLImageElement) => {
  if (
    typeof HTMLImageElement !== 'undefined' &&
    imageSource instanceof HTMLImageElement
  ) {
    return {
      width: imageSource.naturalWidth,
      height: imageSource.naturalHeight,
    }
  }

  return {
    width: imageSource.width,
    height: imageSource.height,
  }
}

const closeImageSource = (imageSource: ImageBitmap | HTMLImageElement) => {
  if ('close' in imageSource && typeof imageSource.close === 'function') {
    imageSource.close()
  }
}

export function normalizeReceiptRotationDegrees(degrees: number): ReceiptRotationDegrees {
  const normalized = ((Math.round(degrees) % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized
  }
  return 0
}

export function rotateReceiptDegreesRight(current: ReceiptRotationDegrees): ReceiptRotationDegrees {
  return normalizeReceiptRotationDegrees(current + 90)
}

export function rotateReceiptDegreesLeft(current: ReceiptRotationDegrees): ReceiptRotationDegrees {
  return normalizeReceiptRotationDegrees(current - 90)
}

export function resolveNextReceiptRotationDegrees(
  current: ReceiptRotationDegrees,
  action: 'left' | 'right' | 'reset',
): ReceiptRotationDegrees {
  if (action === 'reset') {
    return 0
  }
  if (action === 'right') {
    return rotateReceiptDegreesRight(current)
  }
  return rotateReceiptDegreesLeft(current)
}

export function getRotatedCanvasSize(
  sourceWidth: number,
  sourceHeight: number,
  degrees: ReceiptRotationDegrees,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(sourceWidth))
  const height = Math.max(1, Math.round(sourceHeight))
  if (degrees === 90 || degrees === 270) {
    return { width: height, height: width }
  }
  return { width, height }
}

export function hasAccountingReceiptOcrResult(input: {
  ocrRawText?: string | null
  ocrConfidence?: number | null
  ocrCandidates?: unknown
}): boolean {
  if (typeof input.ocrConfidence === 'number') {
    return true
  }
  if (input.ocrRawText?.trim()) {
    return true
  }
  return Boolean(input.ocrCandidates)
}

export function shouldFlagOcrRerunAfterRotation({
  hasOcrResult,
  previousDegrees,
  nextDegrees,
}: {
  hasOcrResult: boolean
  previousDegrees: ReceiptRotationDegrees
  nextDegrees: ReceiptRotationDegrees
}): boolean {
  return hasOcrResult && previousDegrees !== nextDegrees
}

const resolveOutputMimeType = (source: File | Blob): 'image/jpeg' | 'image/png' => {
  if (source.type === 'image/png') {
    return 'image/png'
  }
  return 'image/jpeg'
}

const toRotatedFileName = (source: File | Blob, mimeType: 'image/jpeg' | 'image/png') => {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'
  if (source instanceof File && source.name.trim()) {
    const baseName = source.name.replace(/\.[^.]+$/, '') || 'receipt'
    return `${baseName}.${extension}`
  }
  return `receipt.${extension}`
}

/**
 * Canvas で回転後の画像を生成します（CSS transform のみの表示変更ではありません）。
 * 90/270度では縦横サイズを入れ替え、欠け・余白が出ないように描画します。
 *
 * 呼び出し側では、品質劣化を避けるため必ず「0度の基準画像」から回転させてください。
 */
export async function rotateAccountingReceiptImage(
  source: File | Blob,
  degrees: ReceiptRotationDegrees,
): Promise<File> {
  const normalizedDegrees = normalizeReceiptRotationDegrees(degrees)
  if (normalizedDegrees === 0) {
    if (source instanceof File) {
      return source
    }
    const mimeType = resolveOutputMimeType(source)
    return new File([source], toRotatedFileName(source, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    })
  }

  const imageSource = await loadImageSource(source)
  const { width: sourceWidth, height: sourceHeight } = getImageDimensions(imageSource)

  if (!sourceWidth || !sourceHeight) {
    closeImageSource(imageSource)
    throw new Error(RECEIPT_ROTATION_ERROR_MESSAGE)
  }

  const { width, height } = getRotatedCanvasSize(sourceWidth, sourceHeight, normalizedDegrees)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    closeImageSource(imageSource)
    throw new Error(RECEIPT_ROTATION_ERROR_MESSAGE)
  }

  context.translate(width / 2, height / 2)
  context.rotate((normalizedDegrees * Math.PI) / 180)
  context.drawImage(imageSource, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
  closeImageSource(imageSource)

  const mimeType = resolveOutputMimeType(source)
  const quality = mimeType === 'image/jpeg' ? ROTATION_JPEG_QUALITY : undefined

  let outputBlob: Blob
  try {
    outputBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size <= 0) {
            reject(new Error(RECEIPT_ROTATION_ERROR_MESSAGE))
            return
          }
          resolve(blob)
        },
        mimeType,
        quality,
      )
    })
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === RECEIPT_ROTATION_ERROR_MESSAGE
        ? RECEIPT_ROTATION_ERROR_MESSAGE
        : RECEIPT_ROTATION_ERROR_MESSAGE,
      { cause: error },
    )
  }

  return new File([outputBlob], toRotatedFileName(source, mimeType), {
    type: mimeType,
    lastModified: Date.now(),
  })
}
