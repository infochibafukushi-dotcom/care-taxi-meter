import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECEIPT_ROTATION_OCR_RERUN_MESSAGE,
  getRotatedCanvasSize,
  hasAccountingReceiptOcrResult,
  normalizeReceiptRotationDegrees,
  resolveNextReceiptRotationDegrees,
  rotateReceiptDegreesLeft,
  rotateReceiptDegreesRight,
  shouldFlagOcrRerunAfterRotation,
} from './accountingReceiptRotation'

describe('receipt rotation degrees', () => {
  it('右回転で0度から90度になる', () => {
    expect(rotateReceiptDegreesRight(0)).toBe(90)
  })

  it('右回転4回で0度に戻る', () => {
    let degrees = 0 as ReturnType<typeof rotateReceiptDegreesRight>
    degrees = rotateReceiptDegreesRight(degrees)
    degrees = rotateReceiptDegreesRight(degrees)
    degrees = rotateReceiptDegreesRight(degrees)
    degrees = rotateReceiptDegreesRight(degrees)
    expect(degrees).toBe(0)
  })

  it('左回転で0度から270度になる', () => {
    expect(rotateReceiptDegreesLeft(0)).toBe(270)
  })

  it('左回転と右回転の組み合わせでも角度が正しく管理される', () => {
    expect(rotateReceiptDegreesRight(0)).toBe(90)
    expect(rotateReceiptDegreesRight(90)).toBe(180)
    expect(rotateReceiptDegreesLeft(0)).toBe(270)
    expect(rotateReceiptDegreesRight(270)).toBe(0)
  })

  it('reset で0度に戻る', () => {
    expect(resolveNextReceiptRotationDegrees(180, 'reset')).toBe(0)
    expect(resolveNextReceiptRotationDegrees(270, 'reset')).toBe(0)
  })

  it('normalizeReceiptRotationDegrees は不正値も安全に丸める', () => {
    expect(normalizeReceiptRotationDegrees(450)).toBe(90)
    expect(normalizeReceiptRotationDegrees(-90)).toBe(270)
    expect(normalizeReceiptRotationDegrees(15)).toBe(0)
  })
})

describe('getRotatedCanvasSize', () => {
  it('90度画像でCanvasの縦横が入れ替わる', () => {
    expect(getRotatedCanvasSize(200, 100, 90)).toEqual({ width: 100, height: 200 })
  })

  it('270度画像でもCanvasの縦横が入れ替わる', () => {
    expect(getRotatedCanvasSize(200, 100, 270)).toEqual({ width: 100, height: 200 })
  })

  it('180度画像でCanvasの縦横が維持される', () => {
    expect(getRotatedCanvasSize(200, 100, 180)).toEqual({ width: 200, height: 100 })
  })

  it('0度画像でCanvasの縦横が維持される', () => {
    expect(getRotatedCanvasSize(200, 100, 0)).toEqual({ width: 200, height: 100 })
  })
})

describe('OCR rerun flag after rotation', () => {
  it('OCR後に回転した場合、再実行必要状態になる', () => {
    expect(
      shouldFlagOcrRerunAfterRotation({
        hasOcrResult: true,
        previousDegrees: 0,
        nextDegrees: 90,
      }),
    ).toBe(true)
    expect(RECEIPT_ROTATION_OCR_RERUN_MESSAGE).toContain('OCRを再実行')
  })

  it('OCR前の回転では再実行フラグを立てない', () => {
    expect(
      shouldFlagOcrRerunAfterRotation({
        hasOcrResult: false,
        previousDegrees: 0,
        nextDegrees: 90,
      }),
    ).toBe(false)
  })

  it('同じ角度のままでは再実行フラグを立てない', () => {
    expect(
      shouldFlagOcrRerunAfterRotation({
        hasOcrResult: true,
        previousDegrees: 90,
        nextDegrees: 90,
      }),
    ).toBe(false)
  })

  it('OCR結果の有無を正しく判定する', () => {
    expect(hasAccountingReceiptOcrResult({ ocrRawText: '合計 1000' })).toBe(true)
    expect(hasAccountingReceiptOcrResult({ ocrConfidence: 0.8 })).toBe(true)
    expect(hasAccountingReceiptOcrResult({ ocrCandidates: { amount: 1000 } })).toBe(true)
    expect(hasAccountingReceiptOcrResult({})).toBe(false)
    expect(hasAccountingReceiptOcrResult({ ocrRawText: '   ' })).toBe(false)
  })
})

describe('rotateAccountingReceiptImage', () => {
  let lastCanvas: { width: number; height: number }

  beforeEach(() => {
    lastCanvas = { width: 0, height: 0 }

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 200,
        height: 100,
        close: vi.fn(),
      })),
    )

    vi.stubGlobal(
      'HTMLCanvasElement',
      class {
        width = 0
        height = 0
        getContext() {
          return {
            translate: vi.fn(),
            rotate: vi.fn(),
            drawImage: vi.fn(),
          }
        }
        toBlob(callback: (blob: Blob | null) => void, type?: string) {
          callback(new Blob(['rotated'], { type: type || 'image/jpeg' }))
        }
      },
    )

    const CanvasCtor = globalThis as unknown as {
      HTMLCanvasElement: new () => HTMLCanvasElement
    }

    if (typeof document === 'undefined') {
      vi.stubGlobal('document', {
        createElement: (tag: string) => {
          if (tag === 'canvas') {
            const canvas = new CanvasCtor.HTMLCanvasElement() as unknown as {
              width: number
              height: number
              getContext: () => unknown
              toBlob: (cb: (blob: Blob | null) => void, type?: string) => void
            }
            Object.defineProperty(canvas, 'width', {
              get: () => lastCanvas.width,
              set: (value: number) => {
                lastCanvas.width = value
              },
            })
            Object.defineProperty(canvas, 'height', {
              get: () => lastCanvas.height,
              set: (value: number) => {
                lastCanvas.height = value
              },
            })
            return canvas
          }
          throw new Error(`Unexpected element: ${tag}`)
        },
      })
    } else {
      const original = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'canvas') {
          const canvas = new CanvasCtor.HTMLCanvasElement() as unknown as HTMLCanvasElement & {
            width: number
            height: number
          }
          Object.defineProperty(canvas, 'width', {
            configurable: true,
            get: () => lastCanvas.width,
            set: (value: number) => {
              lastCanvas.width = value
            },
          })
          Object.defineProperty(canvas, 'height', {
            configurable: true,
            get: () => lastCanvas.height,
            set: (value: number) => {
              lastCanvas.height = value
            },
          })
          return canvas
        }
        return original(tagName)
      })
    }
  })

  it('90度回転でCanvas縦横が入れ替わり、File を返す', async () => {
    const { rotateAccountingReceiptImage } = await import('./accountingReceiptRotation')
    const source = new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' })
    const rotated = await rotateAccountingReceiptImage(source, 90)

    expect(lastCanvas).toEqual({ width: 100, height: 200 })
    expect(rotated).toBeInstanceOf(File)
    expect(rotated.type).toBe('image/jpeg')
    expect(rotated.name).toBe('receipt.jpg')
  })

  it('180度回転ではCanvas縦横を維持する', async () => {
    const { rotateAccountingReceiptImage } = await import('./accountingReceiptRotation')
    const source = new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' })
    await rotateAccountingReceiptImage(source, 180)
    expect(lastCanvas).toEqual({ width: 200, height: 100 })
  })

  it('0度では元画像をそのまま返す（再エンコードしない）', async () => {
    const { rotateAccountingReceiptImage } = await import('./accountingReceiptRotation')
    const source = new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' })
    const result = await rotateAccountingReceiptImage(source, 0)
    expect(result).toBe(source)
  })

  it('PNGは可能な限りPNGを維持する', async () => {
    const { rotateAccountingReceiptImage } = await import('./accountingReceiptRotation')
    const source = new File([new Uint8Array([1, 2, 3])], 'receipt.png', { type: 'image/png' })
    const rotated = await rotateAccountingReceiptImage(source, 90)
    expect(rotated.type).toBe('image/png')
    expect(rotated.name).toBe('receipt.png')
  })
})

describe('rotation state helpers for OCR / save / delete', () => {
  it('回転後画像がOCR処理へ渡される想定の Blob を保持できる', () => {
    const receiptId = 'receipt-1'
    const rotated = new File([new Uint8Array([9, 9])], 'rotated.jpg', { type: 'image/jpeg' })
    const blobs: Record<string, Blob> = { [receiptId]: rotated }
    expect(blobs[receiptId]).toBe(rotated)
  })

  it('回転後画像が保存処理へ渡される想定の File を生成できる', async () => {
    const { rotateAccountingReceiptImage } = await import('./accountingReceiptRotation')
    const base = new File([new Uint8Array([1, 2, 3])], 'base.jpg', { type: 'image/jpeg' })
    const forSave = await rotateAccountingReceiptImage(base, 90)
    expect(forSave.type).toBe('image/jpeg')
    expect(forSave.size).toBeGreaterThan(0)
  })

  it('画像削除時に状態がリセットされる', () => {
    const state = {
      rotationDegrees: 90 as const,
      baseFile: new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
      needsOcrRerun: true,
    }

    const cleared = {
      rotationDegrees: 0 as const,
      baseFile: null,
      needsOcrRerun: false,
    }

    expect(cleared.rotationDegrees).toBe(0)
    expect(cleared.baseFile).toBeNull()
    expect(cleared.needsOcrRerun).toBe(false)
    expect(state.rotationDegrees).not.toBe(cleared.rotationDegrees)
  })

  it('リセットで元画像・0度に戻る', () => {
    const base = new File([new Uint8Array([1])], 'base.jpg', { type: 'image/jpeg' })
    const nextDegrees = resolveNextReceiptRotationDegrees(270, 'reset')
    expect(nextDegrees).toBe(0)
    expect(base.name).toBe('base.jpg')
  })
})
