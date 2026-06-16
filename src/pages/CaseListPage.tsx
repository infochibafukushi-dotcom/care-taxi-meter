import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { useWorkSession } from '../hooks/useWorkSession'
import { tenantScopeFromSession } from '../services/tenancy'
import { canManageCaseRecord } from '../types/permissions'
import {
  calculateTodayCaseSummary,
  formatCaseDateTime,
  formatComparisonDifferenceYen,
  getActualFareYen,
  getActualMeterMode,
  getCaseComparisonDisplay,
  meterModeLabels,
} from '../utils/caseRecords'
import { logDiagnostic } from '../utils/diagnostics'

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'

const formatOptionalDateTime = (dateTime: string) =>
  dateTime ? formatCaseDateTime(dateTime) : '―'

const formatOptionalText = (value: string) =>
  value.trim() ? value : '未設定'

type CaseRecordStatusFilter = 'normal' | 'canceled' | 'deleted'

type CaseRecordsState = {
  caseRecords: StoredCaseRecord[]
  errorMessage: string
  isLoading: boolean
}

export function CaseListPage() {
  const workSession = useWorkSession()
  const currentScope = tenantScopeFromSession(workSession.currentSession)
  const currentFranchiseeId = currentScope.franchiseeId
  const currentStoreId = currentScope.storeId
  const currentRole = workSession.currentSession?.staffRole ?? ''
  const canViewDeleted = canManageCaseRecord(currentRole)
  const [statusFilter, setStatusFilter] = useState<CaseRecordStatusFilter>('normal')
  const [state, setState] = useState<CaseRecordsState>({
    caseRecords: [],
    errorMessage: '',
    isLoading: true,
  })

  useEffect(() => {
    logDiagnostic('CaseListPage mount')
    return () => logDiagnostic('CaseListPage unmount')
  }, [])

  useEffect(() => {
    let isMounted = true

    fetchCaseRecords({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: workSession.currentSession?.staffRole, staffId: workSession.currentSession?.staffId })
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
  }, [currentFranchiseeId, currentStoreId, workSession.currentSession?.staffId, workSession.currentSession?.staffRole])

  const visibleCaseRecords = state.caseRecords.filter((caseRecord) => {
    if (statusFilter === 'deleted') {
      return canViewDeleted && caseRecord.deleted
    }

    if (statusFilter === 'canceled') {
      return !caseRecord.deleted && caseRecord.status === 'canceled'
    }

    return !caseRecord.deleted && caseRecord.status !== 'canceled'
  })
  const todaySummary = calculateTodayCaseSummary(state.caseRecords)

  return (
    <main className="page case-list-page" aria-labelledby="case-list-title">
      <section className="content-card case-list-card">
        <div className="case-list-header">
          <div>
            <Link className="text-link" to="/">
              ← TOPへ戻る
            </Link>
            <p className="eyebrow">Case Records</p>
            <h1 id="case-list-title">案件一覧</h1>
          </div>
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

        <fieldset className="payment-methods" aria-label="状態フィルタ">
          <legend>状態</legend>
          <label>
            <input checked={statusFilter === 'normal'} name="case-status-filter" type="radio" onChange={() => setStatusFilter('normal')} />
            通常
          </label>
          <label>
            <input checked={statusFilter === 'canceled'} name="case-status-filter" type="radio" onChange={() => setStatusFilter('canceled')} />
            キャンセル
          </label>
          {canViewDeleted ? (
            <label>
              <input checked={statusFilter === 'deleted'} name="case-status-filter" type="radio" onChange={() => setStatusFilter('deleted')} />
              削除済み（監査用）
            </label>
          ) : null}
        </fieldset>

        {!state.isLoading && !state.errorMessage && visibleCaseRecords.length === 0 ? (
          <p className="empty-note">表示対象の案件はありません。</p>
        ) : null}

        <div className="case-record-list" aria-label="保存済み案件">
          {visibleCaseRecords.map((caseRecord) => {
            const actualMeterMode = getActualMeterMode(caseRecord)
            const comparisonDisplay = getCaseComparisonDisplay(caseRecord)

            return (
            <Link
              className="case-record-row case-record-row--with-addresses"
              key={caseRecord.id}
              to={`/cases/${caseRecord.id}`}
            >
              <span>
                <small>案件番号</small>
                <strong>{caseRecord.deleted ? `【削除済】${caseRecord.caseNumber}` : caseRecord.caseNumber}</strong>
              </span>
              <span>
                <small>日時</small>
                <strong>{formatCaseDateTime(caseRecord.closedAt)}</strong>
              </span>
              <span>
                <small>開始時刻</small>
                <strong>{formatOptionalDateTime(caseRecord.startedAt)}</strong>
              </span>
              <span>
                <small>終了時刻</small>
                <strong>{formatOptionalDateTime(caseRecord.endedAt)}</strong>
              </span>
              <span className="case-record-address">
                <small>伺い先住所</small>
                <strong>{formatAddress(caseRecord.pickupAddress)}</strong>
              </span>
              <span className="case-record-address">
                <small>送り先住所</small>
                <strong>{formatAddress(caseRecord.dropoffAddress)}</strong>
              </span>
              <span>
                <small>会社</small>
                <strong>{formatOptionalText(caseRecord.companyName)}</strong>
              </span>
              <span>
                <small>担当スタッフ</small>
                <strong>{formatOptionalText(caseRecord.staffName)}</strong>
              </span>
              <span>
                <small>車両</small>
                <strong>{formatOptionalText(caseRecord.vehicleName)}</strong>
              </span>
              <span>
                <small>ステータス</small>
                <strong>{caseRecord.deleted ? '【削除済】' : caseRecord.status === 'canceled' ? 'キャンセル済' : '通常'}</strong>
              </span>
              <span>
                <small>支払方法</small>
                <strong>{caseRecord.paymentMethod}</strong>
              </span>
              <span>
                <small>運賃/営業距離</small>
                <strong>{caseRecord.chargeableDistanceKm.toFixed(3)} / {caseRecord.businessDistanceKm.toFixed(3)} km</strong>
              </span>
              <span className="case-record-meter-summary">
                <small>使用メーター</small>
                <strong>
                  <span className={`meter-mode-badge meter-mode-badge--${actualMeterMode}`}>
                    {meterModeLabels[actualMeterMode]}
                  </span>
                </strong>
                <small>請求額</small>
                <strong>{formatFareYen(getActualFareYen(caseRecord))}円</strong>
                {comparisonDisplay ? (
                  <>
                    <small>{comparisonDisplay.comparisonLabel}</small>
                    <strong>{formatFareYen(comparisonDisplay.comparisonFareYen)}円</strong>
                    <small>差額</small>
                    <strong>{formatComparisonDifferenceYen(comparisonDisplay.differenceYen)}</strong>
                  </>
                ) : null}
              </span>
            </Link>
            )
          })}
        </div>

        <p className="osm-attribution">
          住所データ © Google
        </p>
      </section>
    </main>
  )
}
