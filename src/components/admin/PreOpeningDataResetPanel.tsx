import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executePreOpeningDataReset,
  fetchPreOpeningResetCapability,
  preOpeningResetEmptyTargets,
  preOpeningResetEmptyPreserved,
  preOpeningReservationDashboardEmptyCounts,
  type PreOpeningResetCapabilityResult,
  type PreOpeningReservationDashboardCounts,
  type PreOpeningResetPreservedPayload,
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
  maintenanceLogs: 'メンテナンスログ',
  adminActionLogs: '管理者操作ログ',
  operationLogs: '操作ログ',
  debugLogs: 'デバッグログ',
  errorLogs: 'エラーログ',
  resetLogs: 'リセットログ',
  caseCounters: '案件採番カウンタ',
  staffAttendance: '出勤記録',
  loginAttempts: 'ログイン試行記録',
  storageFiles: '運行側 Storage ファイル',
  reservations: '予約本体',
  blocks: '予約ブロック',
  quotes: '見積',
  quote_consents: '同意情報',
  meter_fixed_fare_runs: '予約システム側の固定運賃実行履歴',
  email_logs: 'メール送信ログ',
  pre_opening_reset_logs: '開業前初期化ログ',
}

const DELETE_CATEGORY_LABELS = [
  '売上（運行案件由来）',
  '運行案件',
  '運行履歴',
  '精算',
  '運行側領収書',
  '売上集計（日報・月報の元データ）',
  'GPS・ルート・走行チャンク',
  'メーター側の固定運賃実行履歴・一時保存',
  '勤務セッション・関連ログ',
] as const

const PRESERVE_CATEGORY_LABELS = [
  '加盟店',
  '店舗',
  '従業員',
  '車両',
  '料金設定',
  'メーター設定',
  '会社・店舗・システム設定',
  '経理データ',
  '経理の領収書画像／PDF',
  '未整理領収書',
  '固定資産',
  '仕訳・帳簿・PL・税務資料',
  'Firebase Authentication',
] as const

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
  const [dashboard, setDashboard] = useState<PreOpeningReservationDashboardCounts>(
    preOpeningReservationDashboardEmptyCounts(),
  )
  const [preserved, setPreserved] = useState<PreOpeningResetPreservedPayload>(
    preOpeningResetEmptyPreserved(),
  )
  const [confirmText, setConfirmText] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const description =
    '開業前のテスト運用で作成した予約・運行・売上・ログ情報を削除します。加盟店設定、店舗設定、スタッフ、車両、メーター設定、運賃設定、管理者設定、および経理データ・経理証憑は残ります。予約のみ削除する場合は予約管理DLの「開業前予約データ初期化」を使用してください。監査ログ・実行ログも削除されるため、開業後は使用しないでください。'

  const loadCapability = useCallback(async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setCapability(null)
      setDashboard(preOpeningReservationDashboardEmptyCounts())
      setPreserved(preOpeningResetEmptyPreserved())
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }

    setIsLoading(true)
    setMessage('削除対象件数を取得しています…')
    try {
      const result = await fetchPreOpeningResetCapability(franchiseeId.trim(), storeId.trim())
      setCapability(result)
      setDashboard(result.dashboard)
      setPreserved(result.preserved)
      if (!result.supported) {
        setMessage('reservation-v4 側の開業前初期化 API は未対応です。')
        return
      }
      setMessage('削除対象件数を取得しました。RESET と入力して実行してください。')
    } catch (error) {
      setCapability(null)
      setDashboard(preOpeningReservationDashboardEmptyCounts())
      setPreserved(preOpeningResetEmptyPreserved())
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
        '開業前テストデータを初期化します。予約・運行・売上・監査ログ・実行ログは削除されます。経理データおよび経理証憑は削除されません。予約のみ削除する場合は予約管理DLの「開業前予約データ初期化」を使用してください。この操作は元に戻せません。続行しますか？',
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
      setDashboard(result.dashboard)
      setPreserved(result.preserved)
      setMessage(
        `初期化完了。予約 ${result.deleted.reservation.reservations ?? 0} 件、案件 ${result.deleted.firestore.caseRecords ?? 0} 件、監査ログ ${result.deleted.firestore.auditLogs ?? 0} 件を削除しました。経理データは保持しました。予約件数 ${result.dashboard.totalReservations} 件、未対応 ${result.dashboard.unhandledReservations} 件、確認済 ${result.dashboard.confirmedReservations} 件です。端末内の一時データもクリアしました。`,
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
          <h2 id="pre-opening-reset-title">開業前テストデータ初期化（完全）</h2>
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
      <p className="case-error" role="alert">
        経理データおよび経理証憑は削除されません
      </p>
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
        <div>
          <dt>経理保護</dt>
          <dd>{preserved.accountingProtected ? '保護対象（削除しない）' : '要確認'}</dd>
        </div>
      </dl>

      <section className="pre-opening-reset-section" aria-label="削除されるデータ">
        <h4>削除されるデータ</h4>
        <ul className="pre-opening-reset-list">
          {DELETE_CATEGORY_LABELS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="pre-opening-reset-section" aria-label="削除されないデータ">
        <h4>削除されないデータ</h4>
        <ul className="pre-opening-reset-list pre-opening-reset-list--preserved">
          {PRESERVE_CATEGORY_LABELS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

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
            <tr>
              <td>経理データ</td>
              <td>保持</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="pre-opening-reset-section" aria-label="削除対象件数">
        <h4>削除対象件数</h4>
        <table className="admin-master-table pre-opening-reset-count-table">
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
        <label className="pre-opening-reset-input-label" htmlFor="pre-opening-full-reset-confirm">
          確認文字列（RESET）
        </label>
        <input
          id="pre-opening-full-reset-confirm"
          className="pre-opening-reset-input"
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="RESET"
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
          {isExecuting ? '初期化実行中…' : '開業前テストデータを完全初期化'}
        </button>
      </div>

      {message ? <p className="save-note">{message}</p> : null}
    </section>
  )
}
