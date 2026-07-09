import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countPreOpeningBusinessData,
  executePreOpeningBusinessDataReset,
  isPreOpeningResetConfirmationValid,
  loadReservationPreOpeningDeleteCapability,
  type PreOpeningDataCategoryCounts,
  type PreOpeningDataResetResult,
} from '../../services/preOpeningDataReset'
import type { ReservationApiDeleteCapability } from '../../services/reservationPreOpeningReset'
import type { TenantScope } from '../../services/tenancy'
import type { StaffRole } from '../../types/work'
import { canResetPreOpeningBusinessData } from '../../types/permissions'

type PreOpeningDataResetPanelProps = {
  currentRole: StaffRole | ''
  executedBy: string
  executedByName: string
  scope: TenantScope
}

type ResetPhase = 'idle' | 'confirming' | 'executing'

const formatCount = (value: number) => `${value.toLocaleString('ja-JP')}件`

const initialCounts: PreOpeningDataCategoryCounts = {
  browserTemporaryData: 0,
  reservationApiRecords: 0,
  tripsAndSales: 0,
  accounting: 0,
  storageFiles: 0,
}

const defaultReservationCapability: ReservationApiDeleteCapability = {
  supported: false,
  reason:
    '予約API（reservation-v4）に開業前リセット用の削除APIが未実装です。予約本体は削除されません。',
}

export function PreOpeningDataResetPanel({
  currentRole,
  executedBy,
  executedByName,
  scope,
}: PreOpeningDataResetPanelProps) {
  const canExecute = canResetPreOpeningBusinessData(currentRole)
  const [phase, setPhase] = useState<ResetPhase>('idle')
  const [counts, setCounts] = useState<PreOpeningDataCategoryCounts>(initialCounts)
  const [reservationCapability, setReservationCapability] =
    useState<ReservationApiDeleteCapability>(defaultReservationCapability)
  const [isCountLoading, setIsCountLoading] = useState(true)
  const [countErrorMessage, setCountErrorMessage] = useState('')
  const [resetInput, setResetInput] = useState('')
  const [result, setResult] = useState<PreOpeningDataResetResult | null>(null)
  const [executionErrorMessage, setExecutionErrorMessage] = useState('')
  const [executionLog, setExecutionLog] = useState<string[]>([])

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    setExecutionLog((current) => [...current, `${timestamp} ${message}`])
  }, [])

  const loadCounts = useCallback(async () => {
    setIsCountLoading(true)
    setCountErrorMessage('')
    try {
      const [nextCounts, capability] = await Promise.all([
        countPreOpeningBusinessData(scope),
        loadReservationPreOpeningDeleteCapability(),
      ])
      setCounts(nextCounts)
      setReservationCapability(capability)
    } catch (error) {
      setCountErrorMessage(
        error instanceof Error ? error.message : '削除対象件数の取得に失敗しました。',
      )
    } finally {
      setIsCountLoading(false)
    }
  }, [scope])

  useEffect(() => {
    if (!canExecute) {
      setIsCountLoading(false)
      return
    }
    void loadCounts()
  }, [canExecute, loadCounts])

  const totalCount = useMemo(
    () =>
      counts.browserTemporaryData +
      (reservationCapability.supported ? counts.reservationApiRecords : 0) +
      counts.tripsAndSales +
      counts.accounting +
      counts.storageFiles,
    [counts, reservationCapability.supported],
  )

  const descriptionText = reservationCapability.supported
    ? '予約・運行・売上・経理の過去データを削除します。加盟店設定、店舗設定、スタッフ、車両、メーター設定、運賃設定は残ります。'
    : '運行・売上・経理データと、端末内の予約連携一時データを削除します。予約API上の予約本体は削除されません。'

  const firstConfirmText = reservationCapability.supported
    ? '予約・運行・売上・経理データを削除します。\n加盟店設定、店舗設定、スタッフ、車両、メーター設定、運賃設定は残ります。'
    : '運行・売上・経理データと、端末内の予約連携一時データを削除します。\n予約API上の予約本体は削除されません。\n加盟店設定、店舗設定、スタッフ、車両、メーター設定、運賃設定は残ります。'

  const handleStartConfirmation = () => {
    const confirmed = window.confirm(firstConfirmText)
    if (!confirmed) {
      appendLog('1段階目の確認をキャンセルしました。')
      return
    }

    setExecutionErrorMessage('')
    setResult(null)
    setResetInput('')
    setPhase('confirming')
    appendLog('1段階目の確認を承認しました。')
  }

  const handleExecuteReset = async () => {
    if (!isPreOpeningResetConfirmationValid(resetInput)) {
      setExecutionErrorMessage('実行するには RESET と入力してください。')
      return
    }

    const confirmed = window.confirm(
      'この操作は元に戻せません。開業前データをリセットしてよろしいですか？',
    )
    if (!confirmed) {
      appendLog('最終確認をキャンセルしました。')
      return
    }

    setPhase('executing')
    setExecutionErrorMessage('')
    appendLog('リセット処理を開始しました。')

    try {
      const resetResult = await executePreOpeningBusinessDataReset({
        franchiseeId: scope.franchiseeId,
        storeId: scope.storeId,
        executedBy,
        executedByName,
        confirmText: resetInput.trim(),
      })
      setResult(resetResult)
      setCounts(initialCounts)
      setPhase('idle')
      setResetInput('')
      appendLog(
        `リセット完了。成功: 端末一時${resetResult.deletedCounts.browserTemporaryData}件 / 予約API${resetResult.deletedCounts.reservationApiRecords}件 / 運行・売上${resetResult.deletedCounts.tripsAndSales}件 / 経理${resetResult.deletedCounts.accounting}件 / Storage${resetResult.deletedCounts.storageFiles}件`,
      )
      if (resetResult.reservationApiDeleteSkipped) {
        appendLog(resetResult.reservationApiDeleteMessage)
      }
      if (resetResult.failedItems.length > 0) {
        appendLog(`失敗 ${resetResult.failedItems.length} 件`)
        for (const failedItem of resetResult.failedItems) {
          appendLog(`失敗: ${failedItem.collection}/${failedItem.documentId} - ${failedItem.message}`)
        }
      }
      await loadCounts()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '開業前データリセットに失敗しました。'
      setExecutionErrorMessage(message)
      setPhase('confirming')
      appendLog(`エラー: ${message}`)
    }
  }

  if (!canExecute) {
    return (
      <section className="admin-system-panel">
        <div className="reservation-meter-reset-panel">
          <h3>開業前データリセット</h3>
          <p className="reservation-meter-reset-note">
            この機能はオーナーまたは本部管理者のみ利用できます。
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="admin-system-panel">
      <div className="reservation-meter-reset-panel pre-opening-reset-panel">
        <h3>開業前データリセット</h3>
        <p className="reservation-meter-reset-note">{descriptionText}</p>
        {!reservationCapability.supported ? (
          <p className="pre-opening-reset-api-note" role="note">
            {reservationCapability.reason}
          </p>
        ) : null}

        <section className="pre-opening-reset-section">
          <h4>削除対象件数</h4>
          {isCountLoading ? <p>件数を集計しています…</p> : null}
          {countErrorMessage ? (
            <p className="case-error" role="alert">
              {countErrorMessage}
            </p>
          ) : null}
          {!isCountLoading && !countErrorMessage ? (
            <table className="pre-opening-reset-count-table">
              <thead>
                <tr>
                  <th scope="col">区分</th>
                  <th scope="col">件数</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>端末内予約連携一時データ</td>
                  <td>{formatCount(counts.browserTemporaryData)}</td>
                </tr>
                <tr>
                  <td>
                    予約API上の予約本体
                    {reservationCapability.supported ? '' : '（削除対象外）'}
                  </td>
                  <td>{formatCount(counts.reservationApiRecords)}</td>
                </tr>
                <tr>
                  <td>運行・売上情報</td>
                  <td>{formatCount(counts.tripsAndSales)}</td>
                </tr>
                <tr>
                  <td>経理情報</td>
                  <td>{formatCount(counts.accounting)}</td>
                </tr>
                <tr>
                  <td>Storage業務ファイル</td>
                  <td>{formatCount(counts.storageFiles)}</td>
                </tr>
                <tr>
                  <th scope="row">合計（削除実行対象）</th>
                  <td>{formatCount(totalCount)}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
          <button className="secondary-action" type="button" onClick={() => void loadCounts()}>
            件数を再集計する
          </button>
        </section>

        <section className="pre-opening-reset-section">
          <h4>削除されるデータ</h4>
          <ul className="pre-opening-reset-list">
            {reservationCapability.supported ? (
              <li>予約API上の予約本体（通常予約・事前確定運賃・テスト予約・キャンセル済み・未完了を含む）</li>
            ) : null}
            <li>端末内の予約連携一時データ（事前確定運賃・予約コンテキスト・運行中スナップショット）</li>
            <li>案件記録・勤務セッション・GPS走行ログ・売上集計元データ</li>
            <li>経費・領収書OCR・仕訳調整・出力履歴・決算補助データ</li>
            <li>経理添付画像（Storage）</li>
          </ul>
        </section>

        <section className="pre-opening-reset-section">
          <h4>残るデータ</h4>
          <ul className="pre-opening-reset-list pre-opening-reset-list--preserved">
            {!reservationCapability.supported ? (
              <li>予約API（reservation-v4 / D1）上の予約本体</li>
            ) : null}
            <li>加盟店・店舗・スタッフ・車両のマスターデータ</li>
            <li>メーター設定・運賃設定・プリンター/OBD設定</li>
            <li>勘定科目マスタ（固定費マスタ）・税率設定</li>
            <li>会社ロゴ・店舗ロゴなどの設定アセット</li>
          </ul>
        </section>

        <p className="pre-opening-reset-scope-note">
          対象スコープ: 加盟店 {scope.franchiseeId} / 店舗 {scope.storeId}
        </p>

        {phase === 'idle' ? (
          <button
            className="case-detail-danger-button"
            type="button"
            disabled={isCountLoading}
            onClick={handleStartConfirmation}
          >
            開業前データをリセットする
          </button>
        ) : null}

        {phase === 'confirming' || phase === 'executing' ? (
          <div className="pre-opening-reset-confirm-block">
            <p className="reservation-meter-reset-note" role="alert">
              この操作は元に戻せません。実行するには RESET と入力してください。
            </p>
            <label className="pre-opening-reset-input-label" htmlFor="pre-opening-reset-input">
              確認入力
            </label>
            <input
              id="pre-opening-reset-input"
              className="pre-opening-reset-input"
              type="text"
              value={resetInput}
              autoComplete="off"
              spellCheck={false}
              disabled={phase === 'executing'}
              onChange={(event) => setResetInput(event.target.value)}
              placeholder="RESET"
            />
            <div className="pre-opening-reset-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={phase === 'executing'}
                onClick={() => {
                  setPhase('idle')
                  setResetInput('')
                  setExecutionErrorMessage('')
                }}
              >
                キャンセル
              </button>
              <button
                className="case-detail-danger-button"
                type="button"
                disabled={phase === 'executing' || !isPreOpeningResetConfirmationValid(resetInput)}
                onClick={() => void handleExecuteReset()}
              >
                {phase === 'executing' ? 'リセット処理中…' : '開業前データをリセットする'}
              </button>
            </div>
          </div>
        ) : null}

        {executionErrorMessage ? (
          <p className="case-error" role="alert">
            {executionErrorMessage}
          </p>
        ) : null}

        {result ? (
          <section className="pre-opening-reset-section">
            <h4>実行結果</h4>
            <p>
              削除完了: 端末一時 {formatCount(result.deletedCounts.browserTemporaryData)} / 予約API{' '}
              {formatCount(result.deletedCounts.reservationApiRecords)} / 運行・売上{' '}
              {formatCount(result.deletedCounts.tripsAndSales)} / 経理{' '}
              {formatCount(result.deletedCounts.accounting)} / Storage{' '}
              {formatCount(result.deletedCounts.storageFiles)}
            </p>
            {result.reservationApiDeleteSkipped ? (
              <p className="pre-opening-reset-api-note" role="note">
                {result.reservationApiDeleteMessage}
              </p>
            ) : null}
            {result.failedItems.length > 0 ? (
              <p className="case-error" role="alert">
                失敗 {result.failedItems.length} 件。詳細は実行ログを確認してください。
              </p>
            ) : (
              <p>マスターデータは保持されています。</p>
            )}
          </section>
        ) : null}

        {executionLog.length > 0 ? (
          <section className="pre-opening-reset-section">
            <h4>実行ログ</h4>
            <pre className="pre-opening-reset-log">{executionLog.join('\n')}</pre>
          </section>
        ) : null}
      </div>
    </section>
  )
}
