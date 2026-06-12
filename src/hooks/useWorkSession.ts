import { useEffect, useState } from 'react'
import {
  clockInWorkSession,
  clockOutWorkSession,
  fetchOpenWorkingWorkSession,
} from '../services/workSessions'
import type { StaffMember, Store, WorkSession } from '../types/work'
import { captureWorkLocation } from '../utils/workLocation'

const workSessionStorageKey = 'careTaxiMeterCurrentWorkSession'

const loadStoredWorkSession = (): WorkSession | null => {
  try {
    const sessionJson = localStorage.getItem(workSessionStorageKey)

    if (!sessionJson) {
      return null
    }

    const session = JSON.parse(sessionJson) as Partial<WorkSession>

    if (!session.id || session.status !== 'working') {
      return null
    }

    return {
      clockInAccuracy: session.clockInAccuracy ?? null,
      clockInAt: session.clockInAt ?? '',
      clockInLatitude: session.clockInLatitude ?? null,
      clockInLongitude: session.clockInLongitude ?? null,
      clockOutAccuracy: session.clockOutAccuracy ?? null,
      clockOutAt: session.clockOutAt ?? null,
      clockOutLatitude: session.clockOutLatitude ?? null,
      clockOutLongitude: session.clockOutLongitude ?? null,
      companyId: session.companyId ?? '',
      companyName: session.companyName ?? '',
      franchiseeId: session.franchiseeId || session.companyId || '',
      id: session.id,
      staffId: session.staffId ?? '',
      staffName: session.staffName ?? '',
      staffRole: session.staffRole ?? 'driver',
      status: 'working',
      storeId: session.storeId ?? '',
      storeName: session.storeName ?? '',
      workSeconds: session.workSeconds ?? 0,
    }
  } catch {
    return null
  }
}

let sharedCurrentSession: WorkSession | null = loadStoredWorkSession()
const workSessionListeners = new Set<(workSession: WorkSession | null) => void>()

const updateSharedCurrentSession = (workSession: WorkSession | null) => {
  sharedCurrentSession = workSession
  workSessionListeners.forEach((listener) => listener(workSession))
}

type WorkSessionStatusMessage = {
  tone: 'error' | 'idle' | 'saved' | 'saving'
  text: string
}

export function useWorkSession() {
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(sharedCurrentSession)
  const [message, setMessage] = useState<WorkSessionStatusMessage>({
    tone: 'idle',
    text: '会社ID・ユーザーID・パスワードでログイン後、出勤ボタンから勤務を開始してください。',
  })

  useEffect(() => {
    workSessionListeners.add(setCurrentSession)

    return () => {
      workSessionListeners.delete(setCurrentSession)
    }
  }, [])

  const isWorking = Boolean(currentSession)

  const clockIn = async ({
    companyName = '',
    staffMember,
    store,
  }: {
    companyName?: string
    staffMember: StaffMember
    store: Store
  }) => {
    setMessage({ tone: 'saving', text: '出勤位置を取得して保存中です。' })
    const location = await captureWorkLocation()
    const workSession = await clockInWorkSession({
      companyName,
      location,
      staffMember,
      store,
    })

    localStorage.setItem(workSessionStorageKey, JSON.stringify(workSession))
    updateSharedCurrentSession(workSession)
    setMessage({
      tone: 'saved',
      text: location.latitude === null
        ? '出勤しました。位置情報は取得できませんでした。'
        : '出勤しました。出勤位置を保存しました。',
    })
    return workSession
  }

  const restoreWorkingSession = async (staffMember: StaffMember) => {
    setMessage({ tone: 'saving', text: '勤務中状態を確認しています。' })

    try {
      const restoredSession = await fetchOpenWorkingWorkSession({
        companyId: staffMember.companyId,
        staffId: staffMember.id,
      })

      if (!restoredSession) {
        localStorage.removeItem(workSessionStorageKey)
        updateSharedCurrentSession(null)
        setMessage({ tone: 'idle', text: '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。' })
        return null
      }

      localStorage.setItem(workSessionStorageKey, JSON.stringify(restoredSession))
      updateSharedCurrentSession(restoredSession)
      setMessage({
        tone: 'saved',
        text: '勤務中状態を復元しました。',
      })
      return restoredSession
    } catch (error) {
      localStorage.removeItem(workSessionStorageKey)
      updateSharedCurrentSession(null)
      throw error
    }
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
    updateSharedCurrentSession(null)
    setMessage({
      tone: 'saved',
      text: location.latitude === null
        ? '退勤しました。位置情報は取得できませんでした。'
        : '退勤しました。退勤位置を保存しました。',
    })
    return closedSession
  }

  const logout = () => {
    localStorage.removeItem(workSessionStorageKey)
    updateSharedCurrentSession(null)
    setMessage({ tone: 'idle', text: '退勤しました。再度出勤してください。' })
  }

  return {
    clockIn,
    clockOut,
    currentSession,
    isWorking,
    logout,
    message,
    restoreWorkingSession,
  }
}
