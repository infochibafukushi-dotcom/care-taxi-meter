import type { ReceiptLegalMasterResult, ReceiptPaperSizeSelection } from '../types/accountingReceiptLegal'
import {
  computeDpiFromPaper,
  LEGAL_MIN_DPI,
  maxDownscaleFactorForDpi,
} from './receiptLegalDpi'
import { canvasToJpegBlob } from './receiptImageOrientation'

/** Storage rules 現行上限（未満） */
export const LEGAL_MASTER_MAX_BYTES = 10 * 1024 * 1024

/** 必要以上に巨大な画像だけ縮小する閾値（長辺） */
const HUGE_EDGE_PX = 4500

const QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76]

export const LEGAL_MASTER_TOO_LARGE_MESSAGE =
  '保存画像が10MBを超えています。法定画質を維持したまま保存できません。'

const drawScaled = (source: HTMLCanvasElement, scale: number): HTMLCanvasElement => {
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('法定保存候補画像の生成に失敗しました。')
  }
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/**
 * 法定保存候補 JPEG マスターを生成する。
 * - アップスケール禁止
 * - 200dpi を下回る縮小はしない
 * - 一律KB上限で再圧縮しない（10MB超のみ失敗）
 */
export async function createLegalReceiptMaster(params: {
  correctedCanvas: HTMLCanvasElement
  paper: ReceiptPaperSizeSelection
}): Promise<ReceiptLegalMasterResult> {
  const { correctedCanvas, paper } = params
  const baseDpi = computeDpiFromPaper({
    widthPx: correctedCanvas.width,
    heightPx: correctedCanvas.height,
    paperWidthMm: paper.paperWidthMm,
    paperHeightMm: paper.paperHeightMm,
  })

  if (baseDpi.estimatedDpi < LEGAL_MIN_DPI) {
    throw new Error(
      'スキャナ保存用の解像度が不足しています。もう少し領収書に近づいて撮影してください。',
    )
  }

  const minScaleForDpi = maxDownscaleFactorForDpi({
    widthPx: correctedCanvas.width,
    heightPx: correctedCanvas.height,
    paperWidthMm: paper.paperWidthMm,
    paperHeightMm: paper.paperHeightMm,
  })

  const longest = Math.max(correctedCanvas.width, correctedCanvas.height)
  let scale = 1
  if (longest > HUGE_EDGE_PX) {
    // 巨大画像のみ縮小。200dpi を下回らない最小 scale 以上を維持。
    const targetScale = HUGE_EDGE_PX / longest
    scale = Math.max(minScaleForDpi, Math.min(1, targetScale))
  }

  let working = scale < 0.999 ? drawScaled(correctedCanvas, scale) : correctedCanvas
  let widthPx = working.width
  let heightPx = working.height

  let chosenBlob: Blob | null = null
  let chosenQuality = QUALITY_STEPS[0]

  for (const quality of QUALITY_STEPS) {
    const blob = await canvasToJpegBlob(working, quality)
    chosenBlob = blob
    chosenQuality = quality
    // 目標: 典型的に軽量化。ただし必須上限は 10MB のみ。
    // 品質を下げすぎないため、2MB未満ならそこで打ち切り。
    if (blob.size <= 2 * 1024 * 1024) {
      break
    }
  }

  if (!chosenBlob) {
    throw new Error('法定保存候補JPEGの生成に失敗しました。')
  }

  if (chosenBlob.size >= LEGAL_MASTER_MAX_BYTES) {
    // dpi を落とさず quality だけさらに試す（下限あり）
    for (const quality of [0.72, 0.68]) {
      const blob = await canvasToJpegBlob(working, quality)
      chosenBlob = blob
      chosenQuality = quality
      if (blob.size < LEGAL_MASTER_MAX_BYTES) {
        break
      }
    }
  }

  if (chosenBlob.size >= LEGAL_MASTER_MAX_BYTES) {
    // 最後の手段: dpi を維持する最大縮小のみ（200dpi未満にはしない）
    if (minScaleForDpi < 0.98) {
      working = drawScaled(correctedCanvas, minScaleForDpi)
      widthPx = working.width
      heightPx = working.height
      chosenBlob = await canvasToJpegBlob(working, 0.8)
      chosenQuality = 0.8
    }
  }

  if (chosenBlob.size >= LEGAL_MASTER_MAX_BYTES) {
    throw new Error(LEGAL_MASTER_TOO_LARGE_MESSAGE)
  }

  const finalDpi = computeDpiFromPaper({
    widthPx,
    heightPx,
    paperWidthMm: paper.paperWidthMm,
    paperHeightMm: paper.paperHeightMm,
  })

  if (finalDpi.estimatedDpi < LEGAL_MIN_DPI) {
    throw new Error(
      'スキャナ保存用の解像度が不足しています。もう少し領収書に近づいて撮影してください。',
    )
  }

  return {
    masterBlob: chosenBlob,
    widthPx,
    heightPx,
    quality: chosenQuality,
    fileSizeBytes: chosenBlob.size,
    estimatedDpi: finalDpi.estimatedDpi,
  }
}

/** 補正済み Canvas がカラーか（ほぼグレースケールなら false） */
export function detectCanvasIsColor(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return true
  }
  const sampleW = Math.min(canvas.width, 64)
  const sampleH = Math.min(canvas.height, 64)
  const tmp = document.createElement('canvas')
  tmp.width = sampleW
  tmp.height = sampleH
  const tctx = tmp.getContext('2d')
  if (!tctx) {
    return true
  }
  tctx.drawImage(canvas, 0, 0, sampleW, sampleH)
  const data = tctx.getImageData(0, 0, sampleW, sampleH).data
  let colorful = 0
  let total = 0
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    total += 1
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) {
      colorful += 1
    }
  }
  return total === 0 ? true : colorful / total > 0.02
}
