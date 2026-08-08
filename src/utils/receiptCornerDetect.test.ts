import { describe, expect, it } from 'vitest'
import { createFullImageCorners, validateReceiptCorners } from './receiptCorners'

describe('receiptCornerDetect fallback contract', () => {
  it('full-image fallback corners are always valid', () => {
    const corners = createFullImageCorners(1200, 1600)
    expect(validateReceiptCorners(corners, 1200, 1600).ok).toBe(true)
  })

  it('does not reject tall receipt aspect as invalid quad', () => {
    const corners = createFullImageCorners(600, 2400)
    expect(validateReceiptCorners(corners, 600, 2400).ok).toBe(true)
  })
})
