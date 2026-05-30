import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import {
  calculateTodayCaseSummary,
  formatCaseDateTime,
} from '../utils/caseRecords'

type CaseRecordsState = {
  caseRecords: StoredCaseRecord[]
  errorMessage: string
  isLoading: boolean
}

export function CaseListPage() {
  const [state, setState] = useState<CaseRecordsState>({
    caseRecords: [],
    errorMessage: '',
    isLoading: true,
  })

  useEffect(() => {
    let isMounted = true

    fetchCaseRecords()
      .then((caseRecords) => {
        if (!isMounted) {
          return
        }

        setState({ caseRecords, errorMessage: '', isLoading: false })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState({
          caseRecords: [],
          errorMessage:
            error instanceof Error
              ? error.message
              : '案件一覧の取得に失敗しました。',
          isLoading: false,
        })
      })

    return () => {
      isMounted = false
    }
  }, [])

  const todaySummary = calculateTodayCaseSummary(state.caseRecords)

  return (
    <main className="page case-list-page" aria-labelledby="case-list-title">
      <section className="content-card case-list-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Case Records</p>
            <h1 id="case-list-title">案件一覧</h1>
          </div>
          <Link className="text-link" to="/case">
            新規案件へ
          </Link>
        </div>

        <div className="case-summary-grid" aria-label="本日の集計">
          <div>
            <span>本日売上</span>
            <strong>{formatFareYen(todaySummary.salesYen)}円</strong>
          </div>
          <div>
            <span>本日件数</span>
            <strong>{todaySummary.count}件</strong>
          </div>
        </div>

        {state.isLoading ? (
          <p className="empty-note">Firestoreから案件一覧を取得中です。</p>
        ) : null}

        {state.errorMessage ? (
          <p className="case-error" role="alert">
            {state.errorMessage}
          </p>
        ) : null}

        {!state.isLoading && !state.errorMessage && state.caseRecords.length === 0 ? (
          <p className="empty-note">保存済み案件はまだありません。</p>
        ) : null}

        <div className="case-record-list" aria-label="保存済み案件">
          {state.caseRecords.map((caseRecord) => (
            <Link
              className="case-record-row"
              key={caseRecord.id}
              to={`/cases/${caseRecord.id}`}
            >
              <span>
                <small>案件番号</small>
                <strong>{caseRecord.caseNumber}</strong>
              </span>
              <span>
                <small>日時</small>
                <strong>{formatCaseDateTime(caseRecord.closedAt)}</strong>
              </span>
              <span>
                <small>支払方法</small>
                <strong>{caseRecord.paymentMethod}</strong>
              </span>
              <span>
                <small>距離</small>
                <strong>{caseRecord.distanceKm.toFixed(3)} km</strong>
              </span>
              <span>
                <small>合計金額</small>
                <strong>{formatFareYen(caseRecord.totalFareYen)}円</strong>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
