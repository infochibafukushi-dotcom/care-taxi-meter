import { describe, expect, it } from 'vitest'
import {
  computeDpiFromPaper,
  evaluateLegalReceiptQuality,
  estimateReceiptHeightMm,
  LEGAL_MIN_DPI,
  maxDownscaleFactorForDpi,
  resolvePaperSelection,
  suggestPaperSizeFromAspect,
} from './receiptLegalDpi'

describe('receiptLegalDpi', () => {
  it('A4 200dpi boundary passes, 199dpi fails', () => {
    // A4 210x297mm at 200dpi => widthPx = 210/25.4*200 ≈ 1653.54
    const width200 = Math.round((210 / 25.4) * 200)
    const height200 = Math.round((297 / 25.4) * 200)
    const ok = evaluateLegalReceiptQuality({
      widthPx: width200,
      heightPx: height200,
      paper: {
        paperSizeType: 'a4',
        paperWidthMm: 210,
        paperHeightMm: 297,
        source: 'user',
      },
    })
    expect(ok.estimatedDpi).toBeGreaterThanOrEqual(LEGAL_MIN_DPI)
    expect(ok.ok).toBe(true)

    const width199 = Math.round((210 / 25.4) * 199)
    const height199 = Math.round((297 / 25.4) * 199)
    const ng = evaluateLegalReceiptQuality({
      widthPx: width199,
      heightPx: height199,
      paper: {
        paperSizeType: 'a4',
        paperWidthMm: 210,
        paperHeightMm: 297,
        source: 'user',
      },
    })
    expect(ng.estimatedDpi).toBeLessThan(LEGAL_MIN_DPI)
    expect(ng.ok).toBe(false)
  })

  it('computes dpi for 58mm and 80mm receipts from aspect height', () => {
    const widthPx = 640
    const heightPx = 2400
    const r58 = resolvePaperSelection({
      paperSizeType: 'receipt_58',
      widthPx,
      heightPx,
    })
    expect(r58.paperWidthMm).toBe(58)
    expect(r58.paperHeightMm).toBeCloseTo(estimateReceiptHeightMm(58, Math.min(widthPx, heightPx), Math.max(widthPx, heightPx)))

    const dpi58 = computeDpiFromPaper({
      widthPx: Math.min(widthPx, heightPx),
      heightPx: Math.max(widthPx, heightPx),
      paperWidthMm: r58.paperWidthMm,
      paperHeightMm: r58.paperHeightMm,
    })
    expect(dpi58.estimatedDpi).toBeGreaterThan(100)

    const r80 = resolvePaperSelection({
      paperSizeType: 'receipt_80',
      widthPx,
      heightPx,
    })
    expect(r80.paperWidthMm).toBe(80)
  })

  it('custom paper uses provided mm', () => {
    const paper = resolvePaperSelection({
      paperSizeType: 'custom',
      paperWidthMm: 100,
      paperHeightMm: 150,
      widthPx: 800,
      heightPx: 1200,
    })
    expect(paper.paperWidthMm).toBe(100)
    expect(paper.paperHeightMm).toBe(150)
  })

  it('does not treat upscale as a way to pass dpi (min scale never below 200dpi floor)', () => {
    const factor = maxDownscaleFactorForDpi({
      widthPx: 1000,
      heightPx: 1400,
      paperWidthMm: 210,
      paperHeightMm: 297,
    })
    // 1000px / (210/25.4) ≈ 121 dpi < 200 → これ以上縮小不可
    expect(factor).toBe(1)

    const high = maxDownscaleFactorForDpi({
      widthPx: 3300,
      heightPx: 4680,
      paperWidthMm: 210,
      paperHeightMm: 297,
    })
    expect(high).toBeLessThan(1)
    expect(high).toBeGreaterThan(0.4)
    const after = computeDpiFromPaper({
      widthPx: Math.round(3300 * high),
      heightPx: Math.round(4680 * high),
      paperWidthMm: 210,
      paperHeightMm: 297,
    })
    expect(after.estimatedDpi).toBeGreaterThanOrEqual(LEGAL_MIN_DPI - 1)
  })

  it('asks user when aspect is ambiguous', () => {
    const suggestion = suggestPaperSizeFromAspect(1000, 1100)
    expect('needsUserConfirm' in suggestion || suggestion.paperSizeType === 'unknown').toBe(true)
  })
})
