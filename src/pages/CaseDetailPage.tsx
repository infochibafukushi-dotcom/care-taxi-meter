import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchCaseRecord } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from '../utils/caseRecords'

type CaseDetailState = {
  caseRecord: StoredCaseRecord | null
  errorMessage: string
  isLoading: boolean
}

export function CaseDetailPage() {
  const { caseRecordId } = useParams()
  const [state, setState] = useState<CaseDetailState>({
    caseRecord: null,
    errorMessage: '',
    isLoading: true,
  })

  useEffect(() => {
    let isMounted = true

    if (!caseRecordId) {
      return undefined
    }

    fetchCaseRecord(caseRecordId)
      .then((caseRecord) => {
        if (!isMounted) {
          return
        }

        setState({
          caseRecord,
          errorMessage: caseRecord ? '' : '案件が見つかりませんでした。',
          isLoading: false,
        })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState({
          caseRecord: null,
          errorMessage:
            error instanceof Error
              ? error.message
              : '案件詳細の取得に失敗しました。',
          isLoading: false,
        })
      })

    return () => {
      isMounted = false
    }
  }, [caseRecordId])

  const caseRecord = state.caseRecord
  const errorMessage = caseRecordId
    ? state.errorMessage
    : '案件IDが指定されていません。'
  const isLoading = caseRecordId ? state.isLoading : false

  return (
    <main className="page case-detail-page" aria-labelledby="case-detail-title">
      <section className="content-card case-detail-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Case Detail</p>
            <h1 id="case-detail-title">案件詳細</h1>
          </div>
          <Link className="text-link" to="/cases">
            一覧へ戻る
          </Link>
        </div>

        {isLoading ? (
          <p className="empty-note">Firestoreから案件詳細を取得中です。</p>
        ) : null}

        {errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {caseRecord ? (
          <div className="case-detail-grid" aria-label="案件詳細">
            <div>
              <span>案件番号</span>
              <strong>{caseRecord.caseNumber}</strong>
            </div>
            <div>
              <span>日時</span>
              <strong>{formatCaseDateTime(caseRecord.closedAt)}</strong>
            </div>
            <div>
              <span>距離</span>
              <strong>{caseRecord.distanceKm.toFixed(3)} km</strong>
            </div>
            <div>
              <span>基本運賃</span>
              <strong>{formatFareYen(caseRecord.basicFareYen)}円</strong>
            </div>
            <div>
              <span>待機料金</span>
              <strong>{formatFareYen(caseRecord.waitingFareYen)}円</strong>
            </div>
            <div>
              <span>付き添い料金</span>
              <strong>{formatFareYen(caseRecord.escortFareYen)}円</strong>
            </div>
            <div>
              <span>介助料金</span>
              <strong>{formatFareYen(caseRecord.careOptionFareYen)}円</strong>
            </div>
            <div>
              <span>実費</span>
              <strong>{formatFareYen(caseRecord.expenseFareYen)}円</strong>
            </div>
            <div>
              <span>合計金額</span>
              <strong>{formatFareYen(caseRecord.totalFareYen)}円</strong>
            </div>
            <div>
              <span>支払方法</span>
              <strong>{caseRecord.paymentMethod}</strong>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
