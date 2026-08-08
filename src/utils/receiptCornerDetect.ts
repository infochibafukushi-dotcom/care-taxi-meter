import type { ReceiptCornerDetectResult, ReceiptCorners, ReceiptPoint } from '../types/accountingReceiptLegal'
import {
  createFullImageCorners,
  scaleReceiptCorners,
  validateReceiptCorners,
} from './receiptCorners'

const DETECT_MAX_EDGE = 480

const toGray = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * 縮小画像上で前景マスクを作り、四隅候補を推定する（OpenCVなし）。
 * 失敗しても例外にせずフル画像四隅へフォールバックする。
 */
export async function detectReceiptCornersFromCanvas(
  source: HTMLCanvasElement,
): Promise<ReceiptCornerDetectResult> {
  const srcW = source.width
  const srcH = source.height
  if (srcW < 8 || srcH < 8) {
    return {
      corners: createFullImageCorners(Math.max(srcW, 1), Math.max(srcH, 1)),
      confidence: 'failed',
      message: '画像が小さいため範囲を確認してください',
    }
  }

  const scale = Math.min(1, DETECT_MAX_EDGE / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const detectCanvas = document.createElement('canvas')
  detectCanvas.width = w
  detectCanvas.height = h
  const ctx = detectCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '自動検出に失敗しました。範囲を確認してください',
    }
  }

  ctx.drawImage(source, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData

  // 背景推定: 四隅サンプル
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return toGray(data[i], data[i + 1], data[i + 2])
  }
  const bg =
    (sample(0, 0) +
      sample(w - 1, 0) +
      sample(0, h - 1) +
      sample(w - 1, h - 1) +
      sample(Math.floor(w / 2), 0) +
      sample(Math.floor(w / 2), h - 1)) /
    6

  const threshold = 28
  const mask = new Uint8Array(w * h)
  let fgCount = 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      const g = toGray(data[i], data[i + 1], data[i + 2])
      const isFg = Math.abs(g - bg) > threshold
      mask[y * w + x] = isFg ? 1 : 0
      if (isFg) {
        fgCount += 1
      }
    }
  }

  const fgRatio = fgCount / (w * h)
  if (fgRatio < 0.05 || fgRatio > 0.95) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '範囲を確認してください',
    }
  }

  // topLeft: x+y 最小, topRight: x-y 最大, bottomRight: x+y 最大, bottomLeft: y-x 最大
  const extreme: Record<keyof ReceiptCorners, { score: number; point: ReceiptPoint }> = {
    topLeft: { score: Number.POSITIVE_INFINITY, point: { x: 0, y: 0 } },
    topRight: { score: Number.NEGATIVE_INFINITY, point: { x: w - 1, y: 0 } },
    bottomRight: { score: Number.NEGATIVE_INFINITY, point: { x: w - 1, y: h - 1 } },
    bottomLeft: { score: Number.NEGATIVE_INFINITY, point: { x: 0, y: h - 1 } },
  }

  let found = false
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) {
        continue
      }
      found = true
      const sum = x + y
      const diff = x - y
      const anti = y - x
      if (sum < extreme.topLeft.score) {
        extreme.topLeft = { score: sum, point: { x, y } }
      }
      if (diff > extreme.topRight.score) {
        extreme.topRight = { score: diff, point: { x, y } }
      }
      if (sum > extreme.bottomRight.score) {
        extreme.bottomRight = { score: sum, point: { x, y } }
      }
      if (anti > extreme.bottomLeft.score) {
        extreme.bottomLeft = { score: anti, point: { x, y } }
      }
    }
  }

  if (!found) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '範囲を確認してください',
    }
  }

  const scaled: ReceiptCorners = {
    topLeft: extreme.topLeft.point,
    topRight: extreme.topRight.point,
    bottomRight: extreme.bottomRight.point,
    bottomLeft: extreme.bottomLeft.point,
  }

  const invScale = 1 / scale
  const corners = scaleReceiptCorners(scaled, invScale, invScale)
  const validation = validateReceiptCorners(corners, srcW, srcH, { minAreaRatio: 0.04 })

  if (!validation.ok) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '範囲を確認してください',
    }
  }

  const areaRatio =
    // rough: use scaled area
    ((Math.abs(
      (scaled.topLeft.x * scaled.topRight.y - scaled.topRight.x * scaled.topLeft.y) +
        (scaled.topRight.x * scaled.bottomRight.y - scaled.bottomRight.x * scaled.topRight.y) +
        (scaled.bottomRight.x * scaled.bottomLeft.y - scaled.bottomLeft.x * scaled.bottomRight.y) +
        (scaled.bottomLeft.x * scaled.topLeft.y - scaled.topLeft.x * scaled.bottomLeft.y),
    ) /
      2) /
      (w * h))

  if (areaRatio < 0.12 || areaRatio > 0.92) {
    return {
      corners,
      confidence: 'low',
      message: '範囲を確認してください',
    }
  }

  return {
    corners,
    confidence: 'high',
  }
}
