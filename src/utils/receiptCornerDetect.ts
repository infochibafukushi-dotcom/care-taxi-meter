import type { ReceiptCornerDetectResult, ReceiptCorners, ReceiptPoint } from '../types/accountingReceiptLegal'
import {
  createFullImageCorners,
  scaleReceiptCorners,
  validateReceiptCorners,
} from './receiptCorners'

const DETECT_MAX_EDGE = 480

const toGray = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

const quadArea = (corners: ReceiptCorners) =>
  Math.abs(
    corners.topLeft.x * corners.topRight.y -
      corners.topRight.x * corners.topLeft.y +
      (corners.topRight.x * corners.bottomRight.y - corners.bottomRight.x * corners.topRight.y) +
      (corners.bottomRight.x * corners.bottomLeft.y - corners.bottomLeft.x * corners.bottomRight.y) +
      (corners.bottomLeft.x * corners.topLeft.y - corners.topLeft.x * corners.bottomLeft.y),
  ) / 2

const sideLength = (a: ReceiptPoint, b: ReceiptPoint) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

/** 直角性・長方形らしさ（1に近いほど良い） */
const rectangleLikeness = (corners: ReceiptCorners) => {
  const edges = [
    sideLength(corners.topLeft, corners.topRight),
    sideLength(corners.topRight, corners.bottomRight),
    sideLength(corners.bottomRight, corners.bottomLeft),
    sideLength(corners.bottomLeft, corners.topLeft),
  ]
  if (edges.some((edge) => edge < 1)) {
    return 0
  }
  const oppositeRatio =
    Math.min(edges[0], edges[2]) / Math.max(edges[0], edges[2]) *
    (Math.min(edges[1], edges[3]) / Math.max(edges[1], edges[3]))
  // 隣接辺の内積で直角性を近似
  const vectors = [
    [corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y],
    [corners.bottomRight.x - corners.topRight.x, corners.bottomRight.y - corners.topRight.y],
    [corners.bottomLeft.x - corners.bottomRight.x, corners.bottomLeft.y - corners.bottomRight.y],
    [corners.topLeft.x - corners.bottomLeft.x, corners.topLeft.y - corners.bottomLeft.y],
  ] as const
  let rightAngleScore = 0
  for (let i = 0; i < 4; i += 1) {
    const a = vectors[i]
    const b = vectors[(i + 1) % 4]
    const denom = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])
    if (denom < 1e-6) {
      continue
    }
    const cos = Math.abs((a[0] * b[0] + a[1] * b[1]) / denom)
    rightAngleScore += 1 - Math.min(1, cos)
  }
  return oppositeRatio * 0.45 + (rightAngleScore / 4) * 0.55
}

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

  // グレースケール + 簡易コントラスト強調（OpenCVなし）
  const gray = new Float32Array(w * h)
  let minG = 255
  let maxG = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const g = toGray(data[i], data[i + 1], data[i + 2])
    gray[p] = g
    if (g < minG) minG = g
    if (g > maxG) maxG = g
  }
  const span = Math.max(1, maxG - minG)
  for (let p = 0; p < gray.length; p += 1) {
    gray[p] = ((gray[p] - minG) / span) * 255
  }

  const sample = (x: number, y: number) => gray[y * w + x]
  const bg =
    (sample(0, 0) +
      sample(w - 1, 0) +
      sample(0, h - 1) +
      sample(w - 1, h - 1) +
      sample(Math.floor(w / 2), 0) +
      sample(Math.floor(w / 2), h - 1) +
      sample(0, Math.floor(h / 2)) +
      sample(w - 1, Math.floor(h / 2))) /
    8

  type Candidate = {
    corners: ReceiptCorners
    score: number
    areaRatio: number
  }
  const candidates: Candidate[] = []
  const tryThresholds = [22, 34, 48]

  for (const threshold of tryThresholds) {
    const mask = new Uint8Array(w * h)
    let fgCount = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const isFg = Math.abs(gray[y * w + x] - bg) > threshold
        mask[y * w + x] = isFg ? 1 : 0
        if (isFg) {
          fgCount += 1
        }
      }
    }
    const fgRatio = fgCount / (w * h)
    if (fgRatio < 0.05 || fgRatio > 0.95) {
      continue
    }

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
      continue
    }

    const scaled: ReceiptCorners = {
      topLeft: extreme.topLeft.point,
      topRight: extreme.topRight.point,
      bottomRight: extreme.bottomRight.point,
      bottomLeft: extreme.bottomLeft.point,
    }
    const areaRatio = quadArea(scaled) / (w * h)
    if (areaRatio < 0.12 || areaRatio > 0.92) {
      continue
    }
    const rectScore = rectangleLikeness(scaled)
    candidates.push({
      corners: scaled,
      score: rectScore * 0.7 + Math.min(areaRatio, 0.7) * 0.3,
      areaRatio,
    })
  }

  if (candidates.length === 0) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '範囲を確認してください',
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const invScale = 1 / scale
  const corners = scaleReceiptCorners(best.corners, invScale, invScale)
  const validation = validateReceiptCorners(corners, srcW, srcH, { minAreaRatio: 0.04 })

  if (!validation.ok) {
    return {
      corners: createFullImageCorners(srcW, srcH),
      confidence: 'failed',
      message: '範囲を確認してください',
    }
  }

  if (best.score < 0.55 || best.areaRatio < 0.15 || best.areaRatio > 0.9) {
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
