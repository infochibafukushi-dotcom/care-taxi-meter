import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executePreOpeningReservationReset,
  fetchPreOpeningReservationResetCapability,
  preOpeningReservationDashboardEmptyCounts,
  preOpeningReservationResetEmptyTargets,
  type PreOpeningReservationDashboardCounts,
  type PreOpeningReservationResetCapabilityResult,
} from '../../services/reservationPreOpeningReset'

type PreOpeningReservationResetPanelProps = {
  franchiseeId: string
  storeId: string
  executedBy: string
  storeLabel?: string
}

const RESERVATION_TARGET_LABELS: Record<string, string> = {
  reservations: '予約本体',
  unhandled_reservations: '未対応予約',
  quotes: '見積',
  quote_consents: '同意情報',
  email_logs: 'メールログ',
}

const RESERVATION_TARGET_KEYS = [
  'reservations',
  'unhandled_reservations',
  'quotes',
  'quote_consents',
  'email_logs',
] as const

const formatReservationTargetRows = (targets: Record<string, number>) =>
  RESERVATION_TARGET_KEYS.map((key) => [
    RESERVATION_TARGET_LABELS[key] ?? key,
    Number(targets[key]) || 0,
  ] as const)

const formatDeletedSummary = (deleted: Record<string, number>) => {
  const parts = [
    `予約 ${deleted.reservations ?? 0} 件`,
    `未対応 ${deleted.unhandled_reservations ?? 0} 件`,
    `見積 ${deleted.quotes ?? 0} 件`,
    `同意 ${deleted.quote_consents ?? 0} 件`,
    `メールログ ${deleted.email_logs ?? 0} 件`,
  ]
  return parts.join('、')
}

export function PreOpeningReservationResetPanel({
  franchiseeId,
  storeId,
  executedBy,
  storeLabel,
}: PreOpeningReservationResetPanelProps) {
  const [capability, setCapability] =
    useState<PreOpeningReservationResetCapabilityResult | null>(null)
  const [dashboard, setDashboard] = useState<PreOpeningReservationDashboardCounts>(
    preOpeningReservationDashboardEmptyCounts(),
  )
  const [confirmText, setConfirmText] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const description =
    '開業前に作成した予約・見積・同意情報・予約メールログを削除します。運行記録や経理データは削除しません。'

  const loadCapability = useCallback(async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setCapability(null)
      setDashboard(preOpeningReservationDashboardEmptyCounts())
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }

    setIsLoading(true)
    setMessage('削除対象件数を取得しています…')
    try {
      const result = await fetchPreOpeningReservationResetCapability(
        franchiseeId.trim(),
        storeId.trim(),
      )
      setCapability(result)
      setDashboard(result.dashboard)
      if (!result.supported) {
        setMessage('reservation-v4 側の開業前予約初期化 API は未対応です。')
        return
      }
      setMessage('削除対象件数を取得しました。店舗IDを入力して実行してください。')
    } catch (error) {
      setCapability(null)
      setDashboard(preOpeningReservationDashboardEmptyCounts())
      setMessage(
        error instanceof Error
          ? `削除対象件数の取得に失敗しました。${error.message}`
          : '削除対象件数の取得に失敗しました。',
      )
    } finally {
      setIsLoading(false)
    }
  }, [franchiseeId, storeId])

  useEffect(() => {
    void loadCapability()
  }, [loadCapability])

  const targetRows = useMemo(
    () =>
      formatReservationTargetRows(
        capability?.targets.reservation ??
          preOpeningReservationResetEmptyTargets().reservation,
      ),
    [capability?.targets.reservation],
  )

  const handleExecute = async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }
    if (confirmText.trim() !== storeId.trim()) {
      setMessage('確認文字列に店舗IDを完全一致で入力してください。')
      return
    }
    if (
      !window.confirm(
        '開業前予約データを初期化します。予約・見積・同意情報・メールログのみ削除され、運行記録や経理データは残ります。この操作は元に戻せません。続行しますか？',
      )
    ) {
      return
    }

    setIsExecuting(true)
    setMessage('開業前予約データを初期化しています…')
    try {
      const result = await executePreOpeningReservationReset({
        franchiseeId: franchiseeId.trim(),
        storeId: storeId.trim(),
        confirmText,
        executedBy: executedBy.trim() || 'unknown',
      })
      if (!result.success) {
        setMessage('初期化処理が完了しませんでした。詳細を確認してください。')
        return
      }

      setConfirmText('')
      setDashboard(result.dashboard)
      setMessage(
        `初期化完了。${formatDeletedSummary(result.deleted.reservation)} を削除しました。予約件数 ${result.dashboard.totalReservations} 件、未対応 ${result.dashboard.unhandledReservations} 件、確認済 ${result.dashboard.confirmedReservations} 件です。`,
      )
      await loadCapability()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `初期化に失敗しました。${error.message}`
          : '初期化に失敗しました。',
      )
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <section
      className="admin-master-panel pre-opening-reset-panel"
      aria-labelledby="pre-opening-reservation-reset-title"
    >
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Pre-opening Reservation Reset</p>
          <h2 id="pre-opening-reservation-reset-title">開業前予約データ初期化</h2>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => void loadCapability()}
          disabled={isLoading || isExecuting}
        >
          件数を再取得
        </button>
      </div>

      <p className="empty-note">{description}</p>
      <p className="pre-opening-reset-scope-note">
        運行記録・売上・経理データは削除しません。完全初期化は別画面の「開業前テストデータ初期化」を使用してください。
      </p>

      <dl className="pre-opening-reset-scope">
        <div>
          <dt>加盟店ID</dt>
          <dd>{franchiseeId || '未設定'}</dd>
        </div>
        <div>
          <dt>店舗ID</dt>
          <dd>{storeId || '未設定'}</dd>
        </div>
        {storeLabel ? (
          <div>
            <dt>店舗名</dt>
            <dd>{storeLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>reservation-v4 対応</dt>
          <dd>{capability?.supported ? '対応済み' : '未確認 / 未対応'}</dd>
        </div>
      </dl>

      <section className="pre-opening-reset-section" aria-label="予約管理DLの現在件数">
        <h4>予約管理DLの現在件数</h4>
        <table className="pre-opening-reset-count-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>予約件数</td>
              <td>{isLoading ? '…' : dashboard.totalReservations}</td>
            </tr>
            <tr>
              <td>未対応</td>
              <td>{isLoading ? '…' : dashboard.unhandledReservations}</td>
            </tr>
            <tr>
              <td>確認済</td>
              <td>{isLoading ? '…' : dashboard.confirmedReservations}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="pre-opening-reset-section" aria-label="削除対象件数">
        <h4>削除対象件数</h4>
        <table className="pre-opening-reset-count-table">
          <thead>
            <tr>
              <th>削除対象</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {targetRows.map(([label, count]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="pre-opening-reset-confirm-block">
        <label className="pre-opening-reset-input-label" htmlFor="pre-opening-reservation-reset-confirm">
          確認文字列（店舗IDを完全入力）
        </label>
        <input
          id="pre-opening-reservation-reset-confirm"
          className="pre-opening-reset-input"
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={storeId || '店舗ID'}
          autoComplete="off"
          disabled={isExecuting}
        />
      </div>

      <div className="pre-opening-reset-actions">
        <button
          className="admin-save-button"
          type="button"
          onClick={() => void handleExecute()}
          disabled={isLoading || isExecuting || !capability?.supported}
        >
          {isExecuting ? '初期化実行中…' : '開業前予約データ初期化'}
        </button>
      </div>

      {message ? <p className="save-note">{message}</p> : null}
    </section>
  )
}
