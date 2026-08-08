import type { ReceiptCorners, ReceiptPoint } from '../types/accountingReceiptLegal'
import { polygonArea, validateReceiptCorners } from './receiptCorners'

export type PerspectiveOutputSize = {
  width: number
  height: number
}

const distance = (a: ReceiptPoint, b: ReceiptPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/** 補正後の出力サイズ（実ピクセル。アップスケールしない） */
export function estimatePerspectiveOutputSize(corners: ReceiptCorners): PerspectiveOutputSize {
  const widthTop = distance(corners.topLeft, corners.topRight)
  const widthBottom = distance(corners.bottomLeft, corners.bottomRight)
  const heightLeft = distance(corners.topLeft, corners.bottomLeft)
  const heightRight = distance(corners.topRight, corners.bottomRight)
  const width = Math.max(1, Math.round(Math.max(widthTop, widthBottom)))
  const height = Math.max(1, Math.round(Math.max(heightLeft, heightRight)))
  return { width, height }
}

/**
 * 8自由度の射影変換係数を解く（src -> dst）。
 * 返却: [a,b,c,d,e,f,g,h] where
 * x' = (a x + b y + c) / (g x + h y + 1)
 * y' = (d x + e y + f) / (g x + h y + 1)
 */
export function solveHomography(
  src: ReceiptPoint[],
  dst: ReceiptPoint[],
): number[] | null {
  if (src.length !== 4 || dst.length !== 4) {
    return null
  }

  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i]
    const u = dst[i].x
    const v = dst[i].y
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }

  return solveLinearSystem(A, b)
}

/** ガウス消去（8x8） */
function solveLinearSystem(Ainput: number[][], bInput: number[]): number[] | null {
  const n = bInput.length
  const M = Ainput.map((row, i) => [...row, bInput[i]])

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) {
        pivot = row
      }
    }
    if (Math.abs(M[pivot][col]) < 1e-10) {
      return null
    }
    if (pivot !== col) {
      const tmp = M[col]
      M[col] = M[pivot]
      M[pivot] = tmp
    }
    const div = M[col][col]
    for (let j = col; j <= n; j += 1) {
      M[col][j] /= div
    }
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = M[row][col]
      for (let j = col; j <= n; j += 1) {
        M[row][j] -= factor * M[col][j]
      }
    }
  }

  return M.map((row) => row[n])
}

export function invertHomography(h: number[]): number[] | null {
  // h maps src->dst. Build 3x3 and invert.
  const H = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ]
  const det =
    H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) -
    H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) +
    H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0])
  if (Math.abs(det) < 1e-12) {
    return null
  }
  const invDet = 1 / det
  const R = [
    [
      (H[1][1] * H[2][2] - H[1][2] * H[2][1]) * invDet,
      (H[0][2] * H[2][1] - H[0][1] * H[2][2]) * invDet,
      (H[0][1] * H[1][2] - H[0][2] * H[1][1]) * invDet,
    ],
    [
      (H[1][2] * H[2][0] - H[1][0] * H[2][2]) * invDet,
      (H[0][0] * H[2][2] - H[0][2] * H[2][0]) * invDet,
      (H[0][2] * H[1][0] - H[0][0] * H[1][2]) * invDet,
    ],
    [
      (H[1][0] * H[2][1] - H[1][1] * H[2][0]) * invDet,
      (H[0][1] * H[2][0] - H[0][0] * H[2][1]) * invDet,
      (H[0][0] * H[1][1] - H[0][1] * H[1][0]) * invDet,
    ],
  ]
  const norm = R[2][2]
  if (Math.abs(norm) < 1e-12) {
    return null
  }
  return [
    R[0][0] / norm,
    R[0][1] / norm,
    R[0][2] / norm,
    R[1][0] / norm,
    R[1][1] / norm,
    R[1][2] / norm,
    R[2][0] / norm,
    R[2][1] / norm,
  ]
}

const applyHomography = (h: number[], x: number, y: number): ReceiptPoint => {
  const denom = h[6] * x + h[7] * y + 1
  if (Math.abs(denom) < 1e-12) {
    return { x: 0, y: 0 }
  }
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom,
  }
}

const sampleBilinear = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] => {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    const cx = Math.min(Math.max(Math.round(x), 0), width - 1)
    const cy = Math.min(Math.max(Math.round(y), 0), height - 1)
    const i = (cy * width + cx) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const dx = x - x0
  const dy = y - y0
  const idx = (yy: number, xx: number) => (yy * width + xx) * 4
  const i00 = idx(y0, x0)
  const i10 = idx(y0, x1)
  const i01 = idx(y1, x0)
  const i11 = idx(y1, x1)
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c += 1) {
    const v =
      data[i00 + c] * (1 - dx) * (1 - dy) +
      data[i10 + c] * dx * (1 - dy) +
      data[i01 + c] * (1 - dx) * dy +
      data[i11 + c] * dx * dy
    out[c] = v
  }
  return out
}

export type PerspectiveTransformResult = {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * 四隅から正面補正画像を生成する。アップスケールしない。
 */
export function applyPerspectiveTransform(
  source: HTMLCanvasElement,
  corners: ReceiptCorners,
): PerspectiveTransformResult {
  const validation = validateReceiptCorners(corners, source.width, source.height)
  if (!validation.ok) {
    throw new Error(`四隅が不正です: ${validation.reasons.join('、')}`)
  }

  const { width, height } = estimatePerspectiveOutputSize(corners)
  if (width < 2 || height < 2) {
    throw new Error('補正後画像のサイズが不正です。四隅を修正してください。')
  }

  // 極端な引き伸ばし防止（面積比）
  const srcArea = polygonArea(corners)
  const dstArea = width * height
  if (dstArea > srcArea * 8) {
    throw new Error('画像が極端に引き伸ばされるため補正できません。四隅を修正してください。')
  }

  const srcPoints = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ]
  const dstPoints = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]

  const forward = solveHomography(srcPoints, dstPoints)
  if (!forward) {
    throw new Error('台形補正に失敗しました。四隅を修正してください。')
  }
  const inverse = invertHomography(forward)
  if (!inverse) {
    throw new Error('台形補正に失敗しました。四隅を修正してください。')
  }

  // 上下左右の反転チェック（変換後の辺方向）
  const mappedTopLeft = applyHomography(forward, corners.topLeft.x, corners.topLeft.y)
  const mappedTopRight = applyHomography(forward, corners.topRight.x, corners.topRight.y)
  const mappedBottomLeft = applyHomography(forward, corners.bottomLeft.x, corners.bottomLeft.y)
  if (mappedTopRight.x < mappedTopLeft.x - 1) {
    throw new Error('横方向が反転しました。四隅を修正してください。')
  }
  if (mappedBottomLeft.y < mappedTopLeft.y - 1) {
    throw new Error('上下が逆転しました。四隅を修正してください。')
  }

  const srcCtx = source.getContext('2d', { willReadFrequently: true })
  if (!srcCtx) {
    throw new Error('台形補正に失敗しました。')
  }
  const srcData = srcCtx.getImageData(0, 0, source.width, source.height).data

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const dstCtx = canvas.getContext('2d')
  if (!dstCtx) {
    throw new Error('台形補正に失敗しました。')
  }
  const out = dstCtx.createImageData(width, height)
  const outData = out.data

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = applyHomography(inverse, x, y)
      const [r, g, b, a] = sampleBilinear(srcData, source.width, source.height, src.x, src.y)
      const i = (y * width + x) * 4
      outData[i] = r
      outData[i + 1] = g
      outData[i + 2] = b
      outData[i + 3] = a
    }
  }

  dstCtx.putImageData(out, 0, 0)
  return { canvas, width, height }
}
