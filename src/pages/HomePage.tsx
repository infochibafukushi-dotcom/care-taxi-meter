import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { authenticateStaff } from '../services/staffMembers'
import { defaultCompany, fetchCompanies } from '../services/companies'
import { fetchStores } from '../services/stores'
import { fetchCaseRecords } from '../services/caseRecords'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import type { ActiveTripSnapshot } from '../services/activeTripSnapshot'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import type { StaffMember, Store, WorkSession } from '../types/work'
import { canAccessAdminSection, roleHomePaths } from '../types/permissions'
import { saveAuthStaffSession, clearAuthStaffSession, loadAuthStaffSession } from '../services/authSession'
import type { AuthStaffSession } from '../services/authSession'
import { tenantAccessScopeFromSessionSource } from '../services/tenancy'
import { formatBreakMinutes, formatBoundTimeDetail, formatDurationHoursMinutesJapanese } from '../utils/time'
import { getMonthRangeInJapan, getTodayRangeInJapan, formatCaseDateTime, getActualFareYen } from '../utils/caseRecords'
import {
  calculateBoundSeconds,
  calculateEffectiveWorkSeconds,
  calculateTodayOperatingSeconds,
  resolveRestBreak,
} from '../utils/workSessionMetrics'
import { logDiagnostic, logNavigationClick } from '../utils/diagnostics'

const defaultCompanyName = defaultCompany.name

type LoginForm = {
  companyId: string
  userId: string
  password: string
}

type LoggedInUser = {
  companyName: string
  staffMember: StaffMember
  store: Store
}

type RestorableStaffSession = AuthStaffSession | WorkSession

const isWorkSessionRestoreSource = (source: RestorableStaffSession): source is WorkSession =>
  'staffId' in source

const createLoggedInUserFromRestoredSession = ({
  authSession,
  currentSession,
}: {
  authSession: AuthStaffSession | null
  currentSession: WorkSession | null
}): LoggedInUser | null => {
  const source = currentSession ?? authSession

  if (!source) {
    return null
  }

  const companyId = source.franchiseeId || source.companyId
  const staffId = isWorkSessionRestoreSource(source) ? source.staffId : source.id
  const staffName = isWorkSessionRestoreSource(source) ? source.staffName : source.name
  const staffRole = isWorkSessionRestoreSource(source) ? source.staffRole : source.role
  const storeName = source.storeName || currentSession?.storeName || '未設定'
  const companyName = currentSession?.companyName || authSession?.companyName || defaultCompanyName

  const staffMember: StaffMember = {
    id: staffId,
    companyId,
    franchiseeId: source.franchiseeId || source.companyId,
    storeId: source.storeId,
    storeName,
    userId: '',
    password: '',
    name: staffName || '未ログイン',
    role: staffRole,
    canDrive: staffRole === 'owner' || staffRole === 'driver',
    isActive: true,
    phoneNumber: '',
    email: '',
    address: '',
    licenseNumber: '',
    licenseExpiresAt: '',
    accidentHistory: '',
    memo: '',
    enabled: true,
    sortOrder: 0,
  }

  const store: Store = {
    id: source.storeId,
    companyId,
    franchiseeId: source.franchiseeId || source.companyId,
    name: storeName,
    storeName,
    companyName,
    status: 'active',
    enabled: true,
    isActive: true,
    sortOrder: 0,
  }

  return {
    companyName,
    staffMember,
    store,
  }
}

type CaseRecordState = {
  errorMessage: string
  records: StoredCaseRecord[]
}

const calculateAverageYen = (salesYen: number, count: number) =>
  count > 0 ? Math.round(salesYen / count) : 0

const calculateSummary = ({
  currentSessionId,
  records,
  staffId,
}: {
  currentSessionId: string
  records: StoredCaseRecord[]
  staffId: string
}) => {
  const todayRange = getTodayRangeInJapan()
  const monthRange = getMonthRangeInJapan()
  const belongsToCurrentStaff = (caseRecord: StoredCaseRecord) => {
    if (!staffId) {
      return true
    }

    return currentSessionId
      ? caseRecord.workSessionId === currentSessionId ||
          (!caseRecord.workSessionId && caseRecord.staffId === staffId)
      : caseRecord.staffId === staffId
  }
  const todayRecords = records.filter(
    (caseRecord) =>
      belongsToCurrentStaff(caseRecord) &&
      caseRecord.closedAt >= todayRange.startIso &&
      caseRecord.closedAt < todayRange.endIso,
  )
  const monthRecords = records.filter(
    (caseRecord) =>
      belongsToCurrentStaff(caseRecord) &&
      caseRecord.closedAt >= monthRange.startIso &&
      caseRecord.closedAt < monthRange.endIso,
  )
  const todaySalesYen = todayRecords.reduce(
    (total, caseRecord) => total + getActualFareYen(caseRecord),
    0,
  )

  return {
    averageYen: calculateAverageYen(todaySalesYen, todayRecords.length),
    monthCount: monthRecords.length,
    monthSalesYen: monthRecords.reduce(
      (total, caseRecord) => total + getActualFareYen(caseRecord),
      0,
    ),
    todayAccompanyingSeconds: todayRecords.reduce(
      (total, caseRecord) => total + caseRecord.accompanyingSeconds,
      0,
    ),
    todayCount: todayRecords.length,
    todayDistanceKm: todayRecords.reduce(
      (total, caseRecord) => total + caseRecord.distanceKm,
      0,
    ),
    todayDrivingSeconds: todayRecords.reduce(
      (total, caseRecord) => total + caseRecord.drivingSeconds,
      0,
    ),
    todaySalesYen,
    todayWaitingSeconds: todayRecords.reduce(
      (total, caseRecord) => total + caseRecord.waitingSeconds,
      0,
    ),
  }
}

type TodaySalesSummary = Pick<
  ReturnType<typeof calculateSummary>,
  'monthCount' | 'monthSalesYen' | 'todayCount' | 'todaySalesYen'
>

function TodaySalesModalCards({
  boundSeconds,
  restSeconds,
  summary,
}: {
  boundSeconds: number
  restSeconds: number
  summary: TodaySalesSummary
}) {
  const effectiveWorkSeconds = calculateEffectiveWorkSeconds(boundSeconds, restSeconds)

  return (
    <div className="today-sales-cards">
      <article className="today-sales-card">
        <p className="today-sales-card__label">本日の売上</p>
        <p className="today-sales-card__value">{formatFareYen(summary.todaySalesYen)}円</p>
      </article>
      <article className="today-sales-card">
        <p className="today-sales-card__label">本日の件数</p>
        <p className="today-sales-card__value">{summary.todayCount}件</p>
      </article>
      <article className="today-sales-card today-sales-card--bound">
        <p className="today-sales-card__label">拘束時間</p>
        <p className="today-sales-card__value">{formatDurationHoursMinutesJapanese(boundSeconds)}</p>
        <p className="today-sales-card__details">
          {formatBoundTimeDetail(restSeconds, effectiveWorkSeconds)}
        </p>
      </article>
      <article className="today-sales-card">
        <p className="today-sales-card__label">今月売上</p>
        <p className="today-sales-card__value">{formatFareYen(summary.monthSalesYen)}円</p>
      </article>
      <article className="today-sales-card">
        <p className="today-sales-card__label">今月件数</p>
        <p className="today-sales-card__value">{summary.monthCount}件</p>
      </article>
    </div>
  )
}

export function HomePage() {
  const workSession = useWorkSession()
  const navigate = useNavigate()
  const [loginForm, setLoginForm] = useState<LoginForm>({
    companyId: '',
    userId: '',
    password: '',
  })
  const [loggedInUser, setLoggedInUser] = useState<LoggedInUser | null>(null)
  const [loginMessage, setLoginMessage] = useState('会社ID・ログインID・パスワードでログインしてください。')
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false)

  useEffect(() => {
    logDiagnostic('HomePage mount')
    return () => logDiagnostic('HomePage unmount')
  }, [])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [dashboardRecordsState, setDashboardRecordsState] = useState<CaseRecordState>({
    errorMessage: '',
    records: [],
  })
  const [isClockOutConfirmOpen, setIsClockOutConfirmOpen] = useState(false)
  const [isClockOutProcessing, setIsClockOutProcessing] = useState(false)
  const [isTodaySalesOpen, setIsTodaySalesOpen] = useState(false)
  const [isTodaySalesLoading, setIsTodaySalesLoading] = useState(false)
  const [todayWorkSeconds, setTodayWorkSeconds] = useState(0)
  const [activeTripSnapshot, setActiveTripSnapshot] =
    useState<ActiveTripSnapshot | null>(readActiveTripSnapshot)

  const { subscribeToWorkingSession } = workSession
  const currentSession = workSession.currentSession
  const currentStaffId = currentSession?.staffId ?? loggedInUser?.staffMember.id ?? ''
  const currentSessionId = currentSession?.id ?? ''
  const dashboardCompanyName = currentSession?.companyName || loggedInUser?.companyName || defaultCompanyName
  const dashboardStoreName = currentSession?.storeName || loggedInUser?.store.name || '未設定'
  const dashboardStaffName = currentSession?.staffName || loggedInUser?.staffMember.name || '未ログイン'
  const dashboardRole = currentSession?.staffRole ?? loggedInUser?.staffMember.role ?? ''
  const dashboardAccessScope = useMemo(
    () => tenantAccessScopeFromSessionSource(currentSession ?? loggedInUser?.staffMember ?? null),
    [currentSession, loggedInUser?.staffMember],
  )
  const isHqAdmin = dashboardRole === 'hq_admin'
  const canOpenManagement = !isHqAdmin && canAccessAdminSection(dashboardRole, 'staff')
  const canOpenAnalytics = canAccessAdminSection(dashboardRole, 'analytics')
  const hasActiveTripSnapshot = Boolean(activeTripSnapshot)
  const currentSessionCompanyId = currentSession?.companyId ?? ''
  const currentSessionFranchiseeId = currentSession?.franchiseeId ?? ''
  const currentSessionStaffId = currentSession?.staffId ?? ''
  const currentSessionStaffName = currentSession?.staffName ?? ''
  const currentSessionStaffRole = currentSession?.staffRole ?? 'driver'
  const currentSessionStoreId = currentSession?.storeId ?? ''
  const currentSessionStoreName = currentSession?.storeName ?? ''
  const subscriptionStaffMember = useMemo<StaffMember | null>(() => {
    if (loggedInUser) {
      return loggedInUser.staffMember
    }

    if (!currentSessionStaffId) {
      return null
    }

    return {
      id: currentSessionStaffId,
      companyId: currentSessionCompanyId,
      franchiseeId: currentSessionFranchiseeId || currentSessionCompanyId,
      storeId: currentSessionStoreId,
      storeName: currentSessionStoreName,
      userId: '',
      password: '',
      name: currentSessionStaffName || '未ログイン',
      role: currentSessionStaffRole,
      canDrive: currentSessionStaffRole === 'owner' || currentSessionStaffRole === 'driver',
      isActive: true,
      phoneNumber: '',
      email: '',
      address: '',
      licenseNumber: '',
      licenseExpiresAt: '',
      accidentHistory: '',
      memo: '',
      enabled: true,
      sortOrder: 0,
    }
  }, [
    currentSessionCompanyId,
    currentSessionFranchiseeId,
    currentSessionStaffId,
    currentSessionStaffName,
    currentSessionStaffRole,
    currentSessionStoreId,
    currentSessionStoreName,
    loggedInUser,
  ])

  useEffect(() => {
    console.info('[HomePage] session state', {
      hasLoggedInUser: Boolean(loggedInUser),
      loggedInStaffId: loggedInUser?.staffMember.id ?? null,
      currentSessionId: currentSession?.id ?? null,
      currentSessionStaffId: currentSession?.staffId ?? null,
    })
  }, [currentSession?.id, currentSession?.staffId, loggedInUser])

  useEffect(() => {
    if (loggedInUser) {
      return
    }

    const authSession = loadAuthStaffSession()
    const restoredLoggedInUser = createLoggedInUserFromRestoredSession({
      authSession,
      currentSession,
    })

    if (!restoredLoggedInUser) {
      return
    }

    console.info('[HomePage] restored loggedInUser for work session subscription', {
      fromAuthSession: Boolean(authSession),
      fromCurrentSession: Boolean(currentSession),
      staffId: restoredLoggedInUser.staffMember.id,
      storeId: restoredLoggedInUser.staffMember.storeId,
    })

    let isActive = true
    void Promise.resolve().then(() => {
      if (!isActive) {
        return
      }
      setLoggedInUser(restoredLoggedInUser)
      setLoginMessage('ログイン状態を復元しました。勤務状態を同期しています。')
    })

    return () => {
      isActive = false
    }
  }, [currentSession, loggedInUser])

  useEffect(() => {
    const effectRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    logDiagnostic('HomePage work session subscription effect run', {
      effectRunId,
      hasSubscriptionStaffMember: Boolean(subscriptionStaffMember),
      subscriptionStaffId: subscriptionStaffMember?.id ?? null,
      subscriptionStoreId: subscriptionStaffMember?.storeId ?? null,
      subscriptionRole: subscriptionStaffMember?.role ?? null,
      hasLoggedInUser: Boolean(loggedInUser),
      restoredFromSessionIdentity: !loggedInUser && Boolean(subscriptionStaffMember),
    })

    if (!subscriptionStaffMember || subscriptionStaffMember.role === 'hq_admin') {
      logDiagnostic('HomePage work session subscription skipped', {
        effectRunId,
        reason: !subscriptionStaffMember ? 'no subscription staff member' : 'hq_admin',
      })
      return undefined
    }

    console.info('[HomePage] subscribeToWorkingSession started', {
      hasLoggedInUser: Boolean(loggedInUser),
      restoredFromCurrentSession: !loggedInUser && Boolean(subscriptionStaffMember),
      staffId: subscriptionStaffMember.id,
      storeId: subscriptionStaffMember.storeId,
    })
    const unsubscribe = subscribeToWorkingSession(subscriptionStaffMember)

    return () => {
      logDiagnostic('HomePage work session subscription effect cleanup', {
        effectRunId,
        staffId: subscriptionStaffMember.id,
        storeId: subscriptionStaffMember.storeId,
      })
      unsubscribe()
    }
  }, [loggedInUser, subscribeToWorkingSession, subscriptionStaffMember])

  useEffect(() => {
    if (currentSession) {
      return undefined
    }

    let isActive = true
    void Promise.resolve().then(() => {
      if (isActive) {
        setElapsedSeconds(0)
      }
    })

    return () => {
      isActive = false
    }
  }, [currentSession])

  useEffect(() => {
    if (!currentSession) {
      return undefined
    }

    const updateElapsedSeconds = () => {
      setElapsedSeconds(
        Math.max(
          Math.floor((Date.now() - new Date(currentSession.clockInAt).getTime()) / 1000),
          0,
        ),
      )
    }

    updateElapsedSeconds()
    const timerId = window.setInterval(updateElapsedSeconds, 1000)
    return () => window.clearInterval(timerId)
  }, [currentSession])

  useEffect(() => {
    const refreshActiveTripSnapshot = () => {
      setActiveTripSnapshot(readActiveTripSnapshot())
    }

    window.addEventListener('focus', refreshActiveTripSnapshot)
    window.addEventListener('storage', refreshActiveTripSnapshot)

    return () => {
      window.removeEventListener('focus', refreshActiveTripSnapshot)
      window.removeEventListener('storage', refreshActiveTripSnapshot)
    }
  }, [])

  useEffect(() => {
    if (!currentStaffId) {
      return undefined
    }

    let isMounted = true

    fetchCaseRecords(dashboardAccessScope)
      .then((records) => {
        if (!isMounted) {
          return
        }

        setDashboardRecordsState({ errorMessage: '', records })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setDashboardRecordsState({
          errorMessage: error instanceof Error ? error.message : '本日実績を取得できませんでした。',
          records: [],
        })
      })

    return () => {
      isMounted = false
    }
  }, [currentStaffId, currentSessionId, dashboardAccessScope])

  const dashboardSummary = useMemo(
    () =>
      calculateSummary({
        currentSessionId,
        records: dashboardRecordsState.records,
        staffId: currentStaffId,
      }),
    [currentSessionId, currentStaffId, dashboardRecordsState.records],
  )

  const workTimeMetrics = useMemo(() => {
    const boundSeconds = currentSession
      ? calculateBoundSeconds({
          clockInAt: currentSession.clockInAt,
          clockOutAt: null,
        })
      : todayWorkSeconds
    const { restSeconds } = resolveRestBreak({
      boundSeconds,
      workSession: currentSession,
    })
    const todayRange = getTodayRangeInJapan()
    const operatingSeconds = calculateTodayOperatingSeconds({
      records: dashboardRecordsState.records,
      staffId: currentStaffId,
      currentSessionId,
      todayStartIso: todayRange.startIso,
      todayEndIso: todayRange.endIso,
      activeTripStartedAt: activeTripSnapshot?.operationStartedAt,
    })

    return {
      boundSeconds,
      operatingSeconds,
      restSeconds,
    }
  }, [
    activeTripSnapshot?.operationStartedAt,
    currentSession,
    currentSessionId,
    currentStaffId,
    dashboardRecordsState.records,
    todayWorkSeconds,
  ])

  const handleRestoreActiveTrip = () => {
    navigate('/case')
  }

  const activeTripRestoreNotice = activeTripSnapshot ? (
    <section className="hero-card active-trip-restore-card" aria-labelledby="active-trip-restore-title">
      <p className="eyebrow">Trip Restore</p>
      <h2 id="active-trip-restore-title">未終了の運行があります。</h2>
      <p className="lead">案件番号 {activeTripSnapshot.caseNumber} / 状態 {activeTripSnapshot.status} の運行データを復元できます。</p>
      <button className="primary-action home-button" type="button" onClick={handleRestoreActiveTrip}>
        運行を復元
      </button>
    </section>
  ) : null

  const handleLoginChange = (key: keyof LoginForm, value: string) => {
    setLoginForm((currentForm) => ({ ...currentForm, [key]: value }))
  }

  const handleLogin = async () => {
    if (isLoginSubmitting) {
      return
    }

    setIsLoginSubmitting(true)
    setLoginMessage('認証中です。')
    try {
      const staffMember = await authenticateStaff(loginForm)
      if (!staffMember) {
        setLoginMessage('会社ID・ログインID・パスワードが一致するスタッフが見つかりません。')
        return
      }

      const companies = await fetchCompanies()
      const company = companies.find((item) => item.id === staffMember.companyId) ?? null
      const stores = await fetchStores(staffMember.companyId)
      const store = stores.find((item) => item.id === staffMember.storeId) ?? stores[0]
      if (!store) {
        setLoginMessage('所属店舗が見つかりません。管理画面で店舗を登録してください。')
        return
      }

      const nextLoggedInUser = {
        companyName: company?.name ?? defaultCompanyName,
        staffMember,
        store,
      }
      setLoggedInUser(nextLoggedInUser)
      saveAuthStaffSession(staffMember, nextLoggedInUser.companyName)

      if (staffMember.role === 'hq_admin') {
        setLoginMessage('FC本部管理者としてログインしました。現場業務の出勤処理は行いません。')
        navigate(roleHomePaths[staffMember.role])
        return
      }

      setLoginMessage('ログインしました。Dashboard TOPの出勤ボタンから勤務を開始してください。')
      navigate('/')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `ログインできませんでした。${error.message}` : 'ログインできませんでした。',
      )
    } finally {
      setIsLoginSubmitting(false)
    }
  }

  const handleClockIn = async () => {
    if (hasActiveTripSnapshot) {
      setLoginMessage('未終了の運行があります。出勤操作の前に運行を復元してください。')
      return
    }

    if (!loggedInUser) {
      setLoginMessage('先にログインしてください。')
      return
    }

    setLoginMessage('出勤位置を取得して勤務を開始しています。')
    try {
      await workSession.clockIn({
        companyName: loggedInUser.companyName,
        staffMember: loggedInUser.staffMember,
        store: loggedInUser.store,
      })
      setTodayWorkSeconds(0)
      setLoginMessage('出勤しました。')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `出勤できませんでした。${error.message}` : '出勤できませんでした。',
      )
    }
  }

  const handleLogout = () => {
    setLoggedInUser(null)
    clearAuthStaffSession()
    setLoginForm((currentForm) => ({ ...currentForm, password: '' }))
    setLoginMessage('ログアウトしました。')
  }

  const openClockOutConfirm = () => {
    if (hasActiveTripSnapshot) {
      setLoginMessage('未終了の運行があります。退勤操作の前に運行を復元してください。')
      return
    }

    setIsClockOutConfirmOpen(true)
  }

  const handleConfirmClockOut = async () => {
    if (isClockOutProcessing) {
      return
    }

    if (hasActiveTripSnapshot) {
      setLoginMessage('未終了の運行があります。退勤操作の前に運行を復元してください。')
      setIsClockOutConfirmOpen(false)
      return
    }

    setIsClockOutProcessing(true)
    setTodayWorkSeconds(elapsedSeconds)

    try {
      await workSession.clockOut()
      setIsClockOutConfirmOpen(false)
      setLoginMessage('退勤しました。お疲れ様でした。')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `退勤できませんでした。${error.message}` : '退勤できませんでした。',
      )
    } finally {
      setIsClockOutProcessing(false)
    }
  }

  const openTodaySales = async () => {
    setIsTodaySalesOpen(true)

    if (!currentStaffId) {
      return
    }

    setIsTodaySalesLoading(true)
    try {
      const records = await fetchCaseRecords(dashboardAccessScope)
      setDashboardRecordsState({ errorMessage: '', records })
    } catch (error) {
      setDashboardRecordsState({
        errorMessage: error instanceof Error ? error.message : '本日の実績を取得できませんでした。',
        records: dashboardRecordsState.records,
      })
    } finally {
      setIsTodaySalesLoading(false)
    }
  }

  if (!loggedInUser && !currentSession) {
    return (
      <main className="page page--home page--login" aria-labelledby="home-title">
        {activeTripRestoreNotice}
        <section className="hero-card login-card">
          <div className="login-intro">
            <h1 id="home-title">ケアタクシー業務システム</h1>
            <p className="lead login-subtitle">ログイン</p>
          </div>
          <div className="login-form">
            <label>
              会社ID
              <input placeholder="会社IDを入力" value={loginForm.companyId} onChange={(event) => handleLoginChange('companyId', event.target.value)} />
              <span className="login-field-hint">※FC加盟時に設定した法人名または屋号名を入力してください。例）株式会社千葉福祉サポート / ちばケアタクシー</span>
            </label>
            <label>
              ログインID
              <input value={loginForm.userId} onChange={(event) => handleLoginChange('userId', event.target.value)} />
              <span className="login-field-hint">※従業員氏名を入力してください。例）東京太郎</span>
            </label>
            <label>
              パスワード
              <input type="password" value={loginForm.password} onChange={(event) => handleLoginChange('password', event.target.value)} />
            </label>
            <button className="primary-action login-submit" type="button" disabled={isLoginSubmitting} onClick={handleLogin}>
              {isLoginSubmitting ? '処理中' : 'ログイン'}
            </button>
          </div>
          <p className="save-note">{loginMessage}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="page page--home" aria-labelledby="home-title">
      {activeTripRestoreNotice}
      <section className="hero-card dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1 id="home-title">TOP</h1>
          </div>
          {!isHqAdmin ? (
            currentSession ? (
              <button
                className="secondary-action home-button dashboard-attendance-button"
                type="button"
                disabled={hasActiveTripSnapshot || isClockOutProcessing}
                onClick={openClockOutConfirm}
              >
                {isClockOutProcessing ? '退勤処理中...' : '退勤'}
              </button>
            ) : (
              <button className="primary-action home-button dashboard-attendance-button" type="button" disabled={hasActiveTripSnapshot} onClick={handleClockIn}>出勤</button>
            )
          ) : null}
        </header>
        <div className="dashboard-content">
          <section className="work-dashboard-grid dashboard-status-grid" aria-label="勤務状況">
            <div><span>会社</span><strong>{dashboardCompanyName}</strong></div>
            <div><span>店舗</span><strong>{dashboardStoreName}</strong></div>
            <div><span>担当者</span><strong>{dashboardStaffName}</strong></div>
            {currentSession ? (
              <>
                <div><span>出勤</span><strong>{formatCaseDateTime(currentSession.clockInAt)}</strong></div>
                <div><span>出勤状態</span><strong>● 出勤中</strong></div>
                <div><span>拘束時間</span><strong>{formatDurationHoursMinutesJapanese(workTimeMetrics.boundSeconds)}</strong></div>
                <div><span>法定休憩</span><strong>{formatBreakMinutes(workTimeMetrics.restSeconds)}</strong></div>
                <div><span>運行時間</span><strong>{formatDurationHoursMinutesJapanese(workTimeMetrics.operatingSeconds)}</strong></div>
              </>
            ) : (
              <div><span>出勤状態</span><strong>○ 未出勤</strong></div>
            )}
          </section>
        </div>
        {dashboardRecordsState.errorMessage ? <p className="case-error">{dashboardRecordsState.errorMessage}</p> : null}
        <p className="save-note">{loginMessage}</p>
        <nav className="home-actions dashboard-actions" aria-label="主要メニュー">
          {currentSession && !isHqAdmin ? (
            hasActiveTripSnapshot ? (
              <button className="primary-action home-button" type="button" disabled>案件開始</button>
            ) : (
              <Link
                className="primary-action"
                to="/case/start"
                onClick={() => logNavigationClick({ label: '案件開始', to: '/case/start' })}
              >
                案件開始
              </Link>
            )
          ) : null}
          {!isHqAdmin ? (
            hasActiveTripSnapshot ? (
              <button className="secondary-action home-button" type="button" disabled>案件一覧</button>
            ) : (
              <Link
                className="secondary-action"
                to="/cases"
                onClick={() => logNavigationClick({ label: '案件一覧', to: '/cases' })}
              >
                案件一覧
              </Link>
            )
          ) : null}
          {!isHqAdmin ? (
            <button className="secondary-action home-button" type="button" onClick={openTodaySales}>
              本日の売上
            </button>
          ) : null}
          {canOpenManagement ? (
            <Link
              className="secondary-action"
              to={dashboardRole === 'manager' ? '/manager' : '/owner'}
              onClick={() => logNavigationClick({
                label: '管理センター',
                to: dashboardRole === 'manager' ? '/manager' : '/owner',
              })}
            >
              管理センター
            </Link>
          ) : null}
          {!isHqAdmin && canOpenAnalytics ? (
            <Link
              className="secondary-action"
              to="/admin/analytics"
              onClick={() => logNavigationClick({ label: '売上分析', to: '/admin/analytics' })}
            >
              売上分析
            </Link>
          ) : null}
          {!currentSession ? (
            <button className="secondary-action home-button" type="button" onClick={handleLogout}>ログアウト</button>
          ) : null}
        </nav>
      </section>

      {isClockOutConfirmOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section
            aria-labelledby="clock-out-confirm-title"
            aria-modal="true"
            className="settings-modal r9-settlement-confirm"
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <span>Clock Out</span>
                <h2 id="clock-out-confirm-title">退勤しますか？</h2>
              </div>
              <button type="button" disabled={isClockOutProcessing} onClick={() => setIsClockOutConfirmOpen(false)}>
                閉じる
              </button>
            </header>
            <div className="r9-confirm-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={isClockOutProcessing}
                onClick={() => setIsClockOutConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="work-session-primary-button work-session-primary-button--danger"
                type="button"
                disabled={isClockOutProcessing}
                onClick={handleConfirmClockOut}
              >
                {isClockOutProcessing ? '退勤処理中...' : '退勤する'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isTodaySalesOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-modal clock-out-summary" role="dialog" aria-modal="true" aria-labelledby="today-sales-title">
            <header className="settings-header">
              <div><span>Dashboard</span><h2 id="today-sales-title">本日の売上</h2></div>
              <button type="button" onClick={() => setIsTodaySalesOpen(false)}>閉じる</button>
            </header>
            {isTodaySalesLoading ? <p className="empty-note">実績を取得中です。</p> : null}
            {dashboardRecordsState.errorMessage ? <p className="case-error">{dashboardRecordsState.errorMessage}</p> : null}
            {!isTodaySalesLoading && !dashboardRecordsState.errorMessage ? (
              <TodaySalesModalCards
                boundSeconds={workTimeMetrics.boundSeconds}
                restSeconds={workTimeMetrics.restSeconds}
                summary={dashboardSummary}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  )
}
