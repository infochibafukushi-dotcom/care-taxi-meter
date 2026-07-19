import { useCallback, useEffect, useState } from 'react'
import {
  fetchAccountingInvoiceLookupHistory,
  type StoredAccountingInvoiceLookupHistory,
} from '../../services/accountingInvoiceLookupHistory'
import type { TenantAccessScope } from '../../services/tenancy'
import { isDriverTenantRole, normalizeTenantRole } from '../../services/tenancy'
import { ROLE_LABELS } from '../../types/permissions'
import type { StaffRole } from '../../types/work'

type InvoiceLookupHistoryPanelProps = {
  accessScope: TenantAccessScope
}

const OUTCOME_LABELS: Record<string, string> = {
  success: '成功',
  not_found: '登録なし',
  error: 'エラー',
  skipped: 'スキップ',
}

const ORIGIN_LABELS: Record<string, string> = {
  manual: '手動',
  ocr: 'OCR',
}

const formatDateTime = (value?: string) => {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('ja-JP', { hour12: false })
}

const formatRole = (role: StaffRole | '') => {
  const normalized = normalizeTenantRole(role)
  if (!normalized) {
    return '—'
  }
  return ROLE_LABELS[normalized] ?? normalized
}

const formatApiCalled = (row: StoredAccountingInvoiceLookupHistory) => {
  const after = row.afterData
  if (!after) {
    return '—'
  }
  if (after.lookupSource === 'cache') {
    return 'キャッシュ'
  }
  if (after.apiCalled) {
    return 'API'
  }
  return 'なし'
}

const formatDuration = (ms?: number) => {
  if (ms == null || Number.isNaN(ms)) {
    return '—'
  }
  return `${ms} ms`
}

export function InvoiceLookupHistoryPanel({ accessScope }: InvoiceLookupHistoryPanelProps) {
  const [rows, setRows] = useState<StoredAccountingInvoiceLookupHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    // 経理画面自体が driver 非対応だが、履歴取得も明示的に拒否する
    if (isDriverTenantRole(accessScope.role)) {
      setRows([])
      setError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const next = await fetchAccountingInvoiceLookupHistory(accessScope, 100)
      setRows(next)
    } catch (loadError) {
      setRows([])
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'インボイス検索履歴の取得に失敗しました。',
      )
    } finally {
      setLoading(false)
    }
  }, [accessScope])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <section className="accounting-panel accounting-invoice-lookup-history" aria-label="インボイス検索履歴">
      <div className="accounting-invoice-lookup-history-header">
        <div>
          <h3>インボイス検索履歴</h3>
          <p className="accounting-note">
            国税庁インボイスWeb-APIに関連する検索操作を、利用者・日時・検索結果ごとに記録しています。
          </p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void reload()} disabled={loading}>
          再読込
        </button>
      </div>

      {loading ? <p className="save-note">検索履歴を読み込み中…</p> : null}
      {error ? (
        <p className="accounting-warning" role="status">
          {error}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="save-note">検索履歴はありません</p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="accounting-table-wrap accounting-invoice-lookup-history-table-wrap">
            <table className="accounting-table accounting-invoice-lookup-history-table">
              <thead>
                <tr>
                  <th scope="col">照会日時</th>
                  <th scope="col">利用者名</th>
                  <th scope="col">権限</th>
                  <th scope="col">検索経路</th>
                  <th scope="col">適格請求書番号</th>
                  <th scope="col">API呼出</th>
                  <th scope="col">検索結果</th>
                  <th scope="col">登録事業者名</th>
                  <th scope="col">登録状況</th>
                  <th scope="col">取得方法</th>
                  <th scope="col">処理時間</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const after = row.afterData
                  return (
                    <tr key={row.id}>
                      <td>{formatDateTime(after?.completedAt || row.createdAt)}</td>
                      <td>{row.actorUserName || '—'}</td>
                      <td>{formatRole(row.actorRole)}</td>
                      <td>{ORIGIN_LABELS[after?.origin ?? ''] ?? '—'}</td>
                      <td>{after?.invoiceNumber || row.targetId || '—'}</td>
                      <td>{formatApiCalled(row)}</td>
                      <td>{OUTCOME_LABELS[after?.outcome ?? ''] ?? '—'}</td>
                      <td>{after?.registeredName || '—'}</td>
                      <td>{after?.registrationStatus || '—'}</td>
                      <td>{after?.lookupMethod || after?.lookupSource || '—'}</td>
                      <td>{formatDuration(after?.durationMs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="accounting-invoice-lookup-history-cards">
            {rows.map((row) => {
              const after = row.afterData
              return (
                <li key={`${row.id}-card`} className="accounting-invoice-lookup-history-card">
                  <p>
                    <strong>照会日時</strong>
                    <span>{formatDateTime(after?.completedAt || row.createdAt)}</span>
                  </p>
                  <p>
                    <strong>利用者</strong>
                    <span>
                      {row.actorUserName || '—'}（{formatRole(row.actorRole)}）
                    </span>
                  </p>
                  <p>
                    <strong>検索経路</strong>
                    <span>{ORIGIN_LABELS[after?.origin ?? ''] ?? '—'}</span>
                  </p>
                  <p>
                    <strong>適格請求書番号</strong>
                    <span>{after?.invoiceNumber || row.targetId || '—'}</span>
                  </p>
                  <p>
                    <strong>API呼出</strong>
                    <span>{formatApiCalled(row)}</span>
                  </p>
                  <p>
                    <strong>検索結果</strong>
                    <span>{OUTCOME_LABELS[after?.outcome ?? ''] ?? '—'}</span>
                  </p>
                  <p>
                    <strong>登録事業者名</strong>
                    <span>{after?.registeredName || '—'}</span>
                  </p>
                  <p>
                    <strong>登録状況</strong>
                    <span>{after?.registrationStatus || '—'}</span>
                  </p>
                  <p>
                    <strong>取得方法</strong>
                    <span>{after?.lookupMethod || after?.lookupSource || '—'}</span>
                  </p>
                  <p>
                    <strong>処理時間</strong>
                    <span>{formatDuration(after?.durationMs)}</span>
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
