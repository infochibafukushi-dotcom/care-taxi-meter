import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * PreFixedRouteMapPanel の animation cancel パターンを単体検証する。
 * rAF 増殖防止と cleanup 必須要件に対応。
 */
const createArrowAnimationController = () => {
  const cancelers: Array<() => void> = []
  let rafId: number | null = null

  const start = (tick: (now: number) => void) => {
    const loop = (now: number) => {
      tick(now)
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    cancelers.push(() => {
      if (rafId != null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    })
  }

  const stop = () => {
    cancelers.forEach((cancel) => cancel())
    cancelers.length = 0
  }

  return { start, stop, getCancelerCount: () => cancelers.length }
}

describe('route arrow animation cleanup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels previous rAF when stop is called before restart', () => {
    const cancelSpy = vi.fn()
    const requestSpy = vi.fn(() => 42)
    vi.stubGlobal('requestAnimationFrame', requestSpy)
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)

    const controller = createArrowAnimationController()
    controller.start(() => undefined)
    expect(controller.getCancelerCount()).toBe(1)
    controller.stop()
    expect(cancelSpy).toHaveBeenCalledWith(42)
    expect(controller.getCancelerCount()).toBe(0)

    controller.start(() => undefined)
    expect(controller.getCancelerCount()).toBe(1)
    controller.stop()
    expect(cancelSpy).toHaveBeenCalledTimes(2)
  })
})
