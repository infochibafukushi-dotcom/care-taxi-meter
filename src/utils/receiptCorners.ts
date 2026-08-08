import type { ReceiptCorners, ReceiptPoint } from '../types/accountingReceiptLegal'

export type DisplayRect = {
  offsetX: number
  offsetY: number
  displayWidth: number
  displayHeight: number
  imageWidth: number
  imageHeight: number
}

export const cloneReceiptCorners = (corners: ReceiptCorners): ReceiptCorners => ({
  topLeft: { ...corners.topLeft },
  topRight: { ...corners.topRight },
  bottomRight: { ...corners.bottomRight },
  bottomLeft: { ...corners.bottomLeft },
})

export const createFullImageCorners = (width: number, height: number): ReceiptCorners => {
  const inset = Math.max(2, Math.min(width, height) * 0.02)
  return {
    topLeft: { x: inset, y: inset },
    topRight: { x: width - inset, y: inset },
    bottomRight: { x: width - inset, y: height - inset },
    bottomLeft: { x: inset, y: height - inset },
  }
}

export const scaleReceiptCorners = (
  corners: ReceiptCorners,
  scaleX: number,
  scaleY: number,
): ReceiptCorners => ({
  topLeft: { x: corners.topLeft.x * scaleX, y: corners.topLeft.y * scaleY },
  topRight: { x: corners.topRight.x * scaleX, y: corners.topRight.y * scaleY },
  bottomRight: { x: corners.bottomRight.x * scaleX, y: corners.bottomRight.y * scaleY },
  bottomLeft: { x: corners.bottomLeft.x * scaleX, y: corners.bottomLeft.y * scaleY },
})

/** 表示座標 → 元画像座標 */
export const displayPointToImagePoint = (
  point: ReceiptPoint,
  rect: DisplayRect,
): ReceiptPoint => {
  const x = ((point.x - rect.offsetX) / Math.max(rect.displayWidth, 1)) * rect.imageWidth
  const y = ((point.y - rect.offsetY) / Math.max(rect.displayHeight, 1)) * rect.imageHeight
  return { x, y }
}

/** 元画像座標 → 表示座標 */
export const imagePointToDisplayPoint = (
  point: ReceiptPoint,
  rect: DisplayRect,
): ReceiptPoint => {
  const x = rect.offsetX + (point.x / Math.max(rect.imageWidth, 1)) * rect.displayWidth
  const y = rect.offsetY + (point.y / Math.max(rect.imageHeight, 1)) * rect.displayHeight
  return { x, y }
}

export const cornersToDisplay = (corners: ReceiptCorners, rect: DisplayRect): ReceiptCorners => ({
  topLeft: imagePointToDisplayPoint(corners.topLeft, rect),
  topRight: imagePointToDisplayPoint(corners.topRight, rect),
  bottomRight: imagePointToDisplayPoint(corners.bottomRight, rect),
  bottomLeft: imagePointToDisplayPoint(corners.bottomLeft, rect),
})

export const cornersFromDisplay = (corners: ReceiptCorners, rect: DisplayRect): ReceiptCorners => ({
  topLeft: displayPointToImagePoint(corners.topLeft, rect),
  topRight: displayPointToImagePoint(corners.topRight, rect),
  bottomRight: displayPointToImagePoint(corners.bottomRight, rect),
  bottomLeft: displayPointToImagePoint(corners.bottomLeft, rect),
})

const cross = (a: ReceiptPoint, b: ReceiptPoint, c: ReceiptPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsIntersect = (p1: ReceiptPoint, p2: ReceiptPoint, p3: ReceiptPoint, p4: ReceiptPoint) => {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

export const polygonArea = (corners: ReceiptCorners) => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  let area = 0
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

export type ReceiptCornersValidation = {
  ok: boolean
  reasons: string[]
}

/**
 * 四角形として妥当か検証する。
 * 長いレシート（細長い四角形）は除外しない。
 */
export function validateReceiptCorners(
  corners: ReceiptCorners,
  imageWidth: number,
  imageHeight: number,
  options?: { minAreaRatio?: number },
): ReceiptCornersValidation {
  const reasons: string[] = []
  const minAreaRatio = options?.minAreaRatio ?? 0.02
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  const margin = 1

  for (const point of pts) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < -margin ||
      point.y < -margin ||
      point.x > imageWidth + margin ||
      point.y > imageHeight + margin
    ) {
      reasons.push('座標が画像外です')
      break
    }
  }

  if (segmentsIntersect(corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight)) {
    reasons.push('辺が交差しています')
  }
  if (segmentsIntersect(corners.topLeft, corners.bottomLeft, corners.topRight, corners.bottomRight)) {
    reasons.push('辺が交差しています')
  }

  const area = polygonArea(corners)
  const imageArea = Math.max(imageWidth * imageHeight, 1)
  if (area / imageArea < minAreaRatio) {
    reasons.push('選択範囲が小さすぎます')
  }

  const widthTop = Math.hypot(
    corners.topRight.x - corners.topLeft.x,
    corners.topRight.y - corners.topLeft.y,
  )
  const widthBottom = Math.hypot(
    corners.bottomRight.x - corners.bottomLeft.x,
    corners.bottomRight.y - corners.bottomLeft.y,
  )
  const heightLeft = Math.hypot(
    corners.bottomLeft.x - corners.topLeft.x,
    corners.bottomLeft.y - corners.topLeft.y,
  )
  const heightRight = Math.hypot(
    corners.bottomRight.x - corners.topRight.x,
    corners.bottomRight.y - corners.topRight.y,
  )
  const minSide = Math.min(widthTop, widthBottom, heightLeft, heightRight)
  if (minSide < 8) {
    reasons.push('辺が極端に短いです')
  }

  // 点が交差した自己交差ポリゴン（時計回り/反時計が崩れている）を面積符号で簡易検出
  const signed =
    cross(corners.topLeft, corners.topRight, corners.bottomRight) +
    cross(corners.topRight, corners.bottomRight, corners.bottomLeft) +
    cross(corners.bottomRight, corners.bottomLeft, corners.topLeft) +
    cross(corners.bottomLeft, corners.topLeft, corners.topRight)
  if (Math.abs(signed) < 1) {
    reasons.push('四角形として不正です')
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] }
}

export const clampPointToImage = (
  point: ReceiptPoint,
  imageWidth: number,
  imageHeight: number,
): ReceiptPoint => ({
  x: Math.min(Math.max(point.x, 0), Math.max(imageWidth - 1, 0)),
  y: Math.min(Math.max(point.y, 0), Math.max(imageHeight - 1, 0)),
})

export const clampCornersToImage = (
  corners: ReceiptCorners,
  imageWidth: number,
  imageHeight: number,
): ReceiptCorners => ({
  topLeft: clampPointToImage(corners.topLeft, imageWidth, imageHeight),
  topRight: clampPointToImage(corners.topRight, imageWidth, imageHeight),
  bottomRight: clampPointToImage(corners.bottomRight, imageWidth, imageHeight),
  bottomLeft: clampPointToImage(corners.bottomLeft, imageWidth, imageHeight),
})

/**
 * 角を動かしたとき自己交差になる場合は拒否し、直前の corners を返す。
 */
export function moveReceiptCornerSafely(
  corners: ReceiptCorners,
  key: keyof ReceiptCorners,
  nextPoint: ReceiptPoint,
  imageWidth: number,
  imageHeight: number,
): ReceiptCorners {
  const candidate = clampCornersToImage(
    { ...corners, [key]: nextPoint },
    imageWidth,
    imageHeight,
  )
  const validation = validateReceiptCorners(candidate, imageWidth, imageHeight, {
    minAreaRatio: 0.01,
  })
  return validation.ok ? candidate : corners
}
