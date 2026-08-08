export type OrientedReceiptImage = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** createImageBitmap を使った場合は解放用 */
  bitmap?: ImageBitmap
}

const closeBitmap = (bitmap?: ImageBitmap) => {
  if (bitmap && typeof bitmap.close === 'function') {
    bitmap.close()
  }
}

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
      reject(new Error('画像を読み込めませんでした。JPEG / PNG / WebP で再撮影してください。'))
    }
    image.src = objectUrl
  })

/** JPEG EXIF Orientation (1-8) を読む。非JPEGや未設定は 1。 */
export async function readJpegExifOrientation(blob: Blob): Promise<number> {
  if (!blob.type.includes('jpeg') && !blob.type.includes('jpg')) {
    return 1
  }

  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return 1
  }

  let offset = 2
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false)
    offset += 2
    if (marker === 0xffe1) {
      const size = view.getUint16(offset, false)
      const exifStart = offset + 2
      if (
        exifStart + 6 < view.byteLength &&
        view.getUint32(exifStart, false) === 0x45786966 &&
        view.getUint16(exifStart + 4, false) === 0x0000
      ) {
        const tiff = exifStart + 6
        const little = view.getUint16(tiff, false) === 0x4949
        const magic = view.getUint16(tiff + 2, little)
        if (magic !== 0x002a) {
          return 1
        }
        const ifdOffset = view.getUint32(tiff + 4, little)
        let entries = tiff + ifdOffset
        if (entries + 2 > view.byteLength) {
          return 1
        }
        const count = view.getUint16(entries, little)
        entries += 2
        for (let i = 0; i < count; i += 1) {
          const entry = entries + i * 12
          if (entry + 12 > view.byteLength) {
            break
          }
          const tag = view.getUint16(entry, little)
          if (tag === 0x0112) {
            return view.getUint16(entry + 8, little) || 1
          }
        }
      }
      offset += size
    } else if ((marker & 0xff00) !== 0xff00) {
      break
    } else if (marker === 0xffda) {
      break
    } else {
      offset += view.getUint16(offset, false)
    }
  }
  return 1
}

const drawOriented = (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  orientation: number,
): HTMLCanvasElement => {
  const swap = orientation >= 5 && orientation <= 8
  const canvas = document.createElement('canvas')
  canvas.width = swap ? sourceHeight : sourceWidth
  canvas.height = swap ? sourceWidth : sourceHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('画像の向き補正に失敗しました。')
  }

  switch (orientation) {
    case 2:
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      break
    case 3:
      ctx.translate(canvas.width, canvas.height)
      ctx.rotate(Math.PI)
      break
    case 4:
      ctx.translate(0, canvas.height)
      ctx.scale(1, -1)
      break
    case 5:
      ctx.rotate(0.5 * Math.PI)
      ctx.scale(1, -1)
      break
    case 6:
      ctx.rotate(0.5 * Math.PI)
      ctx.translate(0, -sourceHeight)
      break
    case 7:
      ctx.rotate(0.5 * Math.PI)
      ctx.translate(sourceWidth, -sourceHeight)
      ctx.scale(-1, 1)
      break
    case 8:
      ctx.rotate(-0.5 * Math.PI)
      ctx.translate(-sourceWidth, 0)
      break
    default:
      break
  }

  ctx.drawImage(source, 0, 0)
  return canvas
}

/**
 * EXIF Orientation を反映した向き補正済み Canvas を返す。
 * 以後の四隅座標はこの画像を基準にする。
 */
export async function loadOrientedReceiptImage(blob: Blob): Promise<OrientedReceiptImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        closeBitmap(bitmap)
        throw new Error('画像の向き補正に失敗しました。')
      }
      ctx.drawImage(bitmap, 0, 0)
      closeBitmap(bitmap)
      return { canvas, width: canvas.width, height: canvas.height }
    } catch {
      // fall through
    }
  }

  const orientation = await readJpegExifOrientation(blob)
  const image = await loadImageElement(blob)
  const canvas = drawOriented(image, image.naturalWidth, image.naturalHeight, orientation)
  return { canvas, width: canvas.width, height: canvas.height }
}

export async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/jpeg', quality)
  })
  if (!blob) {
    throw new Error('JPEG画像の生成に失敗しました。')
  }
  return blob
}

export async function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/webp', quality)
  })
  if (!blob) {
    throw new Error('WebPサムネイルの生成に失敗しました。')
  }
  return blob
}
