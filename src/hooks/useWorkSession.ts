import { useState } from 'react'
import { clockInWorkSession, clockOutWorkSession } from '../services/workSessions'
import type { StaffMember, Store, Vehicle, WorkSession } from '../types/work'
import { captureWorkLocation } from '../utils/workLocation'

const workSessionStorageKey = 'careTaxiMeterCurrentWorkSession'

type WorkSessionStatusMessage = {
  tone: 'error' | 'idle' | 'saved' | 'saving'
  text: string
}

const loadStoredWorkSession = () => {
  try {
    const storedValue = localStorage.getItem(workSessionStorageKey)
    if (!storedValue) {
      return null
    }

    const parsedValue = JSON.parse(storedValue) as WorkSession
    return parsedValue.status === 'working' ? parsedValue : null
  } catch {
    return null
  }
}

export function useWorkSession() {
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(
    loadStoredWorkSession,
  )
  const [message, setMessage] = useState<WorkSessionStatusMessage>({
    tone: 'idle',
    text: '出勤すると案件へ店舗・スタッフ・車両が自動紐付けされます。',
  })

  const isWorking = Boolean(currentSession)

  const clockIn = async ({
    staffMember,
    store,
    vehicle,
  }: {
    staffMember: StaffMember
    store: Store
    vehicle: Vehicle
  }) => {
    setMessage({ tone: 'saving', text: '出勤位置を取得して保存中です。' })
    const location = await captureWorkLocation()
    const workSession = await clockInWorkSession({
      location,
      staffMember,
      store,
      vehicle,
    })

    localStorage.setItem(workSessionStorageKey, JSON.stringify(workSession))
    setCurrentSession(workSession)
    setMessage({
      tone: 'saved',
      text: location.latitude === null
        ? '出勤しました。位置情報は取得できませんでした。'
        : '出勤しました。出勤位置を保存しました。',
    })
    return workSession
  }

  const clockOut = async () => {
    if (!currentSession) {
      return null
    }

    setMessage({ tone: 'saving', text: '退勤位置を取得して保存中です。' })
    const location = await captureWorkLocation()
    const closedSession = await clockOutWorkSession({
      location,
      workSession: currentSession,
    })

    localStorage.removeItem(workSessionStorageKey)
    setCurrentSession(null)
    setMessage({
      tone: 'saved',
      text: location.latitude === null
        ? '退勤しました。位置情報は取得できませんでした。'
        : '退勤しました。退勤位置を保存しました。',
    })
    return closedSession
  }

  return {
    clockIn,
    clockOut,
    currentSession,
    isWorking,
    message,
  }
}
