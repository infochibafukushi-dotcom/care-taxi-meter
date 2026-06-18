import { appendEscPosFeedAndCut } from './escPosCommands'

const ESC = 0x1b
const GS = 0x1d

/** 1 ストリップあたりのラスター行数（プリンタバッファ対策） */
const RASTER_STRIP_HEIGHT = 128

/** 白背景とみなす輝度しきい値（0–255） */
const MONOCHROME_THRESHOLD = 180

type RasterStrip = {
  widthPx: number
  heightPx: number
  data: Uint8Array
}

export function appendEscPosReset(chunks: number[]) {
  chunks.push(ESC, 0x40)
}

/**
 * GS v 0 — ラスタービットイメージ（モノクロ）
 * @see ESC/POS GS ( v ) — Print raster bit image
 */
export function appendEscPosRasterStrip(
  chunks: number[],
  widthPx: number,
  heightPx: number,
  rasterData: Uint8Array,
  mode = 0,
) {
  const bytesPerRow = Math.ceil(widthPx / 8)
  chunks.push(
    GS,
    0x76,
    0x30,
    mode,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    heightPx & 0xff,
    (heightPx >> 8) & 0xff,
    ...rasterData,
  )
}

function findContentBottom(imageData: ImageData, width: number, height: number): number {
  const { data } = imageData
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
      if (luminance < 250) {
        return y + 1
      }
    }
  }
  return height
}

function resolveContentHeight(canvas: HTMLCanvasElement, imageData: ImageData): number {
  const datasetBottom = Number(canvas.dataset.contentBottom)
  if (Number.isFinite(datasetBottom) && datasetBottom > 0) {
    return Math.min(Math.ceil(datasetBottom), canvas.height)
  }
  return findContentBottom(imageData, canvas.width, canvas.height)
}

function imageDataToRasterStrip(
  imageData: ImageData,
  width: number,
  startY: number,
  stripHeight: number,
): RasterStrip {
  const heightPx = stripHeight
  const bytesPerRow = Math.ceil(width / 8)
  const data = new Uint8Array(bytesPerRow * heightPx)

  for (let y = 0; y < heightPx; y += 1) {
    const sourceY = startY + y
    for (let x = 0; x < width; x += 1) {
      const index = (sourceY * width + x) * 4
      const luminance =
        0.299 * imageData.data[index] +
        0.587 * imageData.data[index + 1] +
        0.114 * imageData.data[index + 2]
      if (luminance < MONOCHROME_THRESHOLD) {
        const byteIndex = y * bytesPerRow + (x >> 3)
        const bit = 7 - (x & 7)
        data[byteIndex] |= 1 << bit
      }
    }
  }

  return { widthPx: width, heightPx, data }
}

export function canvasToRasterStrips(canvas: HTMLCanvasElement): RasterStrip[] {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D コンテキストを取得できません。')
  }

  const width = canvas.width
  const imageData = context.getImageData(0, 0, width, canvas.height)
  const contentHeight = resolveContentHeight(canvas, imageData)
  const strips: RasterStrip[] = []

  for (let startY = 0; startY < contentHeight; startY += RASTER_STRIP_HEIGHT) {
    const stripHeight = Math.min(RASTER_STRIP_HEIGHT, contentHeight - startY)
    strips.push(imageDataToRasterStrip(imageData, width, startY, stripHeight))
  }

  return strips
}

export function appendEscPosRasterFromCanvas(chunks: number[], canvas: HTMLCanvasElement) {
  const strips = canvasToRasterStrips(canvas)
  for (const strip of strips) {
    appendEscPosRasterStrip(chunks, strip.widthPx, strip.heightPx, strip.data)
  }
}

/** Canvas を GS v 0 ラスター印字データ（初期化 + 画像 + カット）に変換 */
export function buildEscPosRasterFromCanvas(
  canvas: HTMLCanvasElement,
  feedLines = 3,
): Uint8Array {
  const chunks: number[] = []
  appendEscPosReset(chunks)
  appendEscPosRasterFromCanvas(chunks, canvas)
  appendEscPosFeedAndCut(chunks, feedLines)
  return Uint8Array.from(chunks)
}
