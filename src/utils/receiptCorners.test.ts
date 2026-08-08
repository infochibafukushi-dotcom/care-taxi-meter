import { describe, expect, it } from 'vitest'
import {
  cornersFromDisplay,
  cornersToDisplay,
  createFullImageCorners,
  displayPointToImagePoint,
  imagePointToDisplayPoint,
  moveReceiptCornerSafely,
  validateReceiptCorners,
  type DisplayRect,
} from './receiptCorners'

const rect: DisplayRect = {
  offsetX: 10,
  offsetY: 20,
  displayWidth: 200,
  displayHeight: 100,
  imageWidth: 400,
  imageHeight: 200,
}

describe('receiptCorners coordinate transforms', () => {
  it('maps display ↔ image and survives resize-equivalent rect changes', () => {
    const imagePoint = { x: 200, y: 100 }
    const display = imagePointToDisplayPoint(imagePoint, rect)
    expect(display.x).toBeCloseTo(110)
    expect(display.y).toBeCloseTo(70)
    const back = displayPointToImagePoint(display, rect)
    expect(back.x).toBeCloseTo(200)
    expect(back.y).toBeCloseTo(100)

    const resized: DisplayRect = { ...rect, displayWidth: 100, displayHeight: 50, offsetX: 0, offsetY: 0 }
    const display2 = imagePointToDisplayPoint(imagePoint, resized)
    const back2 = displayPointToImagePoint(display2, resized)
    expect(back2.x).toBeCloseTo(200)
    expect(back2.y).toBeCloseTo(100)
  })

  it('keeps tall receipt and wide image corners transformable', () => {
    const tall = createFullImageCorners(100, 800)
    const wide = createFullImageCorners(800, 100)
    const tallDisplay = cornersToDisplay(tall, {
      ...rect,
      imageWidth: 100,
      imageHeight: 800,
      displayWidth: 50,
      displayHeight: 400,
      offsetX: 0,
      offsetY: 0,
    })
    const tallBack = cornersFromDisplay(tallDisplay, {
      ...rect,
      imageWidth: 100,
      imageHeight: 800,
      displayWidth: 50,
      displayHeight: 400,
      offsetX: 0,
      offsetY: 0,
    })
    expect(tallBack.topLeft.y).toBeCloseTo(tall.topLeft.y, 0)
    expect(validateReceiptCorners(wide, 800, 100).ok).toBe(true)
  })
})

describe('receiptCorners validation', () => {
  it('accepts a normal quad', () => {
    const corners = createFullImageCorners(1000, 1400)
    expect(validateReceiptCorners(corners, 1000, 1400).ok).toBe(true)
  })

  it('rejects crossed edges', () => {
    // bowtie
    const corners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 0, y: 100 },
      bottomLeft: { x: 100, y: 100 },
    }
    const result = validateReceiptCorners(corners, 100, 100)
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-image coordinates', () => {
    const corners = {
      topLeft: { x: -50, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    }
    expect(validateReceiptCorners(corners, 100, 100).ok).toBe(false)
  })

  it('rejects tiny area', () => {
    const corners = {
      topLeft: { x: 50, y: 50 },
      topRight: { x: 55, y: 50 },
      bottomRight: { x: 55, y: 55 },
      bottomLeft: { x: 50, y: 55 },
    }
    expect(validateReceiptCorners(corners, 1000, 1000).ok).toBe(false)
  })

  it('moveReceiptCornerSafely never yields an invalid quad', () => {
    const corners = {
      topLeft: { x: 20, y: 20 },
      topRight: { x: 180, y: 20 },
      bottomRight: { x: 180, y: 180 },
      bottomLeft: { x: 20, y: 180 },
    }
    const bowtieTarget = { x: 40, y: 160 }
    const next = moveReceiptCornerSafely(corners, 'topRight', bowtieTarget, 200, 200)
    expect(validateReceiptCorners(next, 200, 200).ok).toBe(true)

    // 対角を入れ替えるような移動は拒否される
    const rejected = moveReceiptCornerSafely(
      corners,
      'topRight',
      { x: 30, y: 170 },
      200,
      200,
    )
    // 受理されても妥当、拒否なら元のまま
    expect(validateReceiptCorners(rejected, 200, 200).ok).toBe(true)
  })
})
