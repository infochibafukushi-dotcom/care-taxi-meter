import { useEffect, useMemo, useState } from 'react'
import type { StoredCaseRecord } from '../../services/caseRecords'
import { fetchCompanyById } from '../../services/companies'
import { subscribeMeterSettings, type MeterSettings } from '../../services/meterSettings'
import { formatFareYen } from '../../services/fare'
import type {
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../../types/accounting'
import type { StoredAccountingFixedAsset } from '../../types/accountingFixedAssets'
import type { ETaxCheckItem, ETaxExportableSectionId, ETaxSectionId } from '../../types/accountingETax'
import type { StoredAccountingSettlementAuxiliary } from '../../types/accountingSettlementAuxiliary'
import type { Company } from '../../types/work'
import { formatPlAmount } from '../../utils/accountingCsv'
import {
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../../types/accounting'
import { buildDefaultSettlementAuxiliary, mergeSettlementAuxiliary } from '../../utils/accountingSettlementAuxiliaryForm'
import { buildETaxPackage, formatETaxCheckItemStatus } from '../../utils/accountingETaxData'
import {
  exportETaxBulkCsv,
  exportETaxBulkPdf,
  exportETaxCoverPdf,
  exportETaxSectionCsv,
  exportETaxSectionPdf,
} from '../../utils/accountingETaxExport'
import { SettlementAuxiliaryDataPanel } from './SettlementAuxiliaryDataPanel'

type ETaxSettlementPanelProps = {
  franchiseeId: string
  storeId: string
  targetYear: number
  targetYearMonth: string
  staffId: string
  staffName: string
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  settlementAuxiliary: StoredAccountingSettlementAuxiliary | null
  onReloadAuxiliary: () => Promise<void>
  onExportRecorded: (fileName: string) => void
  onStatus: (message: string) => void
  onError: (message: string) => void
}

const MENU_ITEMS: Array<{ id: ETaxSectionId; label: string; description: string }> = [
  { id: 'auxiliary-input', label: '決算補助データ入力', description: '手入力が必要な最小項目を登録' },
  { id: 'input-status', label: '入力状況チェック', description: '入力済み/未入力の確認' },
  { id: 'missing-items', label: '不足項目一覧', description: '転記前の確認リスト' },
  { id: 'auxiliary-data', label: '決算補助データ', description: '保存済み補助データの確認・出力' },
  { id: 'bs-input', label: 'BS入力用', description: 'e-Tax転記用BS' },
  { id: 'account-breakdown-detail', label: '勘定科目内訳明細書用資料', description: '内訳明細（CSV化優先）' },
  { id: 'summary', label: '① 決算サマリー', description: 'e-Tax転記用の年度概要' },
  { id: 'pl', label: '② 損益計算書（PL）', description: '会計年度ベースのPL' },
  { id: 'bs', label: '③ 貸借対照表（BS）', description: '決算補助データを反映' },
  { id: 'fixed-assets', label: '④ 固定資産・減価償却明細', description: '固定資産台帳から自動作成' },
  { id: 'small-assets', label: '⑤ 少額資産明細', description: '少額資産の一覧' },
  { id: 'account-breakdown', label: '⑥ 勘定科目内訳明細', description: '科目別サマリー' },
  { id: 'business-overview', label: '⑦ 法人事業概況説明書用資料', description: '入力補助資料' },
  { id: 'consumption-tax', label: '⑧ 消費税集計', description: '課税区分・税率別集計' },
  { id: 'pdf-bulk', label: '⑨ PDF一括出力', description: '全資料をPDFで出力' },
  { id: 'csv-bulk', label: '⑩ CSV一括出力', description: '全資料をCSVで出力' },
]

const NON_EXPORT_SECTIONS = new Set<ETaxSectionId>([
  'auxiliary-input',
  'input-status',
  'missing-items',
  'pdf-bulk',
  'csv-bulk',
])

function InputStatusSummary({ inputStatus }: { inputStatus: ReturnType<typeof buildETaxPackage>['inputStatus'] }) {
  return (
    <dl className="accounting-etax-status-counts">
      <div className="is-required">
        <dt>要入力</dt>
        <dd>{inputStatus.requiredCount} 件</dd>
      </div>
      <div className="is-na">
        <dt>該当なし</dt>
        <dd>{inputStatus.naCount} 件</dd>
      </div>
      <div className="is-review">
        <dt>要確認</dt>
        <dd>{inputStatus.reviewCount} 件</dd>
      </div>
      <div className="is-planned">
        <dt>今後対応予定</dt>
        <dd>{inputStatus.plannedCount} 件</dd>
      </div>
    </dl>
  )
}

function CheckItemList({ items }: { items: ETaxCheckItem[] }) {
  if (items.length === 0) {
    return <p className="save-note">不足項目はありません。</p>
  }

  return (
    <ul className="accounting-etax-missing-list">
      {items.map((item) => (
        <li key={item.mappingId} className={`is-${item.status}`}>
          <span className="accounting-etax-missing-category">{item.category}</span>
          <strong>{item.label}</strong>
          <span>{formatETaxCheckItemStatus(item.status)}</span>
          {item.detail ? <span className="accounting-etax-check-detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  )
}

function ReportLineList({ lines }: { lines: Array<{ mappingId: string; label: string; displayValue: string; status: string }> }) {
  return (
    <dl className="accounting-etax-lines">
      {lines.map((line) => (
        <div key={line.mappingId} className={`accounting-etax-line is-${line.status}`}>
          <dt>{line.label}</dt>
          <dd>{line.displayValue}</dd>
        </div>
      ))}
    </dl>
  )
}

function PlSectionView({ profitLoss }: { profitLoss: ReturnType<typeof buildETaxPackage>['pl'] }) {
  const renderCategories = (
    title: string,
    categories: readonly string[],
    amounts: Record<string, number>,
    totalLabel: string,
    total: number,
  ) => (
    <section>
      <h4>{title}</h4>
      <ul className="accounting-pl-list">
        {categories
          .filter((category) => amounts[category] > 0)
          .map((category) => (
            <li key={category}>
              <span>{category}</span>
              <strong>{formatPlAmount(amounts[category])}</strong>
            </li>
          ))}
        {categories.every((category) => amounts[category] <= 0) ? (
          <li>
            <span>該当なし</span>
            <strong>{formatPlAmount(0)}</strong>
          </li>
        ) : null}
        <li className="accounting-pl-total">
          <span>{totalLabel}</span>
          <strong>{formatPlAmount(total)}</strong>
        </li>
      </ul>
    </section>
  )

  return (
    <div className="accounting-pl-grid">
      {renderCategories('売上', SALES_CATEGORIES, profitLoss.sales, '売上高', profitLoss.salesTotalYen)}
      {renderCategories('売上原価', COST_OF_SALES_CATEGORIES, profitLoss.costOfSales, '売上原価合計', profitLoss.costOfSalesTotalYen)}
      <section className="accounting-pl-profit accounting-pl-gross">
        <h4>売上総利益</h4>
        <p>
          <span>売上総利益</span>
          <strong>{formatPlAmount(profitLoss.grossProfitYen)}</strong>
        </p>
      </section>
      {renderCategories('販売管理費（固定費）', FIXED_EXPENSE_CATEGORIES, profitLoss.fixedCosts, '固定費小計', profitLoss.fixedCostsTotalYen)}
      {renderCategories('販売管理費（変動費）', VARIABLE_EXPENSE_CATEGORIES, profitLoss.variableExpenses, '変動費小計', profitLoss.variableExpensesTotalYen)}
      <section className="accounting-pl-profit">
        <h4>営業利益</h4>
        <p>
          <span>営業利益</span>
          <strong>{formatPlAmount(profitLoss.operatingProfitYen)}</strong>
        </p>
      </section>
    </div>
  )
}

export function ETaxSettlementPanel({
  franchiseeId,
  storeId,
  targetYear,
  targetYearMonth,
  staffId,
  staffName,
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  settlementAuxiliary,
  onReloadAuxiliary,
  onExportRecorded,
  onStatus,
  onError,
}: ETaxSettlementPanelProps) {
  const [activeSection, setActiveSection] = useState<ETaxSectionId | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [meterSettings, setMeterSettings] = useState<MeterSettings | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchCompanyById(franchiseeId).then((row) => {
      if (!cancelled) {
        setCompany(row)
      }
    })
    return () => {
      cancelled = true
    }
  }, [franchiseeId])

  useEffect(() => {
    const unsubscribe = subscribeMeterSettings(
      { franchiseeId, storeId },
      (settings: MeterSettings) => {
        setMeterSettings(settings)
      },
    )
    return unsubscribe
  }, [franchiseeId, storeId])

  const auxiliary = useMemo(
    () =>
      mergeSettlementAuxiliary(
        settlementAuxiliary,
        buildDefaultSettlementAuxiliary({
          franchiseeId,
          storeId,
          targetYear,
          company,
          meterSettings,
          staffId,
          staffName,
        }),
      ),
    [company, franchiseeId, meterSettings, settlementAuxiliary, staffId, staffName, storeId, targetYear],
  )

  const pkg = useMemo(
    () =>
      buildETaxPackage({
        targetYear,
        targetYearMonth,
        company,
        meterSettings,
        caseRecords,
        expenses,
        adjustments,
        fixedCosts,
        fixedAssets,
        auxiliary,
      }),
    [
      adjustments,
      auxiliary,
      caseRecords,
      company,
      expenses,
      fixedAssets,
      fixedCosts,
      meterSettings,
      targetYear,
      targetYearMonth,
    ],
  )

  const handleSectionExport = async (kind: 'pdf' | 'csv') => {
    if (!activeSection || NON_EXPORT_SECTIONS.has(activeSection)) {
      return
    }

    setIsExporting(true)
    try {
      const fileName =
        kind === 'pdf'
          ? await exportETaxSectionPdf(activeSection as ETaxExportableSectionId, pkg)
          : exportETaxSectionCsv(activeSection as ETaxExportableSectionId, pkg)
      if (fileName) {
        onExportRecorded(fileName)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '出力に失敗しました。')
    } finally {
      setIsExporting(false)
    }
  }

  const handleBulkExport = async (kind: 'pdf' | 'csv') => {
    setIsExporting(true)
    try {
      if (kind === 'pdf') {
        const cover = await exportETaxCoverPdf(pkg)
        onExportRecorded(cover)
        const files = await exportETaxBulkPdf(pkg)
        files.forEach(onExportRecorded)
      } else {
        const files = exportETaxBulkCsv(pkg)
        files.forEach(onExportRecorded)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '一括出力に失敗しました。')
    } finally {
      setIsExporting(false)
    }
  }

  const handleMenuClick = async (sectionId: ETaxSectionId) => {
    if (sectionId === 'pdf-bulk') {
      await handleBulkExport('pdf')
      return
    }
    if (sectionId === 'csv-bulk') {
      handleBulkExport('csv')
      return
    }
    setActiveSection(sectionId)
  }

  if (activeSection && !NON_EXPORT_SECTIONS.has(activeSection)) {
    const menu = MENU_ITEMS.find((item) => item.id === activeSection)

    return (
      <section className="accounting-panel accounting-etax-panel" aria-label="e-Tax入力用決算資料">
        <div className="accounting-etax-section-header">
          <button className="secondary-action" type="button" onClick={() => setActiveSection(null)}>
            ← メニューに戻る
          </button>
          <div className="accounting-etax-section-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={isExporting}
              onClick={() => void handleSectionExport('csv')}
            >
              CSV出力
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={isExporting}
              onClick={() => void handleSectionExport('pdf')}
            >
              PDF出力
            </button>
          </div>
        </div>

        <h2>{menu?.label ?? 'e-Tax入力用決算資料'}</h2>
        <p className="accounting-note">{menu?.description}</p>

        {activeSection === 'summary' ? (
          <>
            <ReportLineList lines={pkg.summary} />
            <p className="accounting-etax-footer-note">この内容はe-Taxへ転記するための資料です。</p>
          </>
        ) : null}

        {activeSection === 'pl' ? <PlSectionView profitLoss={pkg.pl} /> : null}
        {activeSection === 'bs' ? <ReportLineList lines={pkg.balanceSheet} /> : null}
        {activeSection === 'bs-input' ? <ReportLineList lines={pkg.bsInput} /> : null}
        {activeSection === 'auxiliary-data' ? <ReportLineList lines={pkg.auxiliaryDataLines} /> : null}

        {activeSection === 'account-breakdown-detail' ? (
          <div className="accounting-etax-breakdown-sections">
            {pkg.accountBreakdownDetail.map((section) => (
              <section key={section.sectionId} className="accounting-etax-breakdown-section">
                <h4>{section.sectionLabel}</h4>
                <div className="accounting-table-wrap">
                  <table className="accounting-table">
                    <thead>
                      <tr>
                        {section.headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.length > 0 ? (
                        section.rows.map((row) => (
                          <tr key={row.mappingId}>
                            {row.values.map((value, index) => (
                              <td key={`${row.mappingId}-${index}`}>{value}</td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={section.headers.length}>
                            {section.emptyStatus === 'na' ? '該当なし' : '未設定'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {activeSection === 'fixed-assets' ? (
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>資産名</th>
                  <th>区分</th>
                  <th>取得日</th>
                  <th>取得価額</th>
                  <th>耐用年数</th>
                  <th>償却方法</th>
                  <th>月額償却</th>
                  <th>年間償却</th>
                  <th>累計償却</th>
                  <th>未償却残高</th>
                </tr>
              </thead>
              <tbody>
                {pkg.fixedAssets.length > 0 ? (
                  pkg.fixedAssets.map((row) => (
                    <tr key={row.mappingId}>
                      <td>{row.assetName}</td>
                      <td>{row.assetCategory}</td>
                      <td>{row.purchaseDate}</td>
                      <td>{formatFareYen(row.acquisitionCost)}円</td>
                      <td>{row.usefulLifeYears}年</td>
                      <td>{row.depreciationMethod}</td>
                      <td>{formatFareYen(row.monthlyDepreciationYen)}円</td>
                      <td>{formatFareYen(row.annualDepreciationYen)}円</td>
                      <td>{formatFareYen(row.cumulativeDepreciationYen)}円</td>
                      <td>{formatFareYen(row.remainingBookValue)}円</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>固定資産はありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeSection === 'small-assets' ? (
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>購入日</th>
                  <th>資産名</th>
                  <th>取得価額</th>
                  <th>処理方法</th>
                  <th>PL反映月</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                {pkg.smallAssets.length > 0 ? (
                  pkg.smallAssets.map((row) => (
                    <tr key={row.mappingId}>
                      <td>{row.purchaseDate}</td>
                      <td>{row.assetName}</td>
                      <td>{formatFareYen(row.acquisitionCost)}円</td>
                      <td>{row.treatment}</td>
                      <td>{row.plPostingYearMonth}</td>
                      <td>{row.notes || '―'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>少額資産はありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeSection === 'account-breakdown' ? <ReportLineList lines={pkg.accountBreakdown} /> : null}
        {activeSection === 'business-overview' ? <ReportLineList lines={pkg.businessOverview} /> : null}
        {activeSection === 'consumption-tax' ? <ReportLineList lines={pkg.consumptionTax} /> : null}
      </section>
    )
  }

  if (activeSection === 'auxiliary-input') {
    return (
      <section className="accounting-panel accounting-etax-panel" aria-label="決算補助データ入力">
        <div className="accounting-etax-section-header">
          <button className="secondary-action" type="button" onClick={() => setActiveSection(null)}>
            ← メニューに戻る
          </button>
        </div>
        <h2>決算補助データ入力</h2>
        <SettlementAuxiliaryDataPanel
          franchiseeId={franchiseeId}
          storeId={storeId}
          targetYear={targetYear}
          staffId={staffId}
          staffName={staffName}
          stored={settlementAuxiliary}
          onReload={onReloadAuxiliary}
          onStatus={onStatus}
          onError={onError}
        />
      </section>
    )
  }

  if (activeSection === 'input-status' || activeSection === 'missing-items') {
    return (
      <section className="accounting-panel accounting-etax-panel" aria-label="入力状況">
        <div className="accounting-etax-section-header">
          <button className="secondary-action" type="button" onClick={() => setActiveSection(null)}>
            ← メニューに戻る
          </button>
        </div>
        <h2>{activeSection === 'input-status' ? '入力状況チェック' : '不足項目一覧'}</h2>
        {activeSection === 'input-status' ? (
          <>
            <InputStatusSummary inputStatus={pkg.inputStatus} />
            <p className="accounting-note">全 {pkg.inputStatus.totalCount} 項目を確認しました。</p>
          </>
        ) : (
          <p className="accounting-note">エラーではなく、転記前の確認リストです（要入力・要確認のみ）。</p>
        )}
        <CheckItemList
          items={activeSection === 'input-status' ? pkg.checkItems : pkg.actionRequiredItems}
        />
      </section>
    )
  }

  return (
    <section className="accounting-panel accounting-etax-panel" aria-label="e-Tax入力用決算資料">
      <h2>e-Tax入力用決算資料</h2>
      <p className="accounting-note">
        法人税・地方税・消費税等のe-Tax/eLTAX申告時に、アプリ内データから転記用資料（PDF・CSV）を作成します。
        申告書の自動作成機能ではありません。CSV化しやすい設計を優先しています。
      </p>

      <section className="accounting-etax-header-card" aria-label="決算資料ヘッダー">
        <dl className="accounting-etax-header-grid">
          <div>
            <dt>対象年度</dt>
            <dd>{pkg.company.targetYear} 年</dd>
          </div>
          <div>
            <dt>会計年度</dt>
            <dd>{pkg.company.fiscalYearLabel}</dd>
          </div>
          <div>
            <dt>会社名</dt>
            <dd>{pkg.company.companyName}</dd>
          </div>
          <div>
            <dt>法人番号</dt>
            <dd>{pkg.company.corporateNumber}</dd>
          </div>
        </dl>
      </section>

      <section className="accounting-etax-status-card" aria-label="入力状況サマリー">
        <InputStatusSummary inputStatus={pkg.inputStatus} />
        {pkg.actionRequiredItems.length > 0 ? (
          <ul className="accounting-etax-missing-preview">
            {pkg.actionRequiredItems.slice(0, 4).map((item) => (
              <li key={item.mappingId} className={`is-${item.status}`}>
                {item.label}：{formatETaxCheckItemStatus(item.status)}
                {item.detail ? `（${item.detail}）` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="save-note">要入力・要確認の項目はありません。</p>
        )}
      </section>

      <p className="accounting-etax-role-note">
        監査資料は税理士・監査向け、e-Tax入力用決算資料はご自身の申告転記向けです。
      </p>

      <div className="accounting-etax-menu-grid">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`accounting-etax-menu-card${
              item.id === 'auxiliary-input' ? ' is-featured' : ''
            }${item.id === 'pdf-bulk' || item.id === 'csv-bulk' ? ' is-bulk' : ''}`}
            type="button"
            disabled={isExporting}
            onClick={() => void handleMenuClick(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
