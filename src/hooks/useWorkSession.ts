import { useState } from 'react'
import {
  clockInWorkSession,
  clockOutWorkSession,
  fetchOpenWorkingWorkSession,
} from '../services/workSessions'
import type { StaffMember, Store, WorkSession } from '../types/work'
import { captureWorkLocation } from '../utils/workLocation'

const workSessionStorageKey = 'careTaxiMeterCurrentWorkSession'

type WorkSessionStatusMessage = {
  tone: 'error' | 'idle' | 'saved' | 'saving'
  text: string
}

export function useWorkSession() {
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(null)
  const [message, setMessage] = useState<WorkSessionStatusMessage>({
    tone: 'idle',
    text: '会社ID・ユーザーID・パスワードを入力して出勤してください。',
  })

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
    setCurrentSession(workSession)
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
        setCurrentSession(null)
        setMessage({ tone: 'idle', text: '未出勤です。ログイン後に勤務を開始します。' })
        return null
      }

      localStorage.setItem(workSessionStorageKey, JSON.stringify(restoredSession))
      setCurrentSession(restoredSession)
      setMessage({
        tone: 'saved',
        text: '勤務中状態を復元しました。',
      })
      return restoredSession
    } catch (error) {
      localStorage.removeItem(workSessionStorageKey)
      setCurrentSession(null)
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
    setCurrentSession(null)
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
    setCurrentSession(null)
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
