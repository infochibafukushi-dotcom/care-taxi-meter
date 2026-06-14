import { useCallback, useEffect, useState } from 'react'
import {
  clockInWorkSession,
  clockOutWorkSession,
  fetchOpenWorkingWorkSession,
  fetchWorkSessionById,
  subscribeOpenWorkingWorkSession,
} from '../services/workSessions'
import type { StaffMember, Store, WorkSession } from '../types/work'
import { captureWorkLocation } from '../utils/workLocation'

const workSessionStorageKey = 'careTaxiMeterCurrentWorkSession'

const logWorkSessionDebug = (message: string, details?: Record<string, unknown>) => {
  console.info(`[workSession] ${message}`, details ?? {})
}

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

const persistCurrentSession = (workSession: WorkSession | null) => {
  if (workSession) {
    localStorage.setItem(workSessionStorageKey, JSON.stringify(workSession))
    logWorkSessionDebug('persist current session', { workSessionId: workSession.id, status: workSession.status })
  } else {
    localStorage.removeItem(workSessionStorageKey)
    logWorkSessionDebug('persistCurrentSession(null)')
    logWorkSessionDebug('clear current session')
  }

  updateSharedCurrentSession(workSession)
}

const getStaffTenantCompanyId = (staffMember: StaffMember) =>
  staffMember.franchiseeId || staffMember.companyId

const isOpenWorkingSession = (workSession: WorkSession | null): workSession is WorkSession =>
  Boolean(workSession && workSession.status === 'working' && !workSession.clockOutAt)

const matchesCurrentSessionIdentity = ({
  currentSession,
  fetchedSession,
}: {
  currentSession: WorkSession
  fetchedSession: WorkSession
}) =>
  fetchedSession.id === currentSession.id &&
  fetchedSession.companyId === currentSession.companyId &&
  fetchedSession.staffId === currentSession.staffId &&
  fetchedSession.storeId === currentSession.storeId

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

  useEffect(() => {
    if (!currentSession) {
      return undefined
    }

    let isActive = true

    const validateCurrentSession = async () => {
      logWorkSessionDebug('validate current session started', {
        workSessionId: currentSession.id,
        status: currentSession.status,
        clockOutAt: currentSession.clockOutAt,
      })

      try {
        const fetchedSession = await fetchWorkSessionById(currentSession.id)

        if (!isActive) {
          return
        }

        if (
          !isOpenWorkingSession(fetchedSession) ||
          !matchesCurrentSessionIdentity({ currentSession, fetchedSession })
        ) {
          logWorkSessionDebug('validate current session stale; clearing local session', {
            currentSessionId: currentSession.id,
            fetchedSessionId: fetchedSession?.id ?? null,
            fetchedStatus: fetchedSession?.status ?? null,
            fetchedClockOutAt: fetchedSession?.clockOutAt ?? null,
          })
          persistCurrentSession(null)
          setMessage({ tone: 'idle', text: '退勤済みの勤務状態を検出したため、未出勤状態に戻しました。' })
          return
        }

        if (JSON.stringify(fetchedSession) !== JSON.stringify(currentSession)) {
          persistCurrentSession(fetchedSession)
        }
      } catch (error) {
        if (!isActive) {
          return
        }

        console.warn('[workSession] validate current session error', error)
        setMessage({
          tone: 'error',
          text: error instanceof Error
            ? `勤務状態を確認できませんでした。${error.message}`
            : '勤務状態を確認できませんでした。',
        })
      }
    }

    void validateCurrentSession()

    return () => {
      isActive = false
    }
  }, [currentSession])

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

    persistCurrentSession(workSession)
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
        companyId: getStaffTenantCompanyId(staffMember),
        staffId: staffMember.id,
        storeId: staffMember.storeId,
      })

      if (!restoredSession) {
        persistCurrentSession(null)
        setMessage({ tone: 'idle', text: '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。' })
        return null
      }

      persistCurrentSession(restoredSession)
      setMessage({
        tone: 'saved',
        text: '勤務中状態を復元しました。',
      })
      return restoredSession
    } catch (error) {
      persistCurrentSession(null)
      throw error
    }
  }

  const clockOut = async () => {
    if (!currentSession) {
      return null
    }

    setMessage({ tone: 'saving', text: '退勤位置を取得して保存中です。' })
    const location = await captureWorkLocation()
    try {
      const closedSession = await clockOutWorkSession({
        location,
        workSession: currentSession,
      })

      persistCurrentSession(null)
      setMessage({
        tone: 'saved',
        text: location.latitude === null
          ? '退勤しました。位置情報は取得できませんでした。'
          : '退勤しました。退勤位置を保存しました。',
      })
      return closedSession
    } catch (error) {
      console.warn('[workSession] clockOut error', error)

      const activeSession = await fetchOpenWorkingWorkSession({
        companyId: currentSession.companyId,
        staffId: currentSession.staffId,
        storeId: currentSession.storeId,
      })

      if (!activeSession) {
        persistCurrentSession(null)
        setMessage({ tone: 'idle', text: 'Firestore 上で退勤済みのため、未出勤状態に戻しました。' })
        return null
      }

      persistCurrentSession(activeSession)
      setMessage({
        tone: 'error',
        text: error instanceof Error ? `退勤できませんでした。${error.message}` : '退勤できませんでした。',
      })
      throw error
    }
  }

  const logout = () => {
    persistCurrentSession(null)
    setMessage({ tone: 'idle', text: '退勤しました。再度出勤してください。' })
  }

  const subscribeToWorkingSession = useCallback((staffMember: StaffMember) => {
    logWorkSessionDebug('subscribeToWorkingSession started', {
      companyId: getStaffTenantCompanyId(staffMember),
      staffId: staffMember.id,
      storeId: staffMember.storeId,
    })
    setMessage({ tone: 'saving', text: '勤務中状態を同期しています。' })

    return subscribeOpenWorkingWorkSession({
      companyId: getStaffTenantCompanyId(staffMember),
      staffId: staffMember.id,
      storeId: staffMember.storeId,
      onChange: (workSession) => {
        logWorkSessionDebug(`subscription received session isNull: ${workSession === null}`, {
          isNull: workSession === null,
          workSessionId: workSession?.id ?? null,
          status: workSession?.status ?? null,
        })
        persistCurrentSession(workSession)
        setMessage({
          tone: workSession ? 'saved' : 'idle',
          text: workSession
            ? '勤務中状態を同期しました。'
            : '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。',
        })
      },
      onError: (error) => {
        console.warn('[workSession] subscription error', error)
        setMessage({ tone: 'error', text: `勤務中状態を同期できませんでした。${error.message}` })
      },
    })
  }, [])

  return {
    clockIn,
    clockOut,
    currentSession,
    isWorking,
    logout,
    message,
    restoreWorkingSession,
    subscribeToWorkingSession,
  }
}
