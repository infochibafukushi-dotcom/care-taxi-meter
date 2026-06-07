import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { authenticateStaff } from '../services/staffMembers'
import { defaultCompany, fetchCompanies } from '../services/companies'
import { defaultCompanyId, fetchStores } from '../services/stores'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import type { StaffMember, Store } from '../types/work'
import { formatElapsedTime } from '../utils/time'
import { getMonthRangeInJapan, getTodayRangeInJapan, formatCaseDateTime } from '../utils/caseRecords'

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

type CaseRecordState = {
  errorMessage: string
  records: StoredCaseRecord[]
}

type SummaryDialogState = CaseRecordState & {
  isLoading: boolean
  isOpen: boolean
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
    (total, caseRecord) => total + caseRecord.totalFareYen,
    0,
  )

  return {
    averageYen: calculateAverageYen(todaySalesYen, todayRecords.length),
    monthCount: monthRecords.length,
    monthSalesYen: monthRecords.reduce(
      (total, caseRecord) => total + caseRecord.totalFareYen,
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

export function HomePage() {
  const workSession = useWorkSession()
  const [loginForm, setLoginForm] = useState<LoginForm>({
    companyId: defaultCompanyId,
    userId: '',
    password: '',
  })
  const [loggedInUser, setLoggedInUser] = useState<LoggedInUser | null>(null)
  const [loginMessage, setLoginMessage] = useState('会社ID・スタッフID・パスワードでログインすると出勤します。')
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [dashboardRecordsState, setDashboardRecordsState] = useState<CaseRecordState>({
    errorMessage: '',
    records: [],
  })
  const [summaryDialog, setSummaryDialog] = useState<SummaryDialogState>({
    errorMessage: '',
    isLoading: false,
    isOpen: false,
    records: [],
  })

  const currentSession = workSession.currentSession
  const currentStaffId = currentSession?.staffId ?? loggedInUser?.staffMember.id ?? ''
  const currentSessionId = currentSession?.id ?? ''
  const dashboardCompanyName = currentSession?.companyName || loggedInUser?.companyName || defaultCompanyName
  const dashboardStoreName = currentSession?.storeName || loggedInUser?.store.name || '未設定'
  const dashboardStaffName = currentSession?.staffName || loggedInUser?.staffMember.name || '未ログイン'
  const dashboardRole = currentSession?.staffRole ?? loggedInUser?.staffMember.role

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
    if (!currentStaffId) {
      return undefined
    }

    let isMounted = true

    fetchCaseRecords()
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
  }, [currentStaffId, currentSessionId])

  const dashboardSummary = useMemo(
    () =>
      calculateSummary({
        currentSessionId,
        records: dashboardRecordsState.records,
        staffId: currentStaffId,
      }),
    [currentSessionId, currentStaffId, dashboardRecordsState.records],
  )

  const clockOutSummary = useMemo(
    () =>
      calculateSummary({
        currentSessionId,
        records: summaryDialog.records,
        staffId: currentStaffId,
      }),
    [currentSessionId, currentStaffId, summaryDialog.records],
  )

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
        setLoginMessage('会社ID・スタッフID・パスワードが一致するスタッフが見つかりません。')
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

      const restoredSession = await workSession.restoreWorkingSession(staffMember)
      if (restoredSession) {
        setLoginMessage('ログインしました。勤務中状態を復元しました。')
        return
      }

      setLoginMessage('ログインしました。出勤位置を取得して勤務を開始しています。')
      await workSession.clockIn(nextLoggedInUser)
      setLoginMessage('ログインしました。出勤しました。')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `ログインまたは出勤できませんでした。${error.message}` : 'ログインまたは出勤できませんでした。',
      )
    } finally {
      setIsLoginSubmitting(false)
    }
  }

  const handleClockIn = async () => {
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
      setLoginMessage('出勤しました。')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `出勤できませんでした。${error.message}` : '出勤できませんでした。',
      )
    }
  }

  const handleLogout = () => {
    setLoggedInUser(null)
    setLoginForm((currentForm) => ({ ...currentForm, password: '' }))
    setLoginMessage('ログアウトしました。')
  }

  const openClockOutSummary = async () => {
    setSummaryDialog({ errorMessage: '', isLoading: true, isOpen: true, records: [] })
    try {
      const records = await fetchCaseRecords()
      setSummaryDialog({ errorMessage: '', isLoading: false, isOpen: true, records })
      setDashboardRecordsState({ errorMessage: '', records })
    } catch (error) {
      setSummaryDialog({
        errorMessage: error instanceof Error ? error.message : '退勤サマリーを取得できませんでした。',
        isLoading: false,
        isOpen: true,
        records: [],
      })
    }
  }

  const confirmClockOut = async () => {
    await workSession.clockOut()
    setSummaryDialog((currentDialog) => ({ ...currentDialog, isOpen: false }))
    setLoginMessage('退勤しました。お疲れ様でした。')
  }

  if (!loggedInUser && !currentSession) {
    return (
      <main className="page page--home page--login" aria-labelledby="home-title">
        <section className="hero-card login-card">
          <p className="eyebrow">Login</p>
          <h1 id="home-title">ログイン</h1>
          <p className="lead">会社ID・スタッフID・パスワードでスタッフを特定し、ログインと同時に出勤します。</p>
          <div className="login-form">
            <label>
              会社ID
              <input value={loginForm.companyId} onChange={(event) => handleLoginChange('companyId', event.target.value)} />
            </label>
            <label>
              スタッフID
              <input value={loginForm.userId} onChange={(event) => handleLoginChange('userId', event.target.value)} />
            </label>
            <label>
              パスワード
              <input type="password" value={loginForm.password} onChange={(event) => handleLoginChange('password', event.target.value)} />
            </label>
            <button className="primary-action login-submit" type="button" disabled={isLoginSubmitting} onClick={handleLogin}>
              {isLoginSubmitting ? '処理中' : 'ログインして出勤'}
            </button>
          </div>
          <p className="save-note">{loginMessage}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="page page--home" aria-labelledby="home-title">
      <section className="hero-card">
        <p className="eyebrow">Dashboard</p>
        <h1 id="home-title">TOP</h1>
        <div className="work-dashboard-grid">
          <div><span>会社</span><strong>{dashboardCompanyName}</strong></div>
          <div><span>店舗</span><strong>{dashboardStoreName}</strong></div>
          <div><span>担当</span><strong>{dashboardStaffName}</strong></div>
          <div><span>出勤</span><strong>{currentSession ? formatCaseDateTime(currentSession.clockInAt) : '未出勤'}</strong></div>
          <div><span>勤務時間</span><strong>{currentSession ? formatElapsedTime(elapsedSeconds) : '00:00:00'}</strong></div>
          <div><span>出勤状態</span><strong>{currentSession ? '● 出勤中' : '○ 未出勤'}</strong></div>
        </div>
        <section className="work-dashboard-grid" aria-label="本日実績">
          <div><span>本日件数</span><strong>{dashboardSummary.todayCount}件</strong></div>
          <div><span>本日売上</span><strong>{formatFareYen(dashboardSummary.todaySalesYen)}円</strong></div>
          <div><span>本日走行距離</span><strong>{dashboardSummary.todayDistanceKm.toFixed(1)}km</strong></div>
          <div><span>本日待機時間</span><strong>{formatElapsedTime(dashboardSummary.todayWaitingSeconds)}</strong></div>
          <div><span>本日付き添い時間</span><strong>{formatElapsedTime(dashboardSummary.todayAccompanyingSeconds)}</strong></div>
        </section>
        {dashboardRecordsState.errorMessage ? <p className="case-error">{dashboardRecordsState.errorMessage}</p> : null}
        <p className="save-note">{loginMessage}</p>
        <nav className="home-actions" aria-label="主要メニュー">
          {currentSession ? (
            <>
              <Link className="primary-action" to="/case/start">案件開始</Link>
              <button className="secondary-action home-button" type="button" onClick={openClockOutSummary}>退勤</button>
            </>
          ) : (
            <button className="primary-action home-button" type="button" onClick={handleClockIn}>出勤</button>
          )}
          <Link className="secondary-action" to="/cases">案件一覧</Link>
          <Link className="secondary-action" to="/admin">管理画面</Link>
          <Link className="secondary-action" to="/admin/analytics">売上分析</Link>
          {dashboardRole === 'superAdmin' ? (
            <Link className="secondary-action" to="/hq">FC本部管理</Link>
          ) : null}
          {!currentSession ? (
            <button className="secondary-action home-button" type="button" onClick={handleLogout}>ログアウト</button>
          ) : null}
        </nav>
      </section>

      {summaryDialog.isOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-modal clock-out-summary" role="dialog" aria-modal="true" aria-labelledby="clock-out-summary-title">
            <header className="settings-header">
              <div><span>Clock Out</span><h2 id="clock-out-summary-title">本日の実績</h2></div>
              <button type="button" onClick={() => setSummaryDialog((currentDialog) => ({ ...currentDialog, isOpen: false }))}>閉じる</button>
            </header>
            {summaryDialog.isLoading ? <p className="empty-note">実績を取得中です。</p> : null}
            {summaryDialog.errorMessage ? <p className="case-error">{summaryDialog.errorMessage}</p> : null}
            {!summaryDialog.isLoading ? (
              <div className="work-dashboard-grid">
                <div><span>案件数</span><strong>{clockOutSummary.todayCount}件</strong></div>
                <div><span>売上</span><strong>{formatFareYen(clockOutSummary.todaySalesYen)}円</strong></div>
                <div><span>走行距離</span><strong>{clockOutSummary.todayDistanceKm.toFixed(1)}km</strong></div>
                <div><span>運転時間</span><strong>{formatElapsedTime(clockOutSummary.todayDrivingSeconds)}</strong></div>
                <div><span>待機時間</span><strong>{formatElapsedTime(clockOutSummary.todayWaitingSeconds)}</strong></div>
                <div><span>付き添い時間</span><strong>{formatElapsedTime(clockOutSummary.todayAccompanyingSeconds)}</strong></div>
                <div><span>勤務時間</span><strong>{formatElapsedTime(elapsedSeconds)}</strong></div>
                <div><span>平均単価</span><strong>{formatFareYen(clockOutSummary.averageYen)}円</strong></div>
                <div><span>今月売上</span><strong>{formatFareYen(clockOutSummary.monthSalesYen)}円</strong></div>
                <div><span>今月件数</span><strong>{clockOutSummary.monthCount}件</strong></div>
              </div>
            ) : null}
            <p className="lead">お疲れ様でした</p>
            <button className="work-session-primary-button work-session-primary-button--danger" type="button" onClick={confirmClockOut}>
              退勤する
            </button>
          </section>
        </div>
      ) : null}
    </main>
  )
}
