import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimerKey } from '../types/case'
import { formatElapsedTime } from '../utils/time'

type TimerSeconds = Record<TimerKey, number>

const initialTimerSeconds: TimerSeconds = {
  driving: 0,
  waiting: 0,
  accompanying: 0,
}

export function useOperationTimers(activeTimer: TimerKey | null) {
  const [timerSeconds, setTimerSeconds] =
    useState<TimerSeconds>(initialTimerSeconds)
  const lastTickAtRef = useRef<number | null>(null)

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
      setTimerSeconds((currentSeconds) => ({
        ...currentSeconds,
        [activeTimer]: currentSeconds[activeTimer] + elapsedSeconds,
      }))
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
