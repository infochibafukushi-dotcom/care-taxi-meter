import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    if (!activeTimer) {
      return undefined
    }

    const timerId = window.setInterval(() => {
      setTimerSeconds((currentSeconds) => ({
        ...currentSeconds,
        [activeTimer]: currentSeconds[activeTimer] + 1,
      }))
    }, 1000)

    return () => window.clearInterval(timerId)
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
