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
import type { TaxAdvisorSectionId } from '../../types/accountingTaxAdvisor'
import type { StoredAccountingSettlementAuxiliary } from '../../types/accountingSettlementAuxiliary'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import type { Company } from '../../types/work'
import { formatPlAmount } from '../../utils/accountingCsv'
import {
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../../types/accounting'
import { buildDefaultSettlementAuxiliary, mergeSettlementAuxiliary } from '../../utils/accountingSettlementAuxiliaryForm'
import { formatETaxCheckItemStatus } from '../../utils/accountingETaxData'
import { buildCalendarYearOptions } from '../../utils/accountingPl'
import {
  buildTaxAdvisorPackage,
  formatLedgerAssetStatus,
  getTaxAdvisorDataSources,
} from '../../utils/accountingTaxAdvisorData'
import { exportTaxAdvisorBulkCsv, exportTaxAdvisorPackagePdf } from '../../utils/accountingTaxAdvisorExport'

type TaxAdvisorPackagePanelProps = {
  franchiseeId: string
  storeId: string
  storeName: string
  initialTargetYear: number
  staffId: string
  staffName: string
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  settlementAuxiliary: StoredAccountingSettlementAuxiliary | null
  allReceipts: StoredAccountingReceipt[]
  unorganizedReceipts: StoredAccountingReceipt[]
  onExportRecorded: (fileName: string) => void
  onError: (message: string) => void
}

const MENU_ITEMS: Array<{ id: TaxAdvisorSectionId; label: string; description: string }> = [
  { id: 'pdf-bulk', label: '一式PDF出力', description: '表紙・目次付きの一式PDF' },
  { id: 'csv-bulk', label: '一式CSV出力', description: '資料ごとのCSVを連続ダウンロード' },
  { id: 'print-preview', label: '印刷用プレビュー', description: 'PDF出力前の画面上確認' },
  { id: 'summary', label: '決算サマリー', description: '会計年度の概要' },
  { id: 'pl', label: 'PL', description: '損益計算書（会計年度）' },
  { id: 'bs', label: 'BS', description: '貸借対照表' },
  { id: 'expenses', label: '経費一覧', description: '確認済み経費' },
  { id: 'receipts', label: '領収書一覧', description: '年度内の領収書' },
  { id: 'unorganized-receipts', label: '未整理領収書一覧', description: '未整理の領収書' },
  { id: 'fixed-costs', label: '固定費一覧', description: '固定費マスタ' },
  { id: 'fixed-assets', label: '固定資産台帳', description: '固定資産の台帳' },
  { id: 'depreciation', label: '減価償却明細', description: '月別減価償却' },
  { id: 'small-assets', label: '少額資産明細', description: '少額資産一覧' },
  { id: 'account-breakdown', label: '勘定科目内訳明細', description: '科目別サマリー' },
  { id: 'business-overview', label: '法人事業概況説明書用資料', description: '概況説明書入力補助' },
  { id: 'consumption-tax', label: '消費税集計', description: '課税区分・税率別' },
  { id: 'input-status', label: '入力状況チェック', description: '決算補助データの入力状況' },
  { id: 'review-list', label: '要確認リスト', description: '税理士確認事項' },
]

function DataSourceNote({ sectionId }: { sectionId: TaxAdvisorSectionId }) {
  const sources = getTaxAdvisorDataSources(sectionId)
  return (
    <p className="accounting-data-source-note">
      データ根拠: {sources.join(' / ')}
    </p>
  )
}

function ReportLineList({
  lines,
}: {
  lines: Array<{ mappingId: string; label: string; displayValue: string; status: string }>
}) {
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

function PlSectionView({ profitLoss }: { profitLoss: ReturnType<typeof buildTaxAdvisorPackage>['pl'] }) {
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

function PrintPreviewContent({ pkg }: { pkg: ReturnType<typeof buildTaxAdvisorPackage> }) {
  return (
    <div className="accounting-tax-advisor-print-preview">
      <section className="accounting-tax-advisor-cover">
        <h3>税理士相談用 一式資料</h3>
        <dl className="accounting-etax-header-grid">
          <div><dt>対象年度</dt><dd>{pkg.header.targetYear}年度</dd></div>
          <div><dt>会計年度</dt><dd>{pkg.header.fiscalYearLabel}</dd></div>
          <div><dt>会社名</dt><dd>{pkg.header.companyName}</dd></div>
          <div><dt>店舗名</dt><dd>{pkg.header.storeName}</dd></div>
          <div><dt>作成日</dt><dd>{pkg.header.createdDate}</dd></div>
        </dl>
      </section>

      <section>
        <h4>決算サマリー</h4>
        <DataSourceNote sectionId="summary" />
        <ReportLineList lines={pkg.etax.summary} />
      </section>

      <section>
        <h4>損益計算書（PL）</h4>
        <DataSourceNote sectionId="pl" />
        <PlSectionView profitLoss={pkg.pl} />
      </section>

      <section>
        <h4>貸借対照表（BS）</h4>
        <DataSourceNote sectionId="bs" />
        <ReportLineList lines={pkg.etax.balanceSheet} />
      </section>

      <section>
        <h4>経費一覧</h4>
        <DataSourceNote sectionId="expenses" />
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>取引先</th>
                <th>内容</th>
                <th>科目</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {pkg.fiscalYearExpenses.length > 0 ? (
                pkg.fiscalYearExpenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{getExpensePostingDate(expense)}</td>
                    <td>{expense.vendorName}</td>
                    <td>{expense.description}</td>
                    <td>{expense.expenseCategory}</td>
                    <td>{formatFareYen(expense.taxIncludedAmount)}円</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4>固定資産台帳</h4>
        <DataSourceNote sectionId="fixed-assets" />
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>購入日</th>
                <th>資産名</th>
                <th>区分</th>
                <th>取得価額</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {pkg.ledgerAssets.length > 0 ? (
                pkg.ledgerAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.purchaseDate}</td>
                    <td>{asset.assetName}</td>
                    <td>{asset.assetCategory}</td>
                    <td>{formatFareYen(asset.acquisitionCost)}円</td>
                    <td>{formatFareYen(asset.remainingBookValue)}円</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4>減価償却明細</h4>
        <DataSourceNote sectionId="depreciation" />
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>対象月</th>
                <th>資産名</th>
                <th>当月償却</th>
                <th>累計</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {pkg.depreciationRows.length > 0 ? (
                pkg.depreciationRows.map((row, index) => (
                  <tr key={`${row.targetYearMonth}-${row.assetName}-${index}`}>
                    <td>{row.targetYearMonth}</td>
                    <td>{row.assetName}</td>
                    <td>{formatFareYen(row.depreciationYen)}円</td>
                    <td>{formatFareYen(row.cumulativeDepreciationYen)}円</td>
                    <td>{formatFareYen(row.remainingBookValue)}円</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4>少額資産明細</h4>
        <DataSourceNote sectionId="small-assets" />
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>購入日</th>
                <th>資産名</th>
                <th>取得価額</th>
                <th>PL反映月</th>
              </tr>
            </thead>
            <tbody>
              {pkg.smallAssets.length > 0 ? (
                pkg.smallAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.purchaseDate}</td>
                    <td>{asset.assetName}</td>
                    <td>{formatFareYen(asset.acquisitionCost)}円</td>
                    <td>{asset.depreciationStartYearMonth}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4>勘定科目内訳明細</h4>
        <DataSourceNote sectionId="account-breakdown" />
        <ReportLineList lines={pkg.etax.accountBreakdown} />
      </section>

      <section>
        <h4>入力状況チェック</h4>
        <DataSourceNote sectionId="input-status" />
        <ul className="accounting-etax-missing-list">
          {pkg.etax.checkItems.map((item) => (
            <li key={item.mappingId} className={`is-${item.status}`}>
              <span className="accounting-etax-missing-category">{item.category}</span>
              <strong>{item.label}</strong>
              <span>{formatETaxCheckItemStatus(item.status)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>要確認リスト</h4>
        <DataSourceNote sectionId="review-list" />
        {pkg.reviewItems.length > 0 ? (
          <ul className="accounting-etax-missing-list">
            {pkg.reviewItems.map((item) => (
              <li key={item.id} className="is-review">
                <span className="accounting-etax-missing-category">{item.category}</span>
                <strong>{item.label}</strong>
                {item.detail ? <span className="accounting-etax-check-detail">{item.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="save-note">確認事項はありません。</p>
        )}
      </section>
    </div>
  )
}

function SectionDetail({
  sectionId,
  pkg,
  onBack,
}: {
  sectionId: TaxAdvisorSectionId
  pkg: ReturnType<typeof buildTaxAdvisorPackage>
  onBack: () => void
}) {
  const menu = MENU_ITEMS.find((item) => item.id === sectionId)

  return (
    <section className="accounting-panel accounting-etax-panel accounting-tax-advisor-panel" aria-label="税理士相談用資料詳細">
      <div className="accounting-etax-section-header">
        <button className="secondary-action" type="button" onClick={onBack}>
          ← メニューに戻る
        </button>
      </div>
      <h2>{menu?.label ?? '税理士相談用 一式資料'}</h2>
      <p className="accounting-note">{menu?.description}</p>
      <DataSourceNote sectionId={sectionId} />

      {sectionId === 'print-preview' ? <PrintPreviewContent pkg={pkg} /> : null}
      {sectionId === 'summary' ? <ReportLineList lines={pkg.etax.summary} /> : null}
      {sectionId === 'pl' ? <PlSectionView profitLoss={pkg.pl} /> : null}
      {sectionId === 'bs' ? <ReportLineList lines={pkg.etax.balanceSheet} /> : null}

      {sectionId === 'expenses' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>取引先</th>
                <th>内容</th>
                <th>科目</th>
                <th>金額</th>
                <th>領収書画像</th>
              </tr>
            </thead>
            <tbody>
              {pkg.fiscalYearExpenses.length > 0 ? (
                pkg.fiscalYearExpenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{getExpensePostingDate(expense)}</td>
                    <td>{expense.vendorName}</td>
                    <td>{expense.description}</td>
                    <td>{expense.expenseCategory}</td>
                    <td>{formatFareYen(expense.taxIncludedAmount)}円</td>
                    <td>{expense.receiptImageUrl ? '有' : '無'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'receipts' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>証憑日</th>
                <th>取引先候補</th>
                <th>金額候補</th>
                <th>経費登録済み</th>
                <th>画像</th>
              </tr>
            </thead>
            <tbody>
              {pkg.fiscalYearReceipts.length > 0 ? (
                pkg.fiscalYearReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{receipt.receiptDate ?? '未設定'}</td>
                    <td>{receipt.vendorNameCandidate ?? '未設定'}</td>
                    <td>{receipt.amountTotalCandidate != null ? `${formatFareYen(receipt.amountTotalCandidate)}円` : '未設定'}</td>
                    <td>{receipt.linkedExpenseId ? 'はい' : 'いいえ'}</td>
                    <td>{receipt.downloadUrl || receipt.imageUrl ? '有' : '無'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'unorganized-receipts' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>保存日</th>
                <th>証憑日</th>
                <th>取引先候補</th>
                <th>金額候補</th>
                <th>画像</th>
              </tr>
            </thead>
            <tbody>
              {pkg.unorganizedReceipts.length > 0 ? (
                pkg.unorganizedReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{receipt.createdAt ?? '未設定'}</td>
                    <td>{receipt.receiptDate ?? '未設定'}</td>
                    <td>{receipt.vendorNameCandidate ?? '未設定'}</td>
                    <td>{receipt.amountTotalCandidate != null ? `${formatFareYen(receipt.amountTotalCandidate)}円` : '未設定'}</td>
                    <td>{receipt.downloadUrl || receipt.imageUrl ? '有' : '無'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'fixed-costs' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>固定費名</th>
                <th>勘定科目</th>
                <th>月額</th>
                <th>年度合計</th>
                <th>開始月</th>
                <th>終了月</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {pkg.fixedCostRows.length > 0 ? (
                pkg.fixedCostRows.map((row) => (
                  <tr key={`${row.fixedCostName}-${row.startYearMonth}`}>
                    <td>{row.fixedCostName}</td>
                    <td>{row.expenseCategory}</td>
                    <td>{formatFareYen(row.monthlyAmountYen)}円</td>
                    <td>{formatFareYen(row.fiscalYearTotalYen)}円</td>
                    <td>{row.startYearMonth}</td>
                    <td>{row.endYearMonth}</td>
                    <td>{row.status}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'fixed-assets' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>購入日</th>
                <th>資産名</th>
                <th>区分</th>
                <th>取得価額</th>
                <th>耐用年数</th>
                <th>月額償却</th>
                <th>残高</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {pkg.ledgerAssets.length > 0 ? (
                pkg.ledgerAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.purchaseDate}</td>
                    <td>{asset.assetName}</td>
                    <td>{asset.assetCategory}</td>
                    <td>{formatFareYen(asset.acquisitionCost)}円</td>
                    <td>{asset.appliedUsefulLifeYears}年</td>
                    <td>{formatFareYen(asset.monthlyDepreciationYen)}円</td>
                    <td>{formatFareYen(asset.remainingBookValue)}円</td>
                    <td>{formatLedgerAssetStatus(asset.status)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={8}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'depreciation' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>対象月</th>
                <th>資産名</th>
                <th>区分</th>
                <th>当月償却</th>
                <th>累計</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {pkg.depreciationRows.length > 0 ? (
                pkg.depreciationRows.map((row, index) => (
                  <tr key={`${row.targetYearMonth}-${row.assetName}-${index}`}>
                    <td>{row.targetYearMonth}</td>
                    <td>{row.assetName}</td>
                    <td>{row.assetCategory}</td>
                    <td>{formatFareYen(row.depreciationYen)}円</td>
                    <td>{formatFareYen(row.cumulativeDepreciationYen)}円</td>
                    <td>{formatFareYen(row.remainingBookValue)}円</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'small-assets' ? (
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead>
              <tr>
                <th>購入日</th>
                <th>資産名</th>
                <th>取得価額</th>
                <th>PL反映月</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {pkg.smallAssets.length > 0 ? (
                pkg.smallAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.purchaseDate}</td>
                    <td>{asset.assetName}</td>
                    <td>{formatFareYen(asset.acquisitionCost)}円</td>
                    <td>{asset.depreciationStartYearMonth}</td>
                    <td>{asset.notes || '―'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5}>該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionId === 'account-breakdown' ? <ReportLineList lines={pkg.etax.accountBreakdown} /> : null}
      {sectionId === 'business-overview' ? <ReportLineList lines={pkg.etax.businessOverview} /> : null}
      {sectionId === 'consumption-tax' ? <ReportLineList lines={pkg.etax.consumptionTax} /> : null}

      {sectionId === 'input-status' ? (
        <ul className="accounting-etax-missing-list">
          {pkg.etax.checkItems.map((item) => (
            <li key={item.mappingId} className={`is-${item.status}`}>
              <span className="accounting-etax-missing-category">{item.category}</span>
              <strong>{item.label}</strong>
              <span>{formatETaxCheckItemStatus(item.status)}</span>
              {item.detail ? <span className="accounting-etax-check-detail">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {sectionId === 'review-list' ? (
        pkg.reviewItems.length > 0 ? (
          <ul className="accounting-etax-missing-list">
            {pkg.reviewItems.map((item) => (
              <li key={item.id} className="is-review">
                <span className="accounting-etax-missing-category">{item.category}</span>
                <strong>{item.label}</strong>
                {item.detail ? <span className="accounting-etax-check-detail">{item.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="save-note">確認事項はありません。</p>
        )
      ) : null}
    </section>
  )
}

export function TaxAdvisorPackagePanel({
  franchiseeId,
  storeId,
  storeName,
  initialTargetYear,
  staffId,
  staffName,
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  settlementAuxiliary,
  allReceipts,
  unorganizedReceipts,
  onExportRecorded,
  onError,
}: TaxAdvisorPackagePanelProps) {
  const [selectedYear, setSelectedYear] = useState(initialTargetYear)
  const [activeSection, setActiveSection] = useState<TaxAdvisorSectionId | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [meterSettings, setMeterSettings] = useState<MeterSettings | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const yearOptions = useMemo(() => buildCalendarYearOptions(5), [])

  useEffect(() => {
    setSelectedYear(initialTargetYear)
  }, [initialTargetYear])

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
    const unsubscribe = subscribeMeterSettings({ franchiseeId, storeId }, (settings: MeterSettings) => {
      setMeterSettings(settings)
    })
    return unsubscribe
  }, [franchiseeId, storeId])

  const auxiliary = useMemo(
    () =>
      mergeSettlementAuxiliary(
        settlementAuxiliary,
        buildDefaultSettlementAuxiliary({
          franchiseeId,
          storeId,
          targetYear: selectedYear,
          company,
          meterSettings,
          staffId,
          staffName,
        }),
      ),
    [company, franchiseeId, meterSettings, selectedYear, settlementAuxiliary, staffId, staffName, storeId],
  )

  const pkg = useMemo(
    () =>
      buildTaxAdvisorPackage({
        targetYear: selectedYear,
        storeName,
        company,
        meterSettings,
        caseRecords,
        expenses,
        adjustments,
        fixedCosts,
        fixedAssets,
        auxiliary,
        allReceipts,
        unorganizedReceipts,
      }),
    [
      adjustments,
      allReceipts,
      auxiliary,
      caseRecords,
      company,
      expenses,
      fixedAssets,
      fixedCosts,
      meterSettings,
      selectedYear,
      storeName,
      unorganizedReceipts,
    ],
  )

  const handleMenuClick = async (sectionId: TaxAdvisorSectionId) => {
    if (sectionId === 'pdf-bulk') {
      setIsExporting(true)
      try {
        const fileName = await exportTaxAdvisorPackagePdf(pkg)
        onExportRecorded(fileName)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'PDF出力に失敗しました。')
      } finally {
        setIsExporting(false)
      }
      return
    }

    if (sectionId === 'csv-bulk') {
      setIsExporting(true)
      try {
        const files = exportTaxAdvisorBulkCsv(pkg)
        files.forEach(onExportRecorded)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'CSV出力に失敗しました。')
      } finally {
        setIsExporting(false)
      }
      return
    }

    setActiveSection(sectionId)
  }

  if (activeSection) {
    return (
      <SectionDetail
        sectionId={activeSection}
        pkg={pkg}
        onBack={() => setActiveSection(null)}
      />
    )
  }

  return (
    <section className="accounting-panel accounting-etax-panel accounting-tax-advisor-panel" aria-label="税理士相談用 一式資料">
      <h2>税理士相談用 一式資料</h2>
      <p className="accounting-note">
        この画面は、税理士相談・申告前確認のために、年度別の経理根拠資料をまとめて確認・印刷・ダウンロードする画面です。
        e-Tax入力用決算資料とは別用途です。
      </p>

      <section className="accounting-tax-advisor-year-select" aria-label="対象年度選択">
        <label htmlFor="tax-advisor-target-year">対象年度</label>
        <select
          id="tax-advisor-target-year"
          value={selectedYear}
          onChange={(event) => setSelectedYear(Number(event.target.value))}
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}年度
            </option>
          ))}
        </select>
      </section>

      <section className="accounting-etax-header-card" aria-label="資料ヘッダー">
        <dl className="accounting-etax-header-grid">
          <div>
            <dt>対象年度</dt>
            <dd>{pkg.header.targetYear}年度</dd>
          </div>
          <div>
            <dt>会計年度</dt>
            <dd>{pkg.header.fiscalYearLabel}</dd>
          </div>
          <div>
            <dt>会社名</dt>
            <dd>{pkg.header.companyName}</dd>
          </div>
          <div>
            <dt>店舗名</dt>
            <dd>{pkg.header.storeName}</dd>
          </div>
          <div>
            <dt>作成日</dt>
            <dd>{pkg.header.createdDate}</dd>
          </div>
          <div>
            <dt>資料の目的</dt>
            <dd>{pkg.header.purpose}</dd>
          </div>
        </dl>
      </section>

      {pkg.reviewItems.length > 0 ? (
        <section className="accounting-etax-status-card" aria-label="要確認サマリー">
          <p className="accounting-note">確認事項 {pkg.reviewItems.length} 件（エラーではなく確認事項として表示）</p>
          <ul className="accounting-etax-missing-preview">
            {pkg.reviewItems.slice(0, 4).map((item) => (
              <li key={item.id} className="is-review">
                {item.label}
                {item.detail ? `（${item.detail}）` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="save-note">要確認事項はありません。</p>
      )}

      <p className="accounting-etax-role-note">
        e-Tax入力用決算資料はご自身の申告転記向け、税理士相談用一式資料は税理士確認向けの根拠資料です。
      </p>

      <div className="accounting-etax-menu-grid">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`accounting-etax-menu-card${
              item.id === 'pdf-bulk' || item.id === 'csv-bulk' ? ' is-bulk' : ''
            }${item.id === 'print-preview' ? ' is-featured' : ''}`}
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
