import { useMemo, useState } from 'react'
import type { FilingCheckFilter, FilingCheckSummary } from '../../types/accountingFilingCheck'
import { FILING_CHECK_STATUS_LABELS, FILING_EXPORT_CAUTION } from '../../types/accountingFilingCheck'
import {
  filterFilingChecks,
  formatFilingCheckStatus,
  formatYen,
} from '../../utils/accountingFilingCheck'

const FILING_CHECK_PDF_CSV_DISCLAIMER =
  'この画面は最新の申告前チェックです。既存PDF・CSV内の入力状況チェックとは確認項目が一部異なります。'

type FilingCheckPanelProps = {
  summary: FilingCheckSummary
  onAction?: (actionTarget: string) => void
  compact?: boolean
  /** When true (or when blockingCount>0 and omitted as auto), show export caution banner */
  showExportCaution?: boolean
}

const FILTER_OPTIONS: Array<{ id: FilingCheckFilter; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'blocking', label: '要修正' },
  { id: 'warning', label: '要確認' },
  { id: 'planned', label: '対応予定' },
  { id: 'actionable', label: '要対応のみ' },
]

const ACTION_LABELS: Record<string, string> = {
  'settlement-auxiliary': '決算補助を確認',
  expenses: '経費一覧を確認',
  'unorganized-receipts': '未整理領収書を確認',
  'fixed-assets': '固定資産を確認',
  etax: 'e-Tax資料を確認',
  'tax-advisor': '税理士資料を確認',
}

export function FilingExportCautionBanner({ visible }: { visible: boolean }) {
  if (!visible) {
    return null
  }
  return (
    <p className="accounting-note accounting-filing-export-caution" role="status">
      {FILING_EXPORT_CAUTION}
    </p>
  )
}

export function FilingCheckPanel({
  summary,
  onAction,
  compact = false,
  showExportCaution,
}: FilingCheckPanelProps) {
  const [filter, setFilter] = useState<FilingCheckFilter>(compact ? 'actionable' : 'all')
  const [hideComplete, setHideComplete] = useState(true)
  const [collapsePlanned, setCollapsePlanned] = useState(true)

  const cautionVisible = showExportCaution ?? summary.blockingCount > 0

  const visibleItems = useMemo(() => {
    let items = filterFilingChecks(summary.items, filter)
    if (hideComplete) {
      items = items.filter((item) => item.status !== 'complete' && item.status !== 'notApplicable')
    }
    if (collapsePlanned && filter === 'all') {
      items = items.filter((item) => item.status !== 'planned')
    }
    return items
  }, [summary.items, filter, hideComplete, collapsePlanned])

  const plannedCountHidden =
    collapsePlanned && filter === 'all'
      ? summary.items.filter((item) => item.status === 'planned').length
      : 0

  return (
    <section
      className={`accounting-etax-status-card accounting-filing-check-panel${compact ? ' is-compact' : ''}`}
      aria-label="申告前チェック"
    >
      <div className="accounting-filing-check-header">
        <h3>申告前チェック</h3>
        {summary.isFilingReady ? (
          <span className="accounting-filing-ready-badge">申告準備完了</span>
        ) : null}
      </div>

      <p className="accounting-note">
        複式簿記の正式な貸借対照表完成を意味しません。確認用です。
      </p>

      <p className="accounting-note accounting-filing-check-disclaimer">
        {compact
          ? '既存PDF・CSV内の入力状況チェックとは確認項目が一部異なります。'
          : FILING_CHECK_PDF_CSV_DISCLAIMER}
      </p>

      <FilingExportCautionBanner visible={cautionVisible} />

      <dl className="accounting-etax-status-counts accounting-filing-check-counts">
        <div className="is-blocking">
          <dt>要修正</dt>
          <dd>{summary.blockingCount} 件</dd>
        </div>
        <div className="is-warning">
          <dt>要確認</dt>
          <dd>{summary.warningCount} 件</dd>
        </div>
        <div className="is-planned">
          <dt>対応予定</dt>
          <dd>{summary.plannedCount} 件</dd>
        </div>
        <div className="is-complete">
          <dt>確認済み</dt>
          <dd>{summary.completeCount} 件</dd>
        </div>
        <div className="is-na">
          <dt>該当なし</dt>
          <dd>{summary.notApplicableCount} 件</dd>
        </div>
      </dl>

      {!compact ? (
        <div className="accounting-filing-check-toolbar">
          <div className="accounting-filing-check-filters" role="group" aria-label="チェックフィルター">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`secondary-action${filter === option.id ? ' is-active' : ''}`}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="accounting-filing-check-toggles">
            <label>
              <input
                type="checkbox"
                checked={hideComplete}
                onChange={(event) => setHideComplete(event.target.checked)}
              />
              確認済み・該当なしを非表示
            </label>
            <label>
              <input
                type="checkbox"
                checked={collapsePlanned}
                onChange={(event) => setCollapsePlanned(event.target.checked)}
              />
              対応予定を折りたたむ
            </label>
          </div>
        </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <p className="save-note">表示するチェック項目はありません。</p>
      ) : (
        <ul className="accounting-etax-missing-list accounting-filing-check-list">
          {visibleItems.map((item) => (
            <li key={item.id} className={`is-${item.status}`}>
              <span className="accounting-etax-missing-category">{item.category}</span>
              <strong>{item.label}</strong>
              <span>{formatFilingCheckStatus(item.status)}</span>
              <span className="accounting-etax-check-detail">
                {item.summary}
                {item.detail ? ` — ${item.detail}` : ''}
                {item.expectedAmountYen != null || item.actualAmountYen != null ? (
                  <>
                    {item.expectedAmountYen != null
                      ? ` / 残高 ${formatYen(item.expectedAmountYen)}`
                      : ''}
                    {item.actualAmountYen != null
                      ? ` / 内訳 ${formatYen(item.actualAmountYen)}`
                      : ''}
                    {item.differenceYen != null && item.differenceYen !== 0
                      ? ` / 差額 ${formatYen(Math.abs(item.differenceYen))}`
                      : ''}
                  </>
                ) : null}
              </span>
              {item.actionTarget && onAction ? (
                <button
                  type="button"
                  className="secondary-action accounting-filing-check-action"
                  onClick={() => onAction(item.actionTarget!)}
                >
                  {ACTION_LABELS[item.actionTarget] ?? '確認する'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {plannedCountHidden > 0 ? (
        <p className="accounting-note">
          対応予定 {plannedCountHidden} 件を折りたたんでいます（フィルター「対応予定」で表示）。
        </p>
      ) : null}

      {compact && summary.blockingCount > 0 ? (
        <p className="accounting-note">
          要修正 {summary.blockingCount} 件あります。申告前チェックメニューで詳細を確認してください。
        </p>
      ) : null}

      <p className="accounting-note accounting-filing-status-legend" hidden>
        {Object.entries(FILING_CHECK_STATUS_LABELS)
          .map(([key, label]) => `${key}:${label}`)
          .join(' / ')}
      </p>
    </section>
  )
}
