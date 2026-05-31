import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { authenticateStaff } from '../services/staffMembers'
import { defaultCompanyId, fetchStores } from '../services/stores'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { formatElapsedTime } from '../utils/time'
import { getMonthRangeInJapan, getTodayRangeInJapan, formatCaseDateTime } from '../utils/caseRecords'

const defaultCompanyName = 'ちばケアタクシー'

type LoginForm = {
  companyId: string
  userId: string
  password: string
}

type SummaryDialogState = {
  errorMessage: string
  isLoading: boolean
  isOpen: boolean
  records: StoredCaseRecord[]
}

const calculateAverageYen = (salesYen: number, count: number) =>
  count > 0 ? Math.round(salesYen / count) : 0

export function HomePage() {
  const workSession = useWorkSession()
  const [loginForm, setLoginForm] = useState<LoginForm>({
    companyId: defaultCompanyId,
    userId: '',
    password: '',
  })
  const [loginMessage, setLoginMessage] = useState('会社ID・ユーザーID・パスワードで出勤してください。')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [summaryDialog, setSummaryDialog] = useState<SummaryDialogState>({
    errorMessage: '',
    isLoading: false,
    isOpen: false,
    records: [],
  })

  useEffect(() => {
    if (!workSession.currentSession) {
      return undefined
    }

    const updateElapsedSeconds = () => {
      setElapsedSeconds(
        Math.max(
          Math.floor((Date.now() - new Date(workSession.currentSession!.clockInAt).getTime()) / 1000),
          0,
        ),
      )
    }

    updateElapsedSeconds()
    const timerId = window.setInterval(updateElapsedSeconds, 1000)
    return () => window.clearInterval(timerId)
  }, [workSession.currentSession])

  const summary = useMemo(() => {
    const currentSession = workSession.currentSession
    const todayRange = getTodayRangeInJapan()
    const monthRange = getMonthRangeInJapan()
    const todayRecords = summaryDialog.records.filter((caseRecord) => {
      const belongsToSession = currentSession
        ? caseRecord.workSessionId === currentSession.id ||
          (!caseRecord.workSessionId && caseRecord.staffId === currentSession.staffId)
        : true
      return (
        belongsToSession &&
        caseRecord.closedAt >= todayRange.startIso &&
        caseRecord.closedAt < todayRange.endIso
      )
    })
    const monthRecords = summaryDialog.records.filter(
      (caseRecord) =>
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
  }, [summaryDialog.records, workSession.currentSession])

  const handleLoginChange = (key: keyof LoginForm, value: string) => {
    setLoginForm((currentForm) => ({ ...currentForm, [key]: value }))
  }

  const handleClockIn = async () => {
    setLoginMessage('認証中です。')
    try {
      const staffMember = await authenticateStaff(loginForm)
      if (!staffMember) {
        setLoginMessage('会社ID・ユーザーID・パスワードが一致するスタッフが見つかりません。')
        return
      }

      const stores = await fetchStores(staffMember.companyId)
      const store = stores.find((item) => item.id === staffMember.storeId) ?? stores[0]
      if (!store) {
        setLoginMessage('所属店舗が見つかりません。管理画面で店舗を登録してください。')
        return
      }

      await workSession.clockIn({ staffMember, store })
      setLoginMessage('出勤しました。')
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? `出勤できませんでした。${error.message}` : '出勤できませんでした。',
      )
    }
  }

  const openClockOutSummary = async () => {
    setSummaryDialog({ errorMessage: '', isLoading: true, isOpen: true, records: [] })
    try {
      const records = await fetchCaseRecords()
      setSummaryDialog({ errorMessage: '', isLoading: false, isOpen: true, records })
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
    workSession.logout()
    setSummaryDialog((currentDialog) => ({ ...currentDialog, isOpen: false }))
    setLoginMessage('退勤しました。お疲れ様でした。')
  }

  if (!workSession.currentSession) {
    return (
      <main className="page page--home" aria-labelledby="home-title">
        <section className="hero-card login-card">
          <p className="eyebrow">Clock In</p>
          <h1 id="home-title">出勤</h1>
          <p className="lead">ログインと同時に出勤し、勤務セッションを開始します。</p>
          <div className="login-form">
            <label>
              会社ID
              <input value={loginForm.companyId} onChange={(event) => handleLoginChange('companyId', event.target.value)} />
            </label>
            <label>
              ユーザーID
              <input value={loginForm.userId} onChange={(event) => handleLoginChange('userId', event.target.value)} />
            </label>
            <label>
              パスワード
              <input type="password" value={loginForm.password} onChange={(event) => handleLoginChange('password', event.target.value)} />
            </label>
            <button className="primary-action login-submit" type="button" onClick={handleClockIn}>
              出勤
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
          <div><span>会社</span><strong>{defaultCompanyName}</strong></div>
          <div><span>店舗</span><strong>{workSession.currentSession.storeName}</strong></div>
          <div><span>担当</span><strong>{workSession.currentSession.staffName}</strong></div>
          <div><span>出勤</span><strong>{formatCaseDateTime(workSession.currentSession.clockInAt)}</strong></div>
          <div><span>勤務時間</span><strong>{formatElapsedTime(elapsedSeconds)}</strong></div>
          <div><span>出勤状態</span><strong>● 出勤中</strong></div>
        </div>
        <nav className="home-actions" aria-label="主要メニュー">
          <Link className="primary-action" to="/case">案件開始</Link>
          <Link className="secondary-action" to="/cases">案件一覧</Link>
          <Link className="secondary-action" to="/admin">管理画面</Link>
          <Link className="secondary-action" to="/admin/analytics">売上分析</Link>
          <button className="secondary-action home-button" type="button" onClick={openClockOutSummary}>退勤</button>
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
                <div><span>案件数</span><strong>{summary.todayCount}件</strong></div>
                <div><span>売上</span><strong>{formatFareYen(summary.todaySalesYen)}円</strong></div>
                <div><span>走行距離</span><strong>{summary.todayDistanceKm.toFixed(1)}km</strong></div>
                <div><span>運転時間</span><strong>{formatElapsedTime(summary.todayDrivingSeconds)}</strong></div>
                <div><span>待機時間</span><strong>{formatElapsedTime(summary.todayWaitingSeconds)}</strong></div>
                <div><span>付き添い時間</span><strong>{formatElapsedTime(summary.todayAccompanyingSeconds)}</strong></div>
                <div><span>勤務時間</span><strong>{formatElapsedTime(elapsedSeconds)}</strong></div>
                <div><span>平均単価</span><strong>{formatFareYen(summary.averageYen)}円</strong></div>
                <div><span>今月売上</span><strong>{formatFareYen(summary.monthSalesYen)}円</strong></div>
                <div><span>今月件数</span><strong>{summary.monthCount}件</strong></div>
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
