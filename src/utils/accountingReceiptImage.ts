const MAX_OCR_DIMENSION = 2048
const JPEG_QUALITY = 0.88

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
      reject(new Error('証憑画像を表示できませんでした。JPEG または PNG で再撮影してください。'))
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
  if (imageSource instanceof HTMLImageElement) {
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

const toNormalizedFileName = (source: File | Blob) => {
  if (source instanceof File && source.name.trim()) {
    return `${source.name.replace(/\.[^.]+$/, '') || 'receipt'}.jpg`
  }

  return 'receipt.jpg'
}

/**
 * スマホ撮影画像を OCR / プレビュー向けに JPEG へ正規化し、巨大画像は縮小します。
 */
export async function normalizeAccountingReceiptImage(source: File | Blob): Promise<File> {
  const imageSource = await loadImageSource(source)
  const { width: sourceWidth, height: sourceHeight } = getImageDimensions(imageSource)
  const longestEdge = Math.max(sourceWidth, sourceHeight, 1)
  const scale = Math.min(1, MAX_OCR_DIMENSION / longestEdge)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    closeImageSource(imageSource)
    throw new Error('証憑画像の変換に失敗しました。')
  }

  context.drawImage(imageSource, 0, 0, width, height)
  closeImageSource(imageSource)

  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('証憑画像の変換に失敗しました。'))
          return
        }

        resolve(blob)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })

  return new File([jpegBlob], toNormalizedFileName(source), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}
