import { useEffect, useRef, useState } from 'react'

const BLACKOUT_IDLE_MS = 30_000

type UseMeterBlackoutOptions = {
  elapsedSeconds: number
  isEnabled: boolean
  statusLabel: string
}

export function useMeterBlackout({
  elapsedSeconds,
  isEnabled,
  statusLabel,
}: UseMeterBlackoutOptions) {
  const [isBlackoutActive, setIsBlackoutActive] = useState(false)
  const lastInteractionAtRef = useRef(Date.now())
  const blackoutTimerRef = useRef<number | null>(null)

  const clearBlackoutTimer = () => {
    if (blackoutTimerRef.current !== null) {
      window.clearTimeout(blackoutTimerRef.current)
      blackoutTimerRef.current = null
    }
  }

  const registerInteraction = () => {
    lastInteractionAtRef.current = Date.now()
    setIsBlackoutActive(false)
  }

  const dismissBlackout = () => {
    registerInteraction()
  }

  useEffect(() => {
    if (!isEnabled) {
      clearBlackoutTimer()
      setIsBlackoutActive(false)
      return undefined
    }

    lastInteractionAtRef.current = Date.now()
    setIsBlackoutActive(false)

    const scheduleBlackoutCheck = () => {
      clearBlackoutTimer()
      const idleMs = Date.now() - lastInteractionAtRef.current
      const remainingMs = Math.max(BLACKOUT_IDLE_MS - idleMs, 0)

      blackoutTimerRef.current = window.setTimeout(() => {
        blackoutTimerRef.current = null
        if (Date.now() - lastInteractionAtRef.current >= BLACKOUT_IDLE_MS) {
          setIsBlackoutActive(true)
        } else {
          scheduleBlackoutCheck()
        }
      }, remainingMs)
    }

    scheduleBlackoutCheck()

    const handleInteraction = () => {
      registerInteraction()
      scheduleBlackoutCheck()
    }

    window.addEventListener('pointerdown', handleInteraction)
    window.addEventListener('keydown', handleInteraction)
    window.addEventListener('touchstart', handleInteraction)

    return () => {
      clearBlackoutTimer()
      window.removeEventListener('pointerdown', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
      window.removeEventListener('touchstart', handleInteraction)
    }
  }, [isEnabled, statusLabel])

  return {
    dismissBlackout,
    elapsedSeconds,
    isBlackoutActive,
    statusLabel,
  }
}
