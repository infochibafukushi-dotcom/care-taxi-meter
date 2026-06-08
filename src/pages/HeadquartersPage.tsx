import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { disableCompany, ensureDefaultCompany, fetchCompanies, saveCompany } from '../services/companies'
import { fetchCaseRecords } from '../services/caseRecords'
import { fetchStaffMembers } from '../services/staffMembers'
import { fetchStores } from '../services/stores'
import { fetchVehicles } from '../services/vehicles'
import { useWorkSession } from '../hooks/useWorkSession'
import type { Company, StaffMember, Store, Vehicle } from '../types/work'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { resetHeadquartersDevelopmentData } from '../services/developmentReset'

const createCompanyDraft = (sortOrder: number): Company => ({
  id: '',
  name: '',
  enabled: true,
  sortOrder,
  ownerName: '',
  phoneNumber: '',
  email: '',
  address: '',
  memo: '',
})

const normalizeCompanyId = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')

const getCompanyId = (company: Company) => normalizeCompanyId(company.id || company.name)

export function HeadquartersPage() {
  const workSession = useWorkSession()
  const [companies, setCompanies] = useState<Company[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [draftCompany, setDraftCompany] = useState<Company>(createCompanyDraft(1))
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [message, setMessage] = useState('加盟店情報を読み込み中です。')
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      await ensureDefaultCompany()
      const [companyItems, storeItems, staffItems, vehicleItems, records] = await Promise.all([
        fetchCompanies(),
        fetchStores(),
        fetchStaffMembers(),
        fetchVehicles(),
        fetchCaseRecords(),
      ])
      setCompanies(companyItems)
      setStores(storeItems)
      setStaffMembers(staffItems)
      setVehicles(vehicleItems)
      setCaseRecords(records)
      setSelectedCompanyId((currentCompanyId) => currentCompanyId || companyItems[0]?.id || '')
      setDraftCompany(createCompanyDraft(companyItems.length + 1))
      setMessage('加盟店情報を読み込みました。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加盟店情報の読み込みに失敗しました。')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadData)
  }, [])

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null

  const companySummaries = useMemo(
    () => companies.map((company) => {
      const companyStores = stores.filter((store) => store.companyId === company.id)
      const companyStaffMembers = staffMembers.filter((staffMember) => staffMember.companyId === company.id)
      const companyVehicles = vehicles.filter((vehicle) => vehicle.companyId === company.id)
      const companyRecords = caseRecords.filter((caseRecord) => caseRecord.companyId === company.id)
      const salesYen = companyRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)

      return {
        company,
        caseCount: companyRecords.length,
        salesYen,
        staffCount: companyStaffMembers.length,
        storeCount: companyStores.length,
        vehicleCount: companyVehicles.length,
      }
    }),
    [caseRecords, companies, staffMembers, stores, vehicles],
  )

  const selectedSummary = companySummaries.find(
    (summary) => summary.company.id === selectedCompanyId,
  ) ?? null

  const isSuperAdmin = workSession.currentSession?.staffRole === 'superAdmin'

  const updateDraftCompany = (key: keyof Company, value: string | boolean | number) => {
    setDraftCompany((currentCompany) => ({ ...currentCompany, [key]: value }))
  }

  const handleCompanySave = async () => {
    const companyId = getCompanyId(draftCompany)
    if (!companyId || !draftCompany.name.trim()) {
      setMessage('会社IDと加盟店名を入力してください。')
      return
    }

    setMessage('加盟店を保存中です。')
    await saveCompany({ ...draftCompany, id: companyId })
    await loadData()
    setSelectedCompanyId(companyId)
    setMessage('加盟店を保存しました。')
  }

  const handleCompanyDisable = async (company: Company) => {
    setMessage('加盟店を停止中です。')
    await disableCompany(company)
    await loadData()
    setMessage(`${company.name} を停止しました。`)
  }

  const handleDevelopmentDataReset = async () => {
    const confirmed = window.confirm('加盟店・売上・勤務・スタッフ・車両データを削除し、FC本部の初期データのみ再作成します。実行しますか？')
    if (!confirmed) {
      return
    }

    setMessage('データをリセット中です。')
    try {
      const summary = await resetHeadquartersDevelopmentData()
      await loadData()
      setSelectedCompanyId('default-franchisee')
      setMessage(`データをリセットしました。削除件数: ${Object.values(summary.deletedByCollection).reduce((total, count) => total + count, 0)}件`)
    } catch (error) {
      setMessage(error instanceof Error ? `データリセットに失敗しました。${error.message}` : 'データリセットに失敗しました。')
    }
  }

  if (!isSuperAdmin) {
    return (
      <main className="page page--admin" aria-labelledby="hq-title">
        <section className="admin-section">
          <p className="eyebrow">Headquarters</p>
          <h1 id="hq-title">FC本部管理画面</h1>
          <p className="case-error">FC本部管理画面は superAdmin のみ利用できます。</p>
          <Link className="secondary-action" to="/">TOPへ戻る</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page page--admin" aria-labelledby="hq-title">
      <section className="admin-section">
        <p className="eyebrow">Headquarters</p>
        <h1 id="hq-title">FC本部管理画面</h1>
        <p className="lead">会社ID管理・加盟店追加・加盟店停止・加盟店詳細を管理します。</p>
        <p className="save-note">{isLoading ? '読み込み中です。' : message}</p>
        <button className="secondary-action" type="button" onClick={handleDevelopmentDataReset}>データリセット</button>
      </section>

      <section className="admin-section">
        <h2>加盟店追加</h2>
        <div className="settings-grid">
          <label>
            会社ID
            <input value={draftCompany.id} onChange={(event) => updateDraftCompany('id', event.target.value)} placeholder="company-id" />
          </label>
          <label>
            加盟店名
            <input value={draftCompany.name} onChange={(event) => updateDraftCompany('name', event.target.value)} />
          </label>
          <label>
            オーナー名
            <input value={draftCompany.ownerName} onChange={(event) => updateDraftCompany('ownerName', event.target.value)} />
          </label>
          <label>
            電話番号
            <input value={draftCompany.phoneNumber} onChange={(event) => updateDraftCompany('phoneNumber', event.target.value)} />
          </label>
          <label>
            メール
            <input value={draftCompany.email} onChange={(event) => updateDraftCompany('email', event.target.value)} />
          </label>
          <label>
            並び順
            <input type="number" value={draftCompany.sortOrder} onChange={(event) => updateDraftCompany('sortOrder', Number(event.target.value))} />
          </label>
        </div>
        <label className="settings-textarea-label">
          住所
          <textarea value={draftCompany.address} onChange={(event) => updateDraftCompany('address', event.target.value)} />
        </label>
        <label className="settings-textarea-label">
          メモ
          <textarea value={draftCompany.memo} onChange={(event) => updateDraftCompany('memo', event.target.value)} />
        </label>
        <button className="primary-action" type="button" onClick={handleCompanySave}>加盟店を追加</button>
      </section>

      <section className="admin-section">
        <h2>加盟店一覧</h2>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>会社ID</th>
                <th>加盟店名</th>
                <th>状態</th>
                <th>店舗</th>
                <th>スタッフ</th>
                <th>車両</th>
                <th>件数</th>
                <th>売上</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {companySummaries.map((summary) => (
                <tr key={summary.company.id}>
                  <td>{summary.company.id}</td>
                  <td>{summary.company.name}</td>
                  <td>{summary.company.enabled ? '稼働中' : '停止中'}</td>
                  <td>{summary.storeCount}</td>
                  <td>{summary.staffCount}</td>
                  <td>{summary.vehicleCount}</td>
                  <td>{summary.caseCount}</td>
                  <td>{formatFareYen(summary.salesYen)}円</td>
                  <td>
                    <button type="button" onClick={() => setSelectedCompanyId(summary.company.id)}>詳細</button>
                    {summary.company.enabled ? (
                      <button type="button" onClick={() => handleCompanyDisable(summary.company)}>停止</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h2>加盟店詳細</h2>
        {selectedCompany && selectedSummary ? (
          <div className="work-dashboard-grid">
            <div><span>会社ID</span><strong>{selectedCompany.id}</strong></div>
            <div><span>加盟店名</span><strong>{selectedCompany.name}</strong></div>
            <div><span>状態</span><strong>{selectedCompany.enabled ? '稼働中' : '停止中'}</strong></div>
            <div><span>店舗数</span><strong>{selectedSummary.storeCount}</strong></div>
            <div><span>スタッフ数</span><strong>{selectedSummary.staffCount}</strong></div>
            <div><span>車両数</span><strong>{selectedSummary.vehicleCount}</strong></div>
            <div><span>案件数</span><strong>{selectedSummary.caseCount}</strong></div>
            <div><span>売上</span><strong>{formatFareYen(selectedSummary.salesYen)}円</strong></div>
          </div>
        ) : (
          <p className="empty-note">加盟店を選択してください。</p>
        )}
      </section>
    </main>
  )
}
