import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecordsInClosedAtRange } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import {
  calculateCaseSummary,
  getMonthRangeInJapan,
  getTodayRangeInJapan,
} from '../utils/caseRecords'

type AdminSummaryState = {
  errorMessage: string
  isLoading: boolean
  monthlyCaseRecords: StoredCaseRecord[]
}

export function AdminPage() {
  const [state, setState] = useState<AdminSummaryState>({
    errorMessage: '',
    isLoading: true,
    monthlyCaseRecords: [],
  })

  useEffect(() => {
    let isMounted = true
    const monthRange = getMonthRangeInJapan()

    fetchCaseRecordsInClosedAtRange(monthRange)
      .then((monthlyCaseRecords) => {
        if (!isMounted) {
          return
        }

        setState({ errorMessage: '', isLoading: false, monthlyCaseRecords })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState({
          errorMessage:
            error instanceof Error
              ? error.message
              : '管理画面の集計取得に失敗しました。',
          isLoading: false,
          monthlyCaseRecords: [],
        })
      })

    return () => {
      isMounted = false
    }
  }, [])

  const todayRange = getTodayRangeInJapan()
  const todaySummary = calculateCaseSummary(
    state.monthlyCaseRecords.filter(
      (caseRecord) =>
        caseRecord.closedAt >= todayRange.startIso &&
        caseRecord.closedAt < todayRange.endIso,
    ),
  )
  const monthSummary = calculateCaseSummary(state.monthlyCaseRecords)

  return (
    <main className="page admin-page" aria-labelledby="admin-title">
      <section className="content-card admin-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h1 id="admin-title">管理画面</h1>
          </div>
          <Link className="text-link" to="/">
            ホームへ戻る
          </Link>
        </div>

        <p className="lead admin-lead">
          Firestoreの保存済み案件から本日・今月の売上と件数を集計します。
        </p>

        {state.isLoading ? (
          <p className="empty-note">Firestoreから管理集計を取得中です。</p>
        ) : null}

        {state.errorMessage ? (
          <p className="case-error" role="alert">
            {state.errorMessage}
          </p>
        ) : null}

        <div className="admin-summary-grid" aria-label="管理集計">
          <div>
            <span>本日売上</span>
            <strong>{formatFareYen(todaySummary.salesYen)}円</strong>
          </div>
          <div>
            <span>本日件数</span>
            <strong>{todaySummary.count}件</strong>
          </div>
          <div>
            <span>今月売上</span>
            <strong>{formatFareYen(monthSummary.salesYen)}円</strong>
          </div>
          <div>
            <span>今月件数</span>
            <strong>{monthSummary.count}件</strong>
          </div>
        </div>

        <Link className="text-link" to="/cases">
          案件一覧へ
        </Link>
      </section>
    </main>
  )
}
