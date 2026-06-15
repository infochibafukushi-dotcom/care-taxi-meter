import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { TimerKey } from '../types/case'
import { formatElapsedTime } from '../utils/time'

export type TimerSeconds = Record<TimerKey, number>

const initialTimerSeconds: TimerSeconds = {
  driving: 0,
  waiting: 0,
  accompanying: 0,
}

export function useOperationTimers(
  activeTimer: TimerKey | null,
  initialSeconds: TimerSeconds = initialTimerSeconds,
  resetKey = 0,
) {
  const [timerSeconds, dispatchTimerSeconds] = useReducer(
    (currentSeconds: TimerSeconds, action: { seconds?: number; timer?: TimerKey; type: 'reset' | 'tick' }) => {
      if (action.type === 'reset') {
        return initialSeconds
      }

      if (!action.timer || !action.seconds) {
        return currentSeconds
      }

      return {
        ...currentSeconds,
        [action.timer]: currentSeconds[action.timer] + action.seconds,
      }
    },
    initialSeconds,
  )
  const lastTickAtRef = useRef<number | null>(null)
  const isInitialResetRenderRef = useRef(true)

  useEffect(() => {
    if (isInitialResetRenderRef.current) {
      isInitialResetRenderRef.current = false
      return undefined
    }

    const resetTimerId = window.setTimeout(() => {
      dispatchTimerSeconds({ type: 'reset' })
      lastTickAtRef.current = null
    }, 0)

    return () => window.clearTimeout(resetTimerId)
  }, [resetKey])

  useEffect(() => {
    if (!activeTimer) {
      lastTickAtRef.current = null
      return undefined
    }

    lastTickAtRef.current = Date.now()
    const updateElapsedSeconds = () => {
      const currentTickAt = Date.now()
      const lastTickAt = lastTickAtRef.current ?? currentTickAt
      const elapsedSeconds = Math.floor((currentTickAt - lastTickAt) / 1000)

      if (elapsedSeconds <= 0) {
        return
      }

      lastTickAtRef.current = lastTickAt + elapsedSeconds * 1000
      dispatchTimerSeconds({ seconds: elapsedSeconds, timer: activeTimer, type: 'tick' })
    }

    const timerId = window.setInterval(updateElapsedSeconds, 250)
    window.addEventListener('focus', updateElapsedSeconds)
    document.addEventListener('visibilitychange', updateElapsedSeconds)

    return () => {
      updateElapsedSeconds()
      window.clearInterval(timerId)
      window.removeEventListener('focus', updateElapsedSeconds)
      document.removeEventListener('visibilitychange', updateElapsedSeconds)
    }
  }, [activeTimer])

  const formattedTimers = useMemo(
    () => ({
      driving: formatElapsedTime(timerSeconds.driving),
      waiting: formatElapsedTime(timerSeconds.waiting),
      accompanying: formatElapsedTime(timerSeconds.accompanying),
      seconds: timerSeconds,
    }),
    [timerSeconds],
  )

  return formattedTimers
}
