import { describe, expect, it } from 'vitest'
import { estimatePerspectiveOutputSize, solveHomography } from './receiptPerspective'
import { createFullImageCorners } from './receiptCorners'

describe('receiptPerspective', () => {
  it('estimates non-zero output size for full-image corners', () => {
    const corners = createFullImageCorners(800, 1200)
    const size = estimatePerspectiveOutputSize(corners)
    expect(size.width).toBeGreaterThan(10)
    expect(size.height).toBeGreaterThan(10)
  })

  it('solves identity-like homography for aligned quads', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    const dst = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    const h = solveHomography(src, dst)
    expect(h).not.toBeNull()
    expect(h![0]).toBeCloseTo(1, 5)
    expect(h![4]).toBeCloseTo(1, 5)
  })
})
