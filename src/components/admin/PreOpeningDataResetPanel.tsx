import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executePreOpeningDataReset,
  fetchPreOpeningResetCapability,
  preOpeningResetEmptyTargets,
  preOpeningResetEmptyPreserved,
  type PreOpeningResetCapabilityResult,
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
  caseCounters: '案件採番カウンタ',
  storageFiles: '運行側 Storage ファイル',
}

const DELETE_CATEGORY_LABELS = [
  '売上',
  '運行案件',
  '運行履歴',
  '精算',
  '運行側領収書',
  'GPS／ルート記録',
] as const

const PRESERVE_CATEGORY_LABELS = [
  '予約情報',
  '加盟店',
  '店舗',
  '従業員',
  '従業員勤怠',
  '車両',
  '料金設定',
  '経理データ',
  '経理領収書画像／PDF',
  '未整理領収書',
  '固定資産',
  '監査ログ',
  'ログイン情報',
  'Firebase Authentication',
] as const

const formatTargets = (targets: PreOpeningResetTargetCounts) => {
  const rows: Array<[string, number]> = []
  for (const [key, count] of Object.entries(targets.firestore)) {
    if (count > 0) {
      rows.push([TARGET_LABELS[key] ?? `Firestore ${key}`, count])
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
  const [preserved, setPreserved] = useState<PreOpeningResetPreservedPayload>(
    preOpeningResetEmptyPreserved(),
  )
  const [confirmText, setConfirmText] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  const description =
    '開業前のテスト運用で作成した売上・運行・精算情報を削除します。予約情報は削除しません（予約削除は管理LPから実行してください）。加盟店設定、店舗設定、スタッフ、勤怠、車両、メーター設定、運賃設定、監査ログ、経理データ・経理証憑は残ります。'

  const loadCapability = useCallback(async () => {
    if (!franchiseeId.trim() || !storeId.trim()) {
      setCapability(null)
      setPreserved(preOpeningResetEmptyPreserved())
      setMessage('加盟店IDと店舗IDを指定してください。')
      return
    }

    setIsLoading(true)
    setMessage('削除対象件数を取得しています…')
    try {
      const result = await fetchPreOpeningResetCapability(franchiseeId.trim(), storeId.trim())
      setCapability(result)
      setPreserved(result.preserved)
      setMessage('削除対象件数を取得しました。RESET と入力して実行してください。')
    } catch (error) {
      setCapability(null)
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
        '売上・運行・精算データを初期化します。予約データと経理データは削除されません。この操作は元に戻せません。続行しますか？',
      )
    ) {
      return
    }

    setIsExecuting(true)
    setMessage('売上・運行データを初期化しています…')
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
      setPreserved(result.preserved)
      setMessage(
        `初期化完了。案件 ${result.deleted.firestore.caseRecords ?? 0} 件を削除しました。予約データと経理データは保持しました。端末内の一時データもクリアしました。`,
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
          <p className="eyebrow">Meter Sales / Operations Reset</p>
          <h2 id="pre-opening-reset-title">開業前テストデータ初期化（売上・運行）</h2>
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
      <p className="case-error" role="alert">
        予約データは削除されません。予約削除は管理LPから実行してください
      </p>
      <p className="pre-opening-reset-scope-note">
        この操作では予約データは削除されません。予約削除は管理LPから実行してください。
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
          <dt>経理保護</dt>
          <dd>{preserved.accountingProtected ? '保護対象（削除しない）' : '要確認'}</dd>
        </div>
        <div>
          <dt>予約データ</dt>
          <dd>{preserved.reservationDataUntouched ? '対象外（削除しない）' : '要確認'}</dd>
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
                <td>{isLoading ? '…' : count}</td>
              </tr>
            ))}
            <tr>
              <td>経理データ</td>
              <td>保持</td>
            </tr>
            <tr>
              <td>予約データ</td>
              <td>保持</td>
            </tr>
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
          disabled={isLoading || isExecuting || !capability}
        >
          {isExecuting ? '初期化実行中…' : '売上・運行データを初期化'}
        </button>
      </div>

      {message ? <p className="save-note">{message}</p> : null}
    </section>
  )
}
