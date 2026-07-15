import { useEffect, useRef, useState } from 'react'
import { fetchCompanyById } from '../../services/companies'
import { saveAccountingSettlementAuxiliary } from '../../services/accountingSettlementAuxiliary'
import { subscribeMeterSettings, type MeterSettings } from '../../services/meterSettings'
import type { Company } from '../../types/work'
import type {
  AccountingSettlementAuxiliaryInput,
  StoredAccountingSettlementAuxiliary,
} from '../../types/accountingSettlementAuxiliary'
import {
  buildDefaultSettlementAuxiliary,
  buildEmptyBankAccountRow,
  buildEmptyLoanRow,
  buildEmptyOfficerLoanRow,
  buildEmptyPayableRow,
  buildEmptyReceivableRow,
  createSettlementRowId,
  mergeSettlementAuxiliary,
} from '../../utils/accountingSettlementAuxiliaryForm'
import { COMPANY_FISCAL_POLICY } from '../../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from '../../utils/accountingFiscalPeriod'

type SettlementAuxiliaryDataPanelProps = {
  franchiseeId: string
  storeId: string
  targetYear: number
  staffId: string
  staffName: string
  stored: StoredAccountingSettlementAuxiliary | null
  onReload: () => Promise<void>
  onStatus: (message: string) => void
  onError: (message: string) => void
}

const parseNumberInput = (value: string): number | null => {
  if (!value.trim()) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label className="accounting-form-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        onChange={(event) => onChange(parseNumberInput(event.target.value))}
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  return (
    <label className="accounting-form-field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  )
}

export function SettlementAuxiliaryDataPanel({
  franchiseeId,
  storeId,
  targetYear,
  staffId,
  staffName,
  stored,
  onReload,
  onStatus,
  onError,
}: SettlementAuxiliaryDataPanelProps) {
  const [company, setCompany] = useState<Company | null>(null)
  const [meterSettings, setMeterSettings] = useState<MeterSettings | null>(null)
  const [form, setForm] = useState<AccountingSettlementAuxiliaryInput | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [openSection, setOpenSection] = useState('company')

  const [companyLoaded, setCompanyLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCompanyLoaded(false)
    void fetchCompanyById(franchiseeId).then((row) => {
      if (!cancelled) {
        setCompany(row)
        setCompanyLoaded(true)
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

  const initializationRef = useRef('')

  useEffect(() => {
    if (!companyLoaded && !stored) {
      return
    }

    const nextKey = stored
      ? `${stored.id}:${String(stored.updatedAt ?? '')}`
      : `draft:${targetYear}:${franchiseeId}:${storeId}`

    if (initializationRef.current === nextKey) {
      return
    }
    initializationRef.current = nextKey

    setForm(
      mergeSettlementAuxiliary(
        stored,
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
    )
  }, [company, companyLoaded, franchiseeId, meterSettings, staffId, staffName, storeId, stored, targetYear])

  if (!form) {
    return <p className="empty-note">決算補助データを読み込み中です。</p>
  }

  const updateCompanyBasic = (patch: Partial<AccountingSettlementAuxiliaryInput['companyBasic']>) => {
    setForm((current) =>
      current
        ? {
            ...current,
            companyBasic: { ...current.companyBasic, ...patch },
          }
        : current,
    )
  }

  const updateBalance = (patch: Partial<AccountingSettlementAuxiliaryInput['yearEndBalance']>) => {
    setForm((current) =>
      current
        ? {
            ...current,
            yearEndBalance: { ...current.yearEndBalance, ...patch },
          }
        : current,
    )
  }

  const handleSave = async () => {
    if (!form) {
      return
    }

    setIsSaving(true)
    try {
      await saveAccountingSettlementAuxiliary(
        {
          ...form,
          targetYear,
          updatedBy: staffId,
          updatedByName: staffName,
        },
        { isNewDocument: !stored },
      )
      await onReload()
      onStatus(`${targetYear}年度の決算補助データを保存しました。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const sections = [
    { id: 'company', label: '1. 会社基本情報' },
    { id: 'balance', label: '2. 期末残高' },
    { id: 'bank', label: '3. 預金内訳' },
    { id: 'loan', label: '4. 借入金内訳' },
    { id: 'officer-loan', label: '5. 役員借入金内訳' },
    { id: 'receivable', label: '6. 売掛金・未収金内訳' },
    { id: 'payable', label: '7. 未払金内訳' },
  ]

  return (
    <div className="accounting-settlement-auxiliary">
      <p className="accounting-note">
        既存の会社情報から自動取得できる項目は初期値として表示されます。不足分のみ入力して保存してください。
      </p>

      <div className="accounting-settlement-section-tabs">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={openSection === section.id ? 'secondary-action is-active' : 'secondary-action'}
            onClick={() => setOpenSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      {openSection === 'company' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-form-grid">
            <TextField label="会社名" value={form.companyBasic.companyName} onChange={(value) => updateCompanyBasic({ companyName: value })} />
            <TextField label="法人番号" value={form.companyBasic.corporateNumber} onChange={(value) => updateCompanyBasic({ corporateNumber: value })} />
            <TextField label="所在地" value={form.companyBasic.address} onChange={(value) => updateCompanyBasic({ address: value })} />
            <TextField label="代表者名" value={form.companyBasic.representativeName} onChange={(value) => updateCompanyBasic({ representativeName: value })} />
            <TextField label="事業内容" value={form.companyBasic.businessDescription} onChange={(value) => updateCompanyBasic({ businessDescription: value })} multiline />
            <NumberField label="役員数" value={form.companyBasic.officerCount} onChange={(value) => updateCompanyBasic({ officerCount: value })} />
            <NumberField label="従業員数" value={form.companyBasic.employeeCount} onChange={(value) => updateCompanyBasic({ employeeCount: value })} />
            <NumberField label="決算月" value={form.companyBasic.fiscalMonthEnd} onChange={(value) => updateCompanyBasic({ fiscalMonthEnd: value })} />
            <TextField label="会計年度開始日" value={form.companyBasic.fiscalYearStartDate} onChange={(value) => updateCompanyBasic({ fiscalYearStartDate: value })} />
            <TextField label="会計年度終了日" value={form.companyBasic.fiscalYearEndDate} onChange={(value) => updateCompanyBasic({ fiscalYearEndDate: value })} />
          </div>
          {(() => {
            const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, targetYear)
            if (
              !period ||
              (!form.companyBasic.fiscalYearStartDate && !form.companyBasic.fiscalYearEndDate)
            ) {
              return null
            }
            const startMismatch =
              form.companyBasic.fiscalYearStartDate &&
              form.companyBasic.fiscalYearStartDate !== period.startDate
            const endMismatch =
              form.companyBasic.fiscalYearEndDate &&
              form.companyBasic.fiscalYearEndDate !== period.endDate
            if (!startMismatch && !endMismatch) {
              return null
            }
            return (
              <p className="accounting-note" role="status">
                推奨の会計期間（{period.startDate}〜{period.endDate}）と保存値が異なります。必要に応じて修正してください。
              </p>
            )
          })()}
        </section>
      ) : null}

      {openSection === 'balance' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-form-grid">
            <NumberField label="現金" value={form.yearEndBalance.cash} onChange={(value) => updateBalance({ cash: value })} />
            <NumberField label="普通預金" value={form.yearEndBalance.deposits} onChange={(value) => updateBalance({ deposits: value })} />
            <NumberField label="売掛金" value={form.yearEndBalance.accountsReceivable} onChange={(value) => updateBalance({ accountsReceivable: value })} />
            <NumberField label="未収金" value={form.yearEndBalance.accruedIncome} onChange={(value) => updateBalance({ accruedIncome: value })} />
            <NumberField label="仮払金" value={form.yearEndBalance.prepayments} onChange={(value) => updateBalance({ prepayments: value })} />
            <NumberField label="未払金" value={form.yearEndBalance.accountsPayable} onChange={(value) => updateBalance({ accountsPayable: value })} />
            <NumberField label="借入金" value={form.yearEndBalance.borrowings} onChange={(value) => updateBalance({ borrowings: value })} />
            <NumberField label="役員借入金" value={form.yearEndBalance.officerLoans} onChange={(value) => updateBalance({ officerLoans: value })} />
            <NumberField label="資本金" value={form.yearEndBalance.capital} onChange={(value) => updateBalance({ capital: value })} />
            <NumberField label="利益剰余金" value={form.yearEndBalance.retainedEarnings} onChange={(value) => updateBalance({ retainedEarnings: value })} />
          </div>

          <div className="accounting-settlement-custom-accounts">
            <div className="accounting-settlement-row-header">
              <h4>追加科目（将来拡張用）</h4>
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  updateBalance({
                    customAccounts: [
                      ...form.yearEndBalance.customAccounts,
                      { id: createSettlementRowId('custom'), accountName: '', amountYen: null },
                    ],
                  })
                }
              >
                科目を追加
              </button>
            </div>
            {form.yearEndBalance.customAccounts.map((account) => (
              <div key={account.id} className="accounting-settlement-row-card">
                <TextField
                  label="科目名"
                  value={account.accountName}
                  onChange={(value) =>
                    updateBalance({
                      customAccounts: form.yearEndBalance.customAccounts.map((row) =>
                        row.id === account.id ? { ...row, accountName: value } : row,
                      ),
                    })
                  }
                />
                <NumberField
                  label="期末残高"
                  value={account.amountYen}
                  onChange={(value) =>
                    updateBalance({
                      customAccounts: form.yearEndBalance.customAccounts.map((row) =>
                        row.id === account.id ? { ...row, amountYen: value } : row,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    updateBalance({
                      customAccounts: form.yearEndBalance.customAccounts.filter((row) => row.id !== account.id),
                    })
                  }
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {openSection === 'bank' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-settlement-row-header">
            <h4>預貯金等の内訳</h4>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setForm((current) => current ? { ...current, bankAccounts: [...current.bankAccounts, buildEmptyBankAccountRow()] } : current)}
            >
              行を追加
            </button>
          </div>
          {form.bankAccounts.map((row) => (
            <div key={row.id} className="accounting-settlement-row-card">
              <div className="accounting-form-grid">
                <TextField label="金融機関名" value={row.institutionName} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, institutionName: value } : item) } : current)} />
                <TextField label="支店名" value={row.branchName} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, branchName: value } : item) } : current)} />
                <TextField label="口座種別" value={row.accountType} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, accountType: value } : item) } : current)} />
                <TextField label="口座番号下4桁" value={row.accountLastFour} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, accountLastFour: value } : item) } : current)} />
                <NumberField label="期末残高" value={row.yearEndBalance} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, yearEndBalance: value } : item) } : current)} />
                <TextField label="備考" value={row.notes} onChange={(value) => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.map((item) => item.id === row.id ? { ...item, notes: value } : item) } : current)} />
              </div>
              <button type="button" className="text-link" onClick={() => setForm((current) => current ? { ...current, bankAccounts: current.bankAccounts.filter((item) => item.id !== row.id) } : current)}>削除</button>
            </div>
          ))}
        </section>
      ) : null}

      {openSection === 'loan' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-settlement-row-header">
            <h4>借入金内訳</h4>
            <button type="button" className="secondary-action" onClick={() => setForm((current) => current ? { ...current, loans: [...current.loans, buildEmptyLoanRow()] } : current)}>行を追加</button>
          </div>
          {form.loans.map((row) => (
            <div key={row.id} className="accounting-settlement-row-card">
              <div className="accounting-form-grid">
                <TextField label="借入先" value={row.lenderName} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, lenderName: value } : item) } : current)} />
                <TextField label="借入日" value={row.loanDate} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, loanDate: value } : item) } : current)} />
                <NumberField label="当初借入額" value={row.originalAmount} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, originalAmount: value } : item) } : current)} />
                <NumberField label="期末残高" value={row.yearEndBalance} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, yearEndBalance: value } : item) } : current)} />
                <TextField label="返済期限" value={row.repaymentDueDate} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, repaymentDueDate: value } : item) } : current)} />
                <TextField label="利率" value={row.interestRate} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, interestRate: value } : item) } : current)} />
                <TextField label="担保有無" value={row.hasCollateral} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, hasCollateral: value } : item) } : current)} />
                <TextField label="備考" value={row.notes} onChange={(value) => setForm((current) => current ? { ...current, loans: current.loans.map((item) => item.id === row.id ? { ...item, notes: value } : item) } : current)} />
              </div>
              <button type="button" className="text-link" onClick={() => setForm((current) => current ? { ...current, loans: current.loans.filter((item) => item.id !== row.id) } : current)}>削除</button>
            </div>
          ))}
        </section>
      ) : null}

      {openSection === 'officer-loan' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-settlement-row-header">
            <h4>役員借入金内訳</h4>
            <button type="button" className="secondary-action" onClick={() => setForm((current) => current ? { ...current, officerLoans: [...current.officerLoans, buildEmptyOfficerLoanRow()] } : current)}>行を追加</button>
          </div>
          {form.officerLoans.map((row) => (
            <div key={row.id} className="accounting-settlement-row-card">
              <div className="accounting-form-grid">
                <TextField label="役員名" value={row.officerName} onChange={(value) => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.map((item) => item.id === row.id ? { ...item, officerName: value } : item) } : current)} />
                <TextField label="発生日" value={row.occurrenceDate} onChange={(value) => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.map((item) => item.id === row.id ? { ...item, occurrenceDate: value } : item) } : current)} />
                <TextField label="内容" value={row.description} onChange={(value) => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.map((item) => item.id === row.id ? { ...item, description: value } : item) } : current)} />
                <NumberField label="期末残高" value={row.yearEndBalance} onChange={(value) => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.map((item) => item.id === row.id ? { ...item, yearEndBalance: value } : item) } : current)} />
                <TextField label="備考" value={row.notes} onChange={(value) => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.map((item) => item.id === row.id ? { ...item, notes: value } : item) } : current)} />
              </div>
              <button type="button" className="text-link" onClick={() => setForm((current) => current ? { ...current, officerLoans: current.officerLoans.filter((item) => item.id !== row.id) } : current)}>削除</button>
            </div>
          ))}
        </section>
      ) : null}

      {openSection === 'receivable' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-settlement-row-header">
            <h4>売掛金・未収金内訳</h4>
            <button type="button" className="secondary-action" onClick={() => setForm((current) => current ? { ...current, receivables: [...current.receivables, buildEmptyReceivableRow()] } : current)}>行を追加</button>
          </div>
          {form.receivables.map((row) => (
            <div key={row.id} className="accounting-settlement-row-card">
              <div className="accounting-form-grid">
                <label className="accounting-form-field">
                  <span>区分</span>
                  <select
                    value={row.receivableKind ?? 'accountsReceivable'}
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              receivables: current.receivables.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      receivableKind: event.target.value as 'accountsReceivable' | 'accruedIncome',
                                    }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                  >
                    <option value="accountsReceivable">売掛金</option>
                    <option value="accruedIncome">未収金</option>
                  </select>
                </label>
                <TextField label="相手先名" value={row.counterpartyName} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, counterpartyName: value } : item) } : current)} />
                <TextField label="登録番号/法人番号" value={row.registrationNumber} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, registrationNumber: value } : item) } : current)} />
                <TextField label="内容" value={row.description} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, description: value } : item) } : current)} />
                <TextField label="発生日" value={row.occurrenceDate} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, occurrenceDate: value } : item) } : current)} />
                <NumberField label="期末残高" value={row.yearEndBalance} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, yearEndBalance: value } : item) } : current)} />
                <TextField label="備考" value={row.notes} onChange={(value) => setForm((current) => current ? { ...current, receivables: current.receivables.map((item) => item.id === row.id ? { ...item, notes: value } : item) } : current)} />
              </div>
              <button type="button" className="text-link" onClick={() => setForm((current) => current ? { ...current, receivables: current.receivables.filter((item) => item.id !== row.id) } : current)}>削除</button>
            </div>
          ))}
        </section>
      ) : null}

      {openSection === 'payable' ? (
        <section className="accounting-settlement-section">
          <div className="accounting-settlement-row-header">
            <h4>未払金内訳</h4>
            <button type="button" className="secondary-action" onClick={() => setForm((current) => current ? { ...current, payables: [...current.payables, buildEmptyPayableRow()] } : current)}>行を追加</button>
          </div>
          {form.payables.map((row) => (
            <div key={row.id} className="accounting-settlement-row-card">
              <div className="accounting-form-grid">
                <TextField label="相手先名" value={row.counterpartyName} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, counterpartyName: value } : item) } : current)} />
                <TextField label="登録番号/法人番号" value={row.registrationNumber} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, registrationNumber: value } : item) } : current)} />
                <TextField label="内容" value={row.description} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, description: value } : item) } : current)} />
                <TextField label="発生日" value={row.occurrenceDate} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, occurrenceDate: value } : item) } : current)} />
                <NumberField label="期末残高" value={row.yearEndBalance} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, yearEndBalance: value } : item) } : current)} />
                <TextField label="備考" value={row.notes} onChange={(value) => setForm((current) => current ? { ...current, payables: current.payables.map((item) => item.id === row.id ? { ...item, notes: value } : item) } : current)} />
              </div>
              <button type="button" className="text-link" onClick={() => setForm((current) => current ? { ...current, payables: current.payables.filter((item) => item.id !== row.id) } : current)}>削除</button>
            </div>
          ))}
        </section>
      ) : null}

      <div className="accounting-settlement-save-bar">
        <button className="primary-action" type="button" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? '保存中…' : '決算補助データを保存'}
        </button>
      </div>
    </div>
  )
}
