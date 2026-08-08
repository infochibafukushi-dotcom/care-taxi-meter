import type {
  ReceiptLegalQualityResult,
  ReceiptPaperSizeSelection,
  ReceiptPaperSizeType,
} from '../types/accountingReceiptLegal'

export const LEGAL_MIN_DPI = 200

/** mm → inch */
export const mmToInch = (mm: number) => mm / 25.4

export type PaperPreset = {
  type: ReceiptPaperSizeType
  label: string
  widthMm: number
  heightMm?: number
  kind: 'sheet' | 'receipt' | 'custom'
}

export const PAPER_PRESETS: PaperPreset[] = [
  { type: 'a4', label: 'A4', widthMm: 210, heightMm: 297, kind: 'sheet' },
  { type: 'a5', label: 'A5', widthMm: 148, heightMm: 210, kind: 'sheet' },
  { type: 'b5', label: 'B5', widthMm: 182, heightMm: 257, kind: 'sheet' },
  { type: 'receipt_58', label: 'レシート 58mm', widthMm: 58, kind: 'receipt' },
  { type: 'receipt_80', label: 'レシート 80mm', widthMm: 80, kind: 'receipt' },
  { type: 'custom', label: 'その他', widthMm: 0, kind: 'custom' },
  { type: 'unknown', label: '不明', widthMm: 0, kind: 'custom' },
]

export function computeDpiFromPaper(params: {
  widthPx: number
  heightPx: number
  paperWidthMm: number
  paperHeightMm: number
}): { dpiX: number; dpiY: number; estimatedDpi: number } {
  const widthInch = mmToInch(Math.max(params.paperWidthMm, 0.001))
  const heightInch = mmToInch(Math.max(params.paperHeightMm, 0.001))
  const dpiX = params.widthPx / widthInch
  const dpiY = params.heightPx / heightInch
  return {
    dpiX,
    dpiY,
    estimatedDpi: Math.min(dpiX, dpiY),
  }
}

export function estimateReceiptHeightMm(paperWidthMm: number, widthPx: number, heightPx: number) {
  if (widthPx <= 0) {
    return paperWidthMm
  }
  return paperWidthMm * (heightPx / widthPx)
}

/**
 * 画像アスペクトから用紙候補を推定する。
 * 曖昧な場合は unknown（勝手に安全数値を作らない）。
 */
export function suggestPaperSizeFromAspect(
  widthPx: number,
  heightPx: number,
): ReceiptPaperSizeSelection | { paperSizeType: 'unknown'; needsUserConfirm: true } {
  if (widthPx <= 0 || heightPx <= 0) {
    return { paperSizeType: 'unknown', needsUserConfirm: true }
  }

  const long = Math.max(widthPx, heightPx)
  const short = Math.min(widthPx, heightPx)
  const aspect = long / short

  // 細長い → レシート候補
  if (aspect >= 2.2) {
    // 幅方向の短辺ピクセルが相対的に細い場合は 58/80 の確認を促す
    return {
      paperSizeType: 'receipt_80',
      paperWidthMm: 80,
      paperHeightMm: estimateReceiptHeightMm(80, short, long),
      source: 'auto',
    }
  }

  const sheetCandidates: Array<{ type: ReceiptPaperSizeType; widthMm: number; heightMm: number; ratio: number }> =
    [
      { type: 'a4', widthMm: 210, heightMm: 297, ratio: 297 / 210 },
      { type: 'a5', widthMm: 148, heightMm: 210, ratio: 210 / 148 },
      { type: 'b5', widthMm: 182, heightMm: 257, ratio: 257 / 182 },
    ]

  let best: (typeof sheetCandidates)[number] | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const candidate of sheetCandidates) {
    const diff = Math.abs(aspect - candidate.ratio)
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }

  if (best && bestDiff <= 0.12) {
    // 画像の短辺を用紙短辺に対応
    const portrait = heightPx >= widthPx
    return {
      paperSizeType: best.type,
      paperWidthMm: portrait ? best.widthMm : best.heightMm,
      paperHeightMm: portrait ? best.heightMm : best.widthMm,
      source: 'auto',
    }
  }

  return { paperSizeType: 'unknown', needsUserConfirm: true }
}

export function resolvePaperSelection(input: {
  paperSizeType: ReceiptPaperSizeType
  paperWidthMm?: number
  paperHeightMm?: number
  widthPx: number
  heightPx: number
  source?: 'auto' | 'user'
}): ReceiptPaperSizeSelection {
  if (input.paperSizeType === 'receipt_58' || input.paperSizeType === 'receipt_80') {
    const widthMm = input.paperSizeType === 'receipt_58' ? 58 : 80
    const shortPx = Math.min(input.widthPx, input.heightPx)
    const longPx = Math.max(input.widthPx, input.heightPx)
    return {
      paperSizeType: input.paperSizeType,
      paperWidthMm: widthMm,
      paperHeightMm: estimateReceiptHeightMm(widthMm, shortPx, longPx),
      source: input.source ?? 'user',
    }
  }

  const preset = PAPER_PRESETS.find((item) => item.type === input.paperSizeType)
  if (preset && preset.heightMm) {
    const portrait = input.heightPx >= input.widthPx
    return {
      paperSizeType: input.paperSizeType,
      paperWidthMm: portrait ? preset.widthMm : preset.heightMm,
      paperHeightMm: portrait ? preset.heightMm : preset.widthMm,
      source: input.source ?? 'user',
    }
  }

  const widthMm = Number(input.paperWidthMm)
  const heightMm = Number(input.paperHeightMm)
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    throw new Error('用紙サイズを確認してください')
  }

  return {
    paperSizeType: input.paperSizeType === 'custom' ? 'custom' : 'custom',
    paperWidthMm: widthMm,
    paperHeightMm: heightMm,
    source: input.source ?? 'user',
  }
}

/**
 * 法定画質チェック。アップスケール後の画素数は渡さないこと。
 */
export function evaluateLegalReceiptQuality(params: {
  widthPx: number
  heightPx: number
  paper: ReceiptPaperSizeSelection
  /** サンプリングした平均彩度等。省略時はカラー扱い */
  isColor?: boolean
}): ReceiptLegalQualityResult {
  const reasons: string[] = []
  if (params.paper.paperSizeType === 'unknown') {
    reasons.push('用紙サイズを確認してください')
  }

  const { dpiX, dpiY, estimatedDpi } = computeDpiFromPaper({
    widthPx: params.widthPx,
    heightPx: params.heightPx,
    paperWidthMm: params.paper.paperWidthMm,
    paperHeightMm: params.paper.paperHeightMm,
  })

  if (estimatedDpi < LEGAL_MIN_DPI) {
    reasons.push('スキャナ保存用の解像度が不足しています。もう少し領収書に近づいて撮影してください。')
  }

  const isColor = params.isColor ?? true
  if (!isColor) {
    reasons.push('カラー画像である必要があります')
  }

  return {
    ok: reasons.length === 0,
    estimatedDpi,
    dpiX,
    dpiY,
    widthPx: params.widthPx,
    heightPx: params.heightPx,
    isColor,
    paper: params.paper,
    reasons,
  }
}

/**
 * 縮小後 dpi = originalDpi * scale >= minDpi を満たす最小の scale（<=1）。
 * これより小さい scale は法定dpiを割る。アップスケールはしない。
 * 既に不足している場合は 1（これ以上縮小不可）。
 */
export function maxDownscaleFactorForDpi(params: {
  widthPx: number
  heightPx: number
  paperWidthMm: number
  paperHeightMm: number
  minDpi?: number
}): number {
  const minDpi = params.minDpi ?? LEGAL_MIN_DPI
  const { estimatedDpi } = computeDpiFromPaper(params)
  if (estimatedDpi <= minDpi) {
    return 1
  }
  // 例: 400dpi → 0.5 まで縮小可
  return Math.min(1, minDpi / estimatedDpi)
}
