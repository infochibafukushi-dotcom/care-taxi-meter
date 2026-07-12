import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clockInWorkSession,
  clockOutWorkSession,
  fetchOpenWorkingWorkSession,
  fetchWorkSessionById,
  subscribeOpenWorkingWorkSession,
} from '../services/workSessions'
import { loadAuthStaffSession } from '../services/authSession'
import type { StaffMember, Store, WorkSession } from '../types/work'
import { captureWorkLocation } from '../utils/workLocation'
import { logDiagnostic } from '../utils/diagnostics'

export const workSessionStorageKey = 'careTaxiMeterCurrentWorkSession'

export type WorkSessionPhase = 'loading' | 'active' | 'inactive'

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
/** 初回ハイドレーション完了前は loading。module に session があれば active 起点。 */
let sharedSessionPhase: WorkSessionPhase = sharedCurrentSession ? 'active' : 'loading'
let sharedHydrationPromise: Promise<WorkSession | null> | null = null

const workSessionListeners = new Set<(workSession: WorkSession | null) => void>()
const workSessionPhaseListeners = new Set<(phase: WorkSessionPhase) => void>()

/** テスト専用: モジュール共有状態を初期化する */
export const __resetWorkSessionSharedStateForTests = () => {
  sharedCurrentSession = null
  sharedSessionPhase = 'loading'
  sharedHydrationPromise = null
  workSessionListeners.clear()
  workSessionPhaseListeners.clear()
}

const updateSharedSessionPhase = (phase: WorkSessionPhase) => {
  sharedSessionPhase = phase
  workSessionPhaseListeners.forEach((listener) => listener(phase))
}

const updateSharedCurrentSession = (workSession: WorkSession | null) => {
  sharedCurrentSession = workSession
  workSessionListeners.forEach((listener) => listener(workSession))
}

const serializeWorkSession = (workSession: WorkSession | null) =>
  workSession ? JSON.stringify(workSession) : ''

const persistCurrentSession = (workSession: WorkSession | null) => {
  const previousSession = sharedCurrentSession
  const previousSerializedSession = serializeWorkSession(previousSession)
  const nextSerializedSession = serializeWorkSession(workSession)
  const isSameSerializedSession = previousSerializedSession === nextSerializedSession

  logDiagnostic('persistCurrentSession before', {
    previousSessionId: previousSession?.id ?? null,
    previousStatus: previousSession?.status ?? null,
    nextSessionId: workSession?.id ?? null,
    nextStatus: workSession?.status ?? null,
    isSameSerializedSession,
  })

  if (isSameSerializedSession && (previousSession || workSession)) {
    if (workSession) {
      updateSharedSessionPhase('active')
    }
    return
  }

  if (workSession) {
    localStorage.setItem(workSessionStorageKey, nextSerializedSession)
    logWorkSessionDebug('persist current session', { workSessionId: workSession.id, status: workSession.status })
    updateSharedCurrentSession(workSession)
    updateSharedSessionPhase('active')
  } else {
    localStorage.removeItem(workSessionStorageKey)
    logWorkSessionDebug('clear current session')
    updateSharedCurrentSession(null)
    // ハイドレーション中の一時 null は inactive にしない（完了時に明示する）
    if (sharedSessionPhase !== 'loading') {
      updateSharedSessionPhase('inactive')
    }
  }

  logDiagnostic('persistCurrentSession after', {
    currentSessionId: sharedCurrentSession?.id ?? null,
    currentStatus: sharedCurrentSession?.status ?? null,
    sessionPhase: sharedSessionPhase,
  })
}

const getStaffTenantCompanyId = (staffMember: StaffMember) =>
  staffMember.franchiseeId || staffMember.companyId

const isOpenWorkingSession = (workSession: WorkSession | null): workSession is WorkSession =>
  Boolean(workSession && workSession.status === 'working' && !workSession.clockOutAt)

const tenantIdsEqual = (left?: string | null, right?: string | null) => {
  const a = (left ?? '').trim()
  const b = (right ?? '').trim()
  return Boolean(a) && Boolean(b) && a === b
}

/** companyId / franchiseeId の別名差で誤クリアしない */
const matchesCurrentSessionIdentity = ({
  currentSession,
  fetchedSession,
}: {
  currentSession: WorkSession
  fetchedSession: WorkSession
}) => {
  const currentTenant = currentSession.franchiseeId || currentSession.companyId
  const fetchedTenant = fetchedSession.franchiseeId || fetchedSession.companyId

  return (
    fetchedSession.id === currentSession.id &&
    fetchedSession.staffId === currentSession.staffId &&
    tenantIdsEqual(currentTenant, fetchedTenant) &&
    (!currentSession.storeId ||
      !fetchedSession.storeId ||
      fetchedSession.storeId === currentSession.storeId)
  )
}

type WorkSessionStatusMessage = {
  tone: 'error' | 'idle' | 'saved' | 'saving'
  text: string
}

/**
 * クエリ空結果で即クリアしない。
 * ローカル出勤セッションが Firestore 上まだ working なら維持する。
 */
const confirmLocalSessionStillOpen = async (
  localSession: WorkSession | null,
): Promise<WorkSession | null> => {
  if (!isOpenWorkingSession(localSession)) {
    return null
  }

  try {
    const fetchedSession = await fetchWorkSessionById(localSession.id)
    if (
      isOpenWorkingSession(fetchedSession) &&
      matchesCurrentSessionIdentity({ currentSession: localSession, fetchedSession })
    ) {
      return fetchedSession
    }
    return null
  } catch (error) {
    console.warn('[workSession] confirmLocalSessionStillOpen error; keeping local', error)
    return localSession
  }
}

/**
 * CasePage / Home 共通: 保存済み or ログイン職員の open 勤務だけ復元。
 * 新規出勤は作らない。
 */
export const hydrateWorkingSession = async (): Promise<WorkSession | null> => {
  if (sharedHydrationPromise) {
    return sharedHydrationPromise
  }

  sharedHydrationPromise = (async () => {
    updateSharedSessionPhase('loading')

    const fromStorage = loadStoredWorkSession()
    if (fromStorage) {
      const confirmed = await confirmLocalSessionStillOpen(fromStorage)
      if (confirmed) {
        persistCurrentSession(confirmed)
        updateSharedSessionPhase('active')
        return confirmed
      }
    }

    if (sharedCurrentSession && isOpenWorkingSession(sharedCurrentSession)) {
      const confirmed = await confirmLocalSessionStillOpen(sharedCurrentSession)
      if (confirmed) {
        persistCurrentSession(confirmed)
        updateSharedSessionPhase('active')
        return confirmed
      }
    }

    const authSession = loadAuthStaffSession()
    if (authSession?.id && (authSession.franchiseeId || authSession.companyId)) {
      try {
        const restoredSession = await fetchOpenWorkingWorkSession({
          companyId: authSession.franchiseeId || authSession.companyId,
          staffId: authSession.id,
          storeId: authSession.storeId || undefined,
        })

        if (restoredSession) {
          persistCurrentSession(restoredSession)
          updateSharedSessionPhase('active')
          return restoredSession
        }

        // storeId 付きで取れない場合、store なしで再試行（クエリ差の吸収）
        if (authSession.storeId) {
          const withoutStore = await fetchOpenWorkingWorkSession({
            companyId: authSession.franchiseeId || authSession.companyId,
            staffId: authSession.id,
          })
          if (withoutStore) {
            persistCurrentSession(withoutStore)
            updateSharedSessionPhase('active')
            return withoutStore
          }
        }
      } catch (error) {
        console.warn('[workSession] hydrate from auth failed', error)
        // ネットワーク失敗時はローカルがあれば維持
        const localFallback = loadStoredWorkSession() ?? sharedCurrentSession
        if (isOpenWorkingSession(localFallback)) {
          persistCurrentSession(localFallback)
          updateSharedSessionPhase('active')
          return localFallback
        }
      }
    }

    persistCurrentSession(null)
    updateSharedSessionPhase('inactive')
    return null
  })()

  try {
    return await sharedHydrationPromise
  } finally {
    sharedHydrationPromise = null
  }
}

export function useWorkSession() {
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(sharedCurrentSession)
  const [sessionPhase, setSessionPhase] = useState<WorkSessionPhase>(sharedSessionPhase)
  const [message, setMessage] = useState<WorkSessionStatusMessage>({
    tone: 'idle',
    text: '会社ID・ユーザーID・パスワードでログイン後、出勤ボタンから勤務を開始してください。',
  })
  const hydratedRef = useRef(false)
  const setMessageIfChanged = useCallback((nextMessage: WorkSessionStatusMessage) => {
    setMessage((currentMessage) =>
      currentMessage.tone === nextMessage.tone && currentMessage.text === nextMessage.text
        ? currentMessage
        : nextMessage,
    )
  }, [])

  useEffect(() => {
    workSessionListeners.add(setCurrentSession)
    workSessionPhaseListeners.add(setSessionPhase)

    return () => {
      workSessionListeners.delete(setCurrentSession)
      workSessionPhaseListeners.delete(setSessionPhase)
    }
  }, [])

  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true

    void hydrateWorkingSession().then((session) => {
      if (session) {
        setMessageIfChanged({ tone: 'saved', text: '勤務中状態を復元しました。' })
      } else if (sharedSessionPhase === 'inactive') {
        setMessageIfChanged({
          tone: 'idle',
          text: '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。',
        })
      }
    })
  }, [setMessageIfChanged])

  const isWorking = Boolean(currentSession)
  const isSessionLoading = sessionPhase === 'loading'

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
          updateSharedSessionPhase('inactive')
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

        // 通信失敗ではローカル出勤を消さない（未出勤誤判定防止）
        console.warn('[workSession] validate current session error; keeping local', error)
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
    updateSharedSessionPhase('active')
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
    updateSharedSessionPhase('loading')

    try {
      const restoredSession = await fetchOpenWorkingWorkSession({
        companyId: getStaffTenantCompanyId(staffMember),
        staffId: staffMember.id,
        storeId: staffMember.storeId,
      })

      if (!restoredSession) {
        const localConfirmed = await confirmLocalSessionStillOpen(
          loadStoredWorkSession() ?? sharedCurrentSession,
        )
        if (localConfirmed) {
          persistCurrentSession(localConfirmed)
          updateSharedSessionPhase('active')
          setMessage({ tone: 'saved', text: '勤務中状態を復元しました。' })
          return localConfirmed
        }

        persistCurrentSession(null)
        updateSharedSessionPhase('inactive')
        setMessage({ tone: 'idle', text: '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。' })
        return null
      }

      persistCurrentSession(restoredSession)
      updateSharedSessionPhase('active')
      setMessage({
        tone: 'saved',
        text: '勤務中状態を復元しました。',
      })
      return restoredSession
    } catch (error) {
      const localFallback = loadStoredWorkSession() ?? sharedCurrentSession
      if (isOpenWorkingSession(localFallback)) {
        persistCurrentSession(localFallback)
        updateSharedSessionPhase('active')
        setMessage({
          tone: 'error',
          text: error instanceof Error
            ? `勤務状態の同期に失敗しましたが、ローカル出勤を維持しています。${error.message}`
            : '勤務状態の同期に失敗しましたが、ローカル出勤を維持しています。',
        })
        return localFallback
      }
      updateSharedSessionPhase('inactive')
      throw error
    }
  }

  const clockOut = async () => {
    if (!currentSession) {
      return null
    }

    const sessionToClose = currentSession
    persistCurrentSession(null)
    updateSharedSessionPhase('inactive')
    setMessage({ tone: 'saving', text: '退勤処理中...' })

    const location = await captureWorkLocation()
    try {
      const closedSession = await clockOutWorkSession({
        location,
        workSession: sessionToClose,
      })

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
        companyId: sessionToClose.companyId,
        staffId: sessionToClose.staffId,
        storeId: sessionToClose.storeId,
      })

      if (!activeSession) {
        persistCurrentSession(null)
        updateSharedSessionPhase('inactive')
        setMessage({ tone: 'idle', text: 'Firestore 上で退勤済みのため、未出勤状態に戻しました。' })
        return null
      }

      persistCurrentSession(activeSession)
      updateSharedSessionPhase('active')
      setMessage({
        tone: 'error',
        text: error instanceof Error ? `退勤できませんでした。${error.message}` : '退勤できませんでした。',
      })
      throw error
    }
  }

  const logout = () => {
    persistCurrentSession(null)
    updateSharedSessionPhase('inactive')
    setMessage({ tone: 'idle', text: '退勤しました。再度出勤してください。' })
  }

  const subscribeToWorkingSession = useCallback((staffMember: StaffMember) => {
    const subscriptionId = `${staffMember.id}-${staffMember.storeId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    logDiagnostic('subscribeToWorkingSession started', {
      subscriptionId,
      companyId: getStaffTenantCompanyId(staffMember),
      staffId: staffMember.id,
      storeId: staffMember.storeId,
    })
    setMessageIfChanged({ tone: 'saving', text: '勤務中状態を同期しています。' })

    const unsubscribe = subscribeOpenWorkingWorkSession({
      companyId: getStaffTenantCompanyId(staffMember),
      staffId: staffMember.id,
      storeId: staffMember.storeId,
      onChange: (workSession) => {
        void (async () => {
          if (workSession) {
            persistCurrentSession(workSession)
            updateSharedSessionPhase('active')
            setMessageIfChanged({
              tone: 'saved',
              text: '勤務中状態を同期しました。',
            })
            return
          }

          // 空スナップショット ≠ 未出勤確定。ID照会で確認してからクリアする。
          const confirmed = await confirmLocalSessionStillOpen(
            loadStoredWorkSession() ?? sharedCurrentSession,
          )
          if (confirmed) {
            logWorkSessionDebug('subscription null but local session still open; keeping', {
              workSessionId: confirmed.id,
            })
            persistCurrentSession(confirmed)
            updateSharedSessionPhase('active')
            setMessageIfChanged({
              tone: 'saved',
              text: '勤務中状態を同期しました。',
            })
            return
          }

          persistCurrentSession(null)
          updateSharedSessionPhase('inactive')
          setMessageIfChanged({
            tone: 'idle',
            text: '未出勤です。Dashboard TOPの出勤ボタンから勤務を開始してください。',
          })
        })()
      },
      onError: (error) => {
        console.warn('[workSession] subscription error', error)
        setMessageIfChanged({ tone: 'error', text: `勤務中状態を同期できませんでした。${error.message}` })
      },
    })

    return () => {
      logDiagnostic('subscribeToWorkingSession cleanup', {
        subscriptionId,
        staffId: staffMember.id,
        storeId: staffMember.storeId,
      })
      unsubscribe()
    }
  }, [setMessageIfChanged])

  return {
    clockIn,
    clockOut,
    currentSession,
    hydrateWorkingSession,
    isSessionLoading,
    isWorking,
    logout,
    message,
    restoreWorkingSession,
    sessionPhase,
    subscribeToWorkingSession,
  }
}
