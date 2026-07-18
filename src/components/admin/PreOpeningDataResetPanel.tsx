import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executePreOpeningDataReset,
  fetchPreOpeningResetCapability,
  preOpeningResetEmptyCategories,
  preOpeningResetEmptyPreserved,
  type PreOpeningResetCapabilityResult,
  type PreOpeningResetCategorySummary,
  type PreOpeningResetPreservedPayload,
} from '../../services/reservationPreOpeningReset'
import { clearPreOpeningLocalDeviceData } from '../../utils/preOpeningLocalDeviceData'
import { matchesStoreIdConfirmText } from '../../utils/preOpeningResetGuard'

type PreOpeningDataResetPanelProps = {
  franchiseeId: string
  storeId: string
  executedBy: string
  storeLabel?: string
  companyStatus?: string
}

type SummaryRow = {
  item: string
  afterReset: string
  action: '削除' | '保持'
  countKey?: keyof PreOpeningResetCategorySummary
}

const SUMMARY_ROWS: SummaryRow[] = [
  { item: '売上・運行', afterReset: '0件', action: '削除', countKey: 'salesOperations' },
  { item: '予約・顧客', afterReset: '0件', action: '削除', countKey: 'reservationsCustomers' },
  { item: '勤怠実績', afterReset: '0件', action: '削除', countKey: 'attendance' },
  { item: '経理', afterReset: '現在のまま', action: '保持' },
  { item: '加盟店・店舗', afterReset: '現在のまま', action: '保持' },
  { item: 'スタッフ', afterReset: '現在のまま', action: '保持' },
  { item: '予約時間ブロック', afterReset: '現在のまま', action: '保持' },
  { item: '料金・車両・設定', afterReset: '現在のまま', action: '保持' },
]

const DETAIL_TARGET_LABELS: Record<string, string> = {
  caseRecords: '運行記録（案件）',
  caseCounters: '案件採番カウンタ',
  storageFiles: '運行側 Storage ファイル',
  workSessions: '勤務セッション',
  staffAttendance: '出勤状態',
  reservations: '予約',
  quotes: '見積',
  quote_consents: '予約同意',
  email_logs: '予約メール履歴',
  meter_fixed_fare_runs: 'メーター固定運賃運行',
  pre_opening_reset_logs: '開業前リセット過去ログ',
  blocks: '予約ブロック（削除しない）',
}

export function PreOpeningDataResetPanel({
  franchiseeId,
  storeId,
  executedBy,
  storeLabel,
  companyStatus,
}: PreOpeningDataResetPanelProps) {
  const [capability, setCapability] = useState<PreOpeningResetCapabilityResult | null>(null)
  const [preserved, setPreserved] = useState<PreOpeningResetPreservedPayload>(
    preOpeningResetEmptyPreserved(),
  )
  const [categories, setCategories] = useState<PreOpeningResetCategorySummary>(
    preOpeningResetEmptyCategories(),
  )
  const [confirmText, setConfirmText] = useState('')
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const loadCapability = useCallback(async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setCapability(null)
      setPreserved(preOpeningResetEmptyPreserved())
      setCategories(preOpeningResetEmptyCategories())
      setPreviewLoaded(false)
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }

    setIsLoading(true)
    setPreviewLoaded(false)
    setMessage('削除予定件数を取得しています…')
    try {
      const result = await fetchPreOpeningResetCapability(franchiseeId.trim(), storeId.trim())
      setCapability(result)
      setPreserved(result.preserved)
      setCategories(result.categories)
      setPreviewLoaded(true)
      if (!result.supported) {
        setMessage(result.reason || '現在は開業前データリセットを利用できません。')
      } else {
        setMessage('削除予定件数を取得しました。店舗IDを入力して実行してください。')
      }
    } catch (error) {
      setCapability(null)
      setPreserved(preOpeningResetEmptyPreserved())
      setCategories(preOpeningResetEmptyCategories())
      setPreviewLoaded(false)
      setMessage(
        error instanceof Error
          ? `削除予定件数の取得に失敗しました。${error.message}`
          : '削除予定件数の取得に失敗しました。',
      )
    } finally {
      setIsLoading(false)
    }
  }, [franchiseeId, storeId])

  useEffect(() => {
    void loadCapability()
  }, [loadCapability])

  const detailRows = useMemo(() => {
    const rows: Array<[string, number]> = []
    const firestore = capability?.targets.firestore ?? {}
    const reservation = capability?.targets.reservation ?? {}
    for (const [key, count] of Object.entries(firestore)) {
      rows.push([DETAIL_TARGET_LABELS[key] ?? `Firestore ${key}`, Number(count) || 0])
    }
    for (const [key, count] of Object.entries(reservation)) {
      if (key === 'blocks' || key === 'unhandled_reservations' || key === 'confirmed_reservations') {
        continue
      }
      rows.push([DETAIL_TARGET_LABELS[key] ?? `reservation ${key}`, Number(count) || 0])
    }
    return rows
  }, [capability?.targets])

  const canExecute =
    previewLoaded &&
    Boolean(capability?.supported) &&
    !capability?.locked &&
    matchesStoreIdConfirmText(confirmText, storeId) &&
    !isLoading &&
    !isExecuting

  const handleExecute = async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }
    if (!previewLoaded || !capability) {
      setMessage('実行前に削除予定件数のプレビューを取得してください。')
      return
    }
    if (!capability.supported) {
      setMessage(capability.reason || '現在は開業前データリセットを利用できません。')
      return
    }
    if (!matchesStoreIdConfirmText(confirmText, storeId)) {
      setMessage('確認文字列に店舗IDを完全一致で入力してください。')
      return
    }
    if (
      !window.confirm(
        '開業前のテストデータを選択削除します。経理・加盟店・スタッフ・予約ブロック・設定は保持されます。この操作は元に戻せません。続行しますか？',
      )
    ) {
      return
    }

    setIsExecuting(true)
    setMessage('開業前データリセットを実行しています…')
    try {
      const result = await executePreOpeningDataReset({
        franchiseeId: franchiseeId.trim(),
        storeId: storeId.trim(),
        confirmText,
        executedBy: executedBy.trim() || 'unknown',
      })
      clearPreOpeningLocalDeviceData()
      setConfirmText('')
      setPreserved(result.preserved)
      setCategories(result.categories)
      const failedFirestore = Object.entries(result.failed.firestore)
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => `${DETAIL_TARGET_LABELS[key] ?? key}:${count}`)
      const failedReservation = Object.entries(result.failed.reservation)
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => `${DETAIL_TARGET_LABELS[key] ?? key}:${count}`)
      const failedParts = [...failedFirestore, ...failedReservation]
      setMessage(
        [
          result.success ? '初期化完了。' : '初期化は一部失敗しました。',
          `売上・運行 ${result.deleted.firestore.caseRecords ?? 0}件`,
          `勤怠 ${Number(result.deleted.firestore.workSessions || 0) + Number(result.deleted.firestore.staffAttendance || 0)}件`,
          `予約 ${result.deleted.reservation.reservations ?? 0}件`,
          failedParts.length ? `失敗: ${failedParts.join(', ')}` : '',
          result.reservationError ? `予約API: ${result.reservationError}` : '',
          '実行後ロック済み。端末内の一時データもクリアしました。',
        ]
          .filter(Boolean)
          .join(' '),
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
          <p className="eyebrow">Pre-opening Selective Reset</p>
          <h2 id="pre-opening-reset-title">開業前データリセット</h2>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => void loadCapability()}
          disabled={isLoading || isExecuting}
        >
          件数プレビューを再取得
        </button>
      </div>

      <p className="empty-note">
        開業前モード中のみ、対象加盟店・店舗のテスト実績を選択削除します。経理・マスター・予約ブロックは保持します。
      </p>
      <p className="case-error" role="alert">
        経理データおよび経理証憑は削除されません
      </p>
      <p className="case-error" role="alert">
        予約時間ブロック設定は削除されません
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
          <dt>加盟店ステータス</dt>
          <dd>{capability?.companyStatus || companyStatus || '未取得'}</dd>
        </div>
        <div>
          <dt>実行可否</dt>
          <dd>
            {capability?.locked
              ? 'ロック済み'
              : capability?.supported
                ? '開業前モード（実行可）'
                : capability?.reason || '不可'}
          </dd>
        </div>
        <div>
          <dt>経理保護</dt>
          <dd>{preserved.accountingProtected ? '保護対象（削除しない）' : '要確認'}</dd>
        </div>
        <div>
          <dt>予約ブロック保護</dt>
          <dd>{preserved.reservationBlocksProtected ? '保護対象（削除しない）' : '要確認'}</dd>
        </div>
      </dl>

      <section className="pre-opening-reset-section" aria-label="リセット概要">
        <h4>リセット概要</h4>
        <table className="admin-master-table pre-opening-reset-count-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>リセット後</th>
              <th>処理</th>
              <th>削除予定件数</th>
            </tr>
          </thead>
          <tbody>
            {SUMMARY_ROWS.map((row) => (
              <tr key={row.item}>
                <td>{row.item}</td>
                <td>{row.afterReset}</td>
                <td>{row.action}</td>
                <td>
                  {row.countKey
                    ? isLoading
                      ? '…'
                      : `${categories[row.countKey]}件`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pre-opening-reset-section" aria-label="削除予定件数の詳細">
        <h4>削除予定件数（詳細）</h4>
        <table className="admin-master-table pre-opening-reset-count-table">
          <thead>
            <tr>
              <th>削除対象</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.map(([label, count]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{isLoading ? '…' : count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="pre-opening-reset-confirm-block">
        <label className="pre-opening-reset-input-label" htmlFor="pre-opening-full-reset-confirm">
          確認文字列（店舗IDを完全入力）
        </label>
        <input
          id="pre-opening-full-reset-confirm"
          className="pre-opening-reset-input"
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={storeId || '店舗ID'}
          autoComplete="off"
          disabled={isExecuting || !capability?.supported}
        />
      </div>

      <div className="pre-opening-reset-actions">
        <button
          className="admin-save-button"
          type="button"
          onClick={() => void handleExecute()}
          disabled={!canExecute}
        >
          {isExecuting ? '初期化実行中…' : '開業前データリセットを実行'}
        </button>
      </div>

      {!previewLoaded ? (
        <p className="empty-note">実行ボタンを有効にする前に、件数プレビューの取得が必要です。</p>
      ) : null}
      {message ? <p className="save-note">{message}</p> : null}
    </section>
  )
}
