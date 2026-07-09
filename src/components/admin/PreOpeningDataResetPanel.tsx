import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executePreOpeningDataReset,
  fetchPreOpeningResetCapability,
  preOpeningResetEmptyTargets,
  type PreOpeningResetCapabilityResult,
  type PreOpeningResetTargetCounts,
} from '../../services/reservationPreOpeningReset'
import { clearPreOpeningLocalDeviceData } from '../../utils/preOpeningLocalDeviceData'

type PreOpeningDataResetPanelProps = {
  franchiseeId: string
  storeId: string
  executedBy: string
  storeLabel?: string
}

const TARGET_LABELS: Record<string, string> = {
  caseRecords: '運行記録（案件）',
  workSessions: '勤務セッション',
  auditLogs: '監査ログ',
  accountingReceipts: '経理レシート',
  accountingExpenses: '経理経費',
  accountingAdjustments: '経理調整',
  accountingFixedCosts: '経理固定費',
  accountingSales: '売上記録',
  accountingExports: '経理エクスポート',
  maintenanceLogs: 'メンテナンスログ',
  adminActionLogs: '管理者操作ログ',
  operationLogs: '操作ログ',
  debugLogs: 'デバッグログ',
  errorLogs: 'エラーログ',
  resetLogs: 'リセットログ',
  caseCounters: '案件採番カウンタ',
  staffAttendance: '出勤記録',
  loginAttempts: 'ログイン試行記録',
  storageFiles: 'Storage 業務ファイル',
  reservations: '予約本体',
  blocks: '予約ブロック',
  quotes: '見積',
  quote_consents: '同意情報',
  meter_fixed_fare_runs: 'メーター固定運賃',
  email_logs: 'メール送信ログ',
  pre_opening_reset_logs: '開業前初期化ログ',
}

const formatTargets = (targets: PreOpeningResetTargetCounts) => {
  const rows: Array<[string, number]> = []
  for (const [key, count] of Object.entries(targets.firestore)) {
    if (count > 0) {
      rows.push([TARGET_LABELS[key] ?? `Firestore ${key}`, count])
    }
  }
  for (const [key, count] of Object.entries(targets.reservation)) {
    if (count > 0) {
      rows.push([TARGET_LABELS[key] ?? `reservation-v4 ${key}`, count])
    }
  }
  if (rows.length === 0) {
    rows.push(['削除対象', 0])
  }
  return rows
}

export function PreOpeningDataResetPanel({
  franchiseeId,
  storeId,
  executedBy,
  storeLabel,
}: PreOpeningDataResetPanelProps) {
  const [capability, setCapability] = useState<PreOpeningResetCapabilityResult | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const description =
    '開業前のテスト運用で作成した予約・運行・売上・経理・ログ情報を削除します。加盟店設定、店舗設定、スタッフ、車両、メーター設定、運賃設定、管理者設定は残ります。監査ログ・実行ログも削除されるため、開業後は使用しないでください。'

  const loadCapability = useCallback(async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setCapability(null)
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }

    setIsLoading(true)
    setMessage('削除対象件数を取得しています…')
    try {
      const result = await fetchPreOpeningResetCapability(franchiseeId.trim(), storeId.trim())
      setCapability(result)
      if (!result.supported) {
        setMessage('reservation-v4 側の開業前初期化 API は未対応です。')
        return
      }
      setMessage('削除対象件数を取得しました。RESET と入力して実行してください。')
    } catch (error) {
      setCapability(null)
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
    () => formatTargets(capability?.targets ?? preOpeningResetEmptyTargets()),
    [capability?.targets],
  )

  const handleExecute = async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }
    if (confirmText !== 'RESET') {
      setMessage('確認文字列に RESET を入力してください。')
      return
    }
    if (
      !window.confirm(
        '開業前テストデータを初期化します。予約・運行・売上・経理・監査ログ・実行ログも削除されます。この操作は元に戻せません。続行しますか？',
      )
    ) {
      return
    }

    setIsExecuting(true)
    setMessage('開業前テストデータを初期化しています…')
    try {
      const result = await executePreOpeningDataReset({
        franchiseeId: franchiseeId.trim(),
        storeId: storeId.trim(),
        confirmText,
        executedBy: executedBy.trim() || 'unknown',
      })
      if (!result.success) {
        setMessage('初期化処理が完了しませんでした。詳細を確認してください。')
        return
      }
      clearPreOpeningLocalDeviceData()
      setConfirmText('')
      setMessage(
        `初期化完了。予約 ${result.deleted.reservation.reservations ?? 0} 件、案件 ${result.deleted.firestore.caseRecords ?? 0} 件、監査ログ ${result.deleted.firestore.auditLogs ?? 0} 件を削除しました。端末内の一時データもクリアしました。`,
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
    <section className="admin-master-panel pre-opening-reset-panel" aria-labelledby="pre-opening-reset-title">
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Pre-opening Test Reset</p>
          <h2 id="pre-opening-reset-title">開業前テストデータ初期化</h2>
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
      <p className="case-error">
        開業後は使用しないでください。監査ログ・実行ログも削除されます。
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

      <table className="admin-master-table">
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

      <label className="pre-opening-reset-confirm">
        <span>確認文字列（RESET）</span>
        <input
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="RESET"
          autoComplete="off"
          disabled={isExecuting}
        />
      </label>

      <div className="pre-opening-reset-actions">
        <button
          className="admin-save-button"
          type="button"
          onClick={() => void handleExecute()}
          disabled={isLoading || isExecuting || !capability?.supported}
        >
          {isExecuting ? '初期化実行中…' : '開業前テストデータを初期化'}
        </button>
      </div>

      {message ? <p className="save-note">{message}</p> : null}
    </section>
  )
}
