import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { archiveCompany, ensureDefaultCompany, fetchCompanies, resumeCompany, saveCompany, updateCompanyStatus } from '../services/companies'
import { fetchCaseRecords } from '../services/caseRecords'
import { fetchStaffMembers, saveStaffMember } from '../services/staffMembers'
import { fetchStores, saveStore } from '../services/stores'
import { fetchVehicles } from '../services/vehicles'
import { useWorkSession } from '../hooks/useWorkSession'
import { loadAuthStaffSession } from '../services/authSession'
import type { Company, StaffMember, Store, Vehicle } from '../types/work'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { resetHeadquartersDevelopmentData } from '../services/developmentReset'

const companyStatusLabels: Record<NonNullable<Company['status']>, string> = {
  screening: '審査中',
  preparing: '開業準備中',
  active: '営業中',
  suspended: '休止中',
  terminated: '解約済み',
  archived: '解約済み',
}

const createCompanyDraft = (sortOrder: number): Company => ({
  id: '',
  name: '',
  corporateName: '',
  representativeName: '',
  area: '',
  status: 'screening',
  plan: '標準プラン',
  monthlyFee: 50000,
  initialFee: 0,
  contractStartDate: '',
  contractEndDate: '',
  contractStatus: '契約前',
  billingStatus: '未請求',
  lastBillingMonth: '',
  paymentStatus: '未請求',
  enabled: true,
  sortOrder,
  ownerName: '',
  phoneNumber: '',
  email: '',
  address: '',
  memo: '',
})

type OwnerLoginDraft = {
  password: string
  userId: string
}

const createOwnerLoginDraft = (): OwnerLoginDraft => ({ password: '', userId: '' })

const normalizeCompanyId = (value: string) =>
  value.trim().toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const getCompanyId = (company: Company) => normalizeCompanyId(company.id || company.name)
const isPlaceholderCompanyId = (value: string) => /^-+$/.test(value)
const getCompanyDisplayId = (company: Company) => isPlaceholderCompanyId(company.id) && company.name.trim() ? company.name : company.id

const getMonthStartIso = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString()
}

const formatDate = (value?: string) => value || '未設定'

const getMonthsBetween = (start?: string, end = new Date()) => {
  if (!start) return '未設定'
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime())) return '未設定'
  const months = Math.max((end.getFullYear() - startDate.getFullYear()) * 12 + end.getMonth() - startDate.getMonth(), 0)
  const years = Math.floor(months / 12)
  const restMonths = months % 12
  return years > 0 ? `${years}年${restMonths}か月` : `${Math.max(restMonths, 1)}か月`
}

export function HeadquartersPage() {
  const workSession = useWorkSession()
  const authSession = loadAuthStaffSession()
  const [companies, setCompanies] = useState<Company[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [draftCompany, setDraftCompany] = useState<Company>(createCompanyDraft(1))
  const [ownerLoginDraft, setOwnerLoginDraft] = useState<OwnerLoginDraft>(createOwnerLoginDraft())
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [message, setMessage] = useState('加盟店情報を読み込み中です。')
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      await ensureDefaultCompany()
      const [companyItems, storeItems, staffItems, vehicleItems, records] = await Promise.all([
        fetchCompanies(), fetchStores(), fetchStaffMembers(), fetchVehicles(), fetchCaseRecords(),
      ])
      setCompanies(companyItems)
      setStores(storeItems)
      setStaffMembers(staffItems)
      setVehicles(vehicleItems)
      setCaseRecords(records)
      setSelectedCompanyId((currentCompanyId) => currentCompanyId || companyItems[0]?.id || '')
      setDraftCompany(createCompanyDraft(companyItems.length + 1))
      setOwnerLoginDraft(createOwnerLoginDraft())
      setMessage('加盟店情報を読み込みました。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加盟店情報の読み込みに失敗しました。')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void Promise.resolve().then(loadData) }, [])

  const isHqAdmin = workSession.currentSession?.staffRole === 'hq_admin' || authSession?.role === 'hq_admin'
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null
  const monthStartIso = getMonthStartIso()

  const companySummaries = useMemo(() => companies.map((company) => {
    const companyStores = stores.filter((store) => store.companyId === company.id)
    const companyStaffMembers = staffMembers.filter((staffMember) => staffMember.companyId === company.id)
    const companyVehicles = vehicles.filter((vehicle) => vehicle.companyId === company.id)
    const companyRecords = caseRecords.filter((caseRecord) => caseRecord.companyId === company.id)
    const monthRecords = companyRecords.filter((caseRecord) => caseRecord.closedAt >= monthStartIso)
    const salesYen = companyRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    const monthSalesYen = monthRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    return { company, caseCount: companyRecords.length, monthCaseCount: monthRecords.length, monthSalesYen, salesYen, staffCount: companyStaffMembers.length, storeCount: companyStores.length, vehicleCount: companyVehicles.length }
  }), [caseRecords, companies, monthStartIso, staffMembers, stores, vehicles])

  const kpis = useMemo(() => {
    const franchiseCompanies = companies.filter((company) => company.id !== 'default-franchisee')
    const activeCompanies = franchiseCompanies.filter((company) => (company.status ?? 'active') === 'active')
    const suspendedCompanies = franchiseCompanies.filter((company) => (company.status ?? '') === 'suspended')
    const terminatedCompanies = franchiseCompanies.filter((company) => ['terminated', 'archived'].includes(company.status ?? ''))
    const monthCompanies = franchiseCompanies.filter((company) => (company.contractStartDate ?? '') >= monthStartIso)
    const monthTerminated = franchiseCompanies.filter((company) => ['terminated', 'archived'].includes(company.status ?? '') && (company.contractEndDate ?? '') >= monthStartIso)
    const totalSalesYen = companySummaries.reduce((total, summary) => total + summary.salesYen, 0)
    const monthSalesYen = companySummaries.reduce((total, summary) => total + summary.monthSalesYen, 0)
    const monthCaseCount = companySummaries.reduce((total, summary) => total + summary.monthCaseCount, 0)
    const continuityRate = franchiseCompanies.length > 0 ? Math.round((activeCompanies.length / franchiseCompanies.length) * 100) : 100
    return { activeCompanies, continuityRate, franchiseCompanies, monthCaseCount, monthCompanies, monthSalesYen, monthTerminated, suspendedCompanies, terminatedCompanies, totalSalesYen }
  }, [companies, companySummaries, monthStartIso])

  const rankingBySales = [...companySummaries].sort((a, b) => b.monthSalesYen - a.monthSalesYen).slice(0, 5)
  const rankingByCases = [...companySummaries].sort((a, b) => b.monthCaseCount - a.monthCaseCount).slice(0, 5)
  const rankingByAverage = [...companySummaries].sort((a, b) => (b.monthCaseCount ? b.monthSalesYen / b.monthCaseCount : 0) - (a.monthCaseCount ? a.monthSalesYen / a.monthCaseCount : 0)).slice(0, 5)
  const rankingByGrowth = [...companySummaries].sort((a, b) => b.monthSalesYen - a.monthSalesYen).slice(0, 5)
  const alerts = [
    ...companies.filter((company) => company.status === 'suspended').map((company) => `休止中加盟店: ${company.name}`),
    ...companies.filter((company) => company.contractStatus === '解約予定').map((company) => `解約予定加盟店: ${company.name}`),
    ...companies.filter((company) => company.billingStatus === '未払い' || company.paymentStatus === '未払い').map((company) => `請求未払い加盟店: ${company.name}`),
    ...companySummaries.filter((summary) => summary.monthSalesYen === 0 && summary.caseCount > 0).map((summary) => `売上急減確認: ${summary.company.name}`),
    ...companies.filter((company) => !company.lastLoginAt).map((company) => `長期間ログインなし: ${company.name}`),
  ].slice(0, 8)

  const updateDraftCompany = (key: keyof Company, value: string | boolean | number) => setDraftCompany((currentCompany) => ({ ...currentCompany, [key]: value }))
  const updateOwnerLoginDraft = (key: keyof OwnerLoginDraft, value: string) => setOwnerLoginDraft((currentOwnerLogin) => ({ ...currentOwnerLogin, [key]: value }))

  const handleCompanySave = async () => {
    const companyId = getCompanyId(draftCompany)
    const companyName = draftCompany.name.trim()
    const ownerUserId = ownerLoginDraft.userId.trim()
    const ownerPassword = ownerLoginDraft.password.trim()
    if (!companyId || !companyName) { setMessage('加盟店IDと加盟店名を入力してください。'); return }
    if (!ownerUserId || !ownerPassword) { setMessage('代表ログインIDと初期パスワードを入力してください。'); return }
    const initialStoreId = `${companyId}_main-store`
    const initialStoreName = companyName
    const ownerName = draftCompany.representativeName?.trim() || draftCompany.ownerName.trim() || ownerUserId
    setMessage('加盟店と代表アカウントを保存中です。')
    await saveCompany({ ...draftCompany, id: companyId, name: companyName, ownerName, representativeName: ownerName, enabled: draftCompany.status !== 'suspended' && draftCompany.status !== 'terminated' })
    await saveStore({ id: initialStoreId, companyId, franchiseeId: companyId, name: initialStoreName, storeName: initialStoreName, companyName, ownerName, address: draftCompany.address, phoneNumber: draftCompany.phoneNumber, email: draftCompany.email, status: 'active', enabled: true, isActive: true, sortOrder: 1 })
    await saveStaffMember({ id: `${companyId}_owner`, companyId, franchiseeId: companyId, storeId: initialStoreId, storeName: initialStoreName, userId: ownerUserId, loginId: ownerUserId, password: ownerPassword, name: ownerName, role: 'owner', canDrive: true, isActive: true, status: 'employed', phoneNumber: draftCompany.phoneNumber, email: draftCompany.email, address: draftCompany.address, licenseNumber: '', licenseExpiresAt: '', accidentHistory: '', memo: '加盟店代表者登録・ID発行で作成したオーナーアカウント', enabled: true, sortOrder: 1 })
    await loadData()
    setSelectedCompanyId(companyId)
    setMessage('加盟店と代表者IDを保存しました。')
  }

  const handleStatusChange = async (company: Company, status: Company['status'], label: string) => {
    if (!status) return
    setMessage(`加盟店を${label}中です。`)
    if (status === 'active') await resumeCompany(company)
    else if (status === 'terminated') await archiveCompany(company)
    else await updateCompanyStatus(company, status)
    await loadData()
    setMessage(`${company.name} を${label}しました。`)
  }

  const handleDevelopmentDataReset = async () => {
    const confirmed = window.confirm('加盟店・売上・勤務・従業員・車両データを削除し、FC本部の初期データのみ再作成します。実行しますか？')
    if (!confirmed) return
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

  if (!isHqAdmin) {
    return <main className="page page--admin page--hq" aria-labelledby="hq-title"><section className="admin-section"><p className="eyebrow">Headquarters</p><h1 id="hq-title">FC本部管理画面</h1><p className="case-error">FC本部管理画面は hq_admin のみ利用できます。</p><Link className="secondary-action" to="/">TOPへ戻る</Link></section></main>
  }

  return (
    <main className="page page--admin page--hq hq-desktop" aria-labelledby="hq-title">
      <section className="admin-section hq-hero">
        <div><p className="eyebrow">HQ Console</p><h1 id="hq-title">FC本部ダッシュボード</h1><p className="lead">株式会社千葉福祉サポート向けの加盟店管理・分析・支援画面です。メーター、出勤、点呼、案件作成などの現場業務メニューは表示しません。</p></div>
        <button className="secondary-action" type="button" onClick={handleDevelopmentDataReset}>開発データリセット</button>
      </section>
      <nav className="hq-menu" aria-label="FC本部メニュー">
        {['ダッシュボード','加盟店管理','売上分析','エリア分析','契約・請求管理','従業員・アカウント管理','FCノウハウ共有','システム設定'].map((item) => <a key={item} href={`#${item}`}>{item}</a>)}
      </nav>
      <p className="save-note">{isLoading ? '読み込み中です。' : message}</p>

      <section className="admin-section" id="ダッシュボード">
        <h2>KPI</h2>
        <div className="hq-kpi-grid">
          <Kpi label="FC加盟店数" value={`${kpis.franchiseCompanies.length}社`} /><Kpi label="稼働加盟店数" value={`${kpis.activeCompanies.length}社`} /><Kpi label="休止加盟店数" value={`${kpis.suspendedCompanies.length}社`} /><Kpi label="解約加盟店数" value={`${kpis.terminatedCompanies.length}社`} />
          <Kpi label="FC継続率" value={`${kpis.continuityRate}%`} /><Kpi label="平均加盟期間" value={kpis.franchiseCompanies.length ? getMonthsBetween(kpis.franchiseCompanies[0]?.contractStartDate) : '未設定'} /><Kpi label="今月加盟数" value={`${kpis.monthCompanies.length}社`} /><Kpi label="今月解約数" value={`${kpis.monthTerminated.length}社`} />
          <Kpi label="全加盟店合計売上" value={`${formatFareYen(kpis.totalSalesYen)}円`} /><Kpi label="今月売上" value={`${formatFareYen(kpis.monthSalesYen)}円`} /><Kpi label="今月案件数" value={`${kpis.monthCaseCount}件`} /><Kpi label="総ドライバー数" value={`${staffMembers.filter((staff) => staff.role === 'driver').length}人`} /><Kpi label="総車両数" value={`${vehicles.length}台`} />
        </div>
        <div className="hq-rankings"><Ranking title="加盟店別売上ランキング" items={rankingBySales.map((item) => [item.company.name, `${formatFareYen(item.monthSalesYen)}円`])} /><Ranking title="加盟店別案件数ランキング" items={rankingByCases.map((item) => [item.company.name, `${item.monthCaseCount}件`])} /><Ranking title="加盟店別平均単価ランキング" items={rankingByAverage.map((item) => [item.company.name, `${formatFareYen(item.monthCaseCount ? Math.round(item.monthSalesYen / item.monthCaseCount) : 0)}円`])} /><Ranking title="加盟店別成長率ランキング" items={rankingByGrowth.map((item, index) => [item.company.name, `${index + 1}位`])} /></div>
        <div className="hq-alerts"><h3>注意表示</h3>{alerts.length > 0 ? alerts.map((alert) => <p key={alert}>⚠ {alert}</p>) : <p>現在の注意表示はありません。</p>}</div>
      </section>

      <section className="admin-section" id="加盟店管理"><h2>加盟店登録・編集</h2><div className="settings-grid hq-form-grid"><Input label="加盟店ID" value={draftCompany.id} onChange={(value) => updateDraftCompany('id', value)} /><Input label="加盟店名" value={draftCompany.name} onChange={(value) => updateDraftCompany('name', value)} /><Input label="法人名または屋号" value={draftCompany.corporateName ?? ''} onChange={(value) => updateDraftCompany('corporateName', value)} /><Input label="代表者名" value={draftCompany.representativeName ?? draftCompany.ownerName} onChange={(value) => updateDraftCompany('representativeName', value)} /><Input label="代表者メールアドレス" value={draftCompany.email} onChange={(value) => updateDraftCompany('email', value)} /><Input label="代表者ログインID" value={ownerLoginDraft.userId} onChange={(value) => updateOwnerLoginDraft('userId', value)} /><Input label="初期パスワード" type="password" value={ownerLoginDraft.password} onChange={(value) => updateOwnerLoginDraft('password', value)} /><Input label="電話番号" value={draftCompany.phoneNumber} onChange={(value) => updateDraftCompany('phoneNumber', value)} /><Input label="主な営業エリア" value={draftCompany.area ?? ''} onChange={(value) => updateDraftCompany('area', value)} /><Input label="契約開始日" type="date" value={draftCompany.contractStartDate ?? ''} onChange={(value) => updateDraftCompany('contractStartDate', value)} /><Input label="契約終了日" type="date" value={draftCompany.contractEndDate ?? ''} onChange={(value) => updateDraftCompany('contractEndDate', value)} /><Input label="プラン" value={draftCompany.plan ?? ''} onChange={(value) => updateDraftCompany('plan', value)} /><Input label="月額料金" type="number" value={String(draftCompany.monthlyFee ?? 0)} onChange={(value) => updateDraftCompany('monthlyFee', Number(value) || 0)} /><Input label="初期費用" type="number" value={String(draftCompany.initialFee ?? 0)} onChange={(value) => updateDraftCompany('initialFee', Number(value) || 0)} /></div><label className="settings-textarea-label">所在地<textarea value={draftCompany.address} onChange={(event) => updateDraftCompany('address', event.target.value)} /></label><label className="settings-textarea-label">メモ<textarea value={draftCompany.memo} onChange={(event) => updateDraftCompany('memo', event.target.value)} /></label><button className="primary-action" type="button" onClick={handleCompanySave}>加盟店・代表者IDを登録</button><h2>加盟店一覧</h2><div className="admin-table-wrapper hq-table-wrapper"><table className="admin-table hq-company-table"><thead><tr>{['加盟店ID','加盟店名','代表者名','エリア','ステータス','契約開始日','加盟期間','プラン','月額料金','店舗数','従業員数','車両数','今月売上','今月案件数','最終ログイン','操作'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{companySummaries.map((summary) => <tr key={summary.company.id}><td>{getCompanyDisplayId(summary.company)}</td><td>{summary.company.name}</td><td>{summary.company.representativeName || summary.company.ownerName}</td><td>{summary.company.area || '未設定'}</td><td>{companyStatusLabels[summary.company.status ?? (summary.company.enabled ? 'active' : 'suspended')]}</td><td>{formatDate(summary.company.contractStartDate)}</td><td>{getMonthsBetween(summary.company.contractStartDate)}</td><td>{summary.company.plan || '未設定'}</td><td>{formatFareYen(summary.company.monthlyFee ?? 0)}円</td><td>{summary.storeCount}</td><td>{summary.staffCount}</td><td>{summary.vehicleCount}</td><td>{formatFareYen(summary.monthSalesYen)}円</td><td>{summary.monthCaseCount}</td><td>{summary.company.lastLoginAt || '未記録'}</td><td className="hq-actions"><button type="button" onClick={() => setSelectedCompanyId(summary.company.id)}>詳細</button><button type="button" onClick={() => { setDraftCompany(summary.company); setSelectedCompanyId(summary.company.id) }}>編集</button><button type="button" onClick={() => handleStatusChange(summary.company, 'suspended', '停止')}>停止</button><button type="button" onClick={() => handleStatusChange(summary.company, 'active', '再開')}>再開</button><button type="button" onClick={() => handleStatusChange(summary.company, 'terminated', '解約済みに変更')}>削除</button></td></tr>)}</tbody></table></div></section>

      <section className="admin-section" id="売上分析"><h2>売上分析</h2><div className="work-dashboard-grid"><div><span>全体売上</span><strong>{formatFareYen(kpis.totalSalesYen)}円</strong></div><div><span>月別売上</span><strong>{formatFareYen(kpis.monthSalesYen)}円</strong></div><div><span>案件数</span><strong>{caseRecords.length}件</strong></div><div><span>平均単価</span><strong>{formatFareYen(caseRecords.length ? Math.round(kpis.totalSalesYen / caseRecords.length) : 0)}円</strong></div><div><span>車両数</span><strong>{vehicles.length}台</strong></div><div><span>ドライバー数</span><strong>{staffMembers.filter((staff) => staff.role === 'driver').length}人</strong></div></div></section>
      <section className="admin-section" id="エリア分析"><h2>エリア分析</h2><div className="hq-rankings"><Ranking title="乗車地エリア別件数" items={areaItems(caseRecords, 'pickupArea')} /><Ranking title="降車地エリア別件数" items={areaItems(caseRecords, 'dropoffArea')} /><Ranking title="エリア別売上" items={areaSalesItems(caseRecords)} /><Ranking title="エリア別平均単価" items={areaAverageItems(caseRecords)} /></div><p className="empty-note">本部画面では個別住所一覧ではなく、乗車地・降車地エリア集計を優先表示します。</p></section>
      <section className="admin-section" id="契約・請求管理"><h2>契約・請求管理</h2><div className="admin-table-wrapper"><table className="admin-table"><thead><tr>{['加盟店名','契約開始日','契約終了日','契約ステータス','プラン','月額料金','初期費用','請求状態','最終請求月','支払状況','メモ'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{companies.map((company) => <tr key={company.id}><td>{company.name}</td><td>{formatDate(company.contractStartDate)}</td><td>{formatDate(company.contractEndDate)}</td><td>{company.contractStatus || '契約前'}</td><td>{company.plan || '未設定'}</td><td>{formatFareYen(company.monthlyFee ?? 0)}円</td><td>{formatFareYen(company.initialFee ?? 0)}円</td><td>{company.billingStatus || '未請求'}</td><td>{company.lastBillingMonth || '未設定'}</td><td>{company.paymentStatus || '未請求'}</td><td>{company.memo}</td></tr>)}</tbody></table></div></section>
      <section className="admin-section" id="従業員・アカウント管理"><h2>従業員・アカウント管理</h2><div className="admin-table-wrapper"><table className="admin-table"><thead><tr>{['従業員ID','氏名','所属加盟店','所属店舗','権限','メールアドレス','ログインID','状態','最終ログイン','登録日','退職日'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{staffMembers.map((staff) => <tr key={staff.id}><td>{staff.id}</td><td>{staff.name}</td><td>{companies.find((company) => company.id === staff.companyId)?.name || staff.companyId}</td><td>{staff.storeName}</td><td>{staff.role}</td><td>{staff.email}</td><td>{staff.loginId || staff.userId}</td><td>{staffStatusLabel(staff.status, staff.enabled)}</td><td>{staff.lastLoginAt || '未記録'}</td><td>{staff.joinedAt || '未記録'}</td><td>{staff.retiredAt || '－'}</td></tr>)}</tbody></table></div><p className="empty-note">従業員は物理削除せず、無効化・退職状態で過去案件、勤怠、領収書履歴との紐づけを保持します。</p></section>
      <section className="admin-section" id="FCノウハウ共有"><h2>FCノウハウ共有</h2><div className="work-dashboard-grid">{['開業準備','営業活動','ケアマネ営業','病院営業','料金設定','接客対応','事故防止','成功事例','システム操作'].map((category) => <div key={category}><span>カテゴリ</span><strong>{category}</strong></div>)}</div><p className="empty-note">FC本部は投稿作成・編集・削除・公開設定、加盟店側は閲覧・検索を行う方針です。</p></section>
      <section className="admin-section" id="システム設定"><h2>システム設定</h2><div className="work-dashboard-grid">{['ロール定義','権限設定','初期プラン設定','加盟店ステータス','契約ステータス','請求ステータス','FCノウハウカテゴリ','本部名称','本部連絡先'].map((item) => <div key={item}><span>本部専用</span><strong>{item}</strong></div>)}</div></section>
      <section className="admin-section"><h2>加盟店詳細</h2>{selectedCompany ? <div className="work-dashboard-grid"><div><span>加盟店ID</span><strong>{getCompanyDisplayId(selectedCompany)}</strong></div><div><span>加盟店名</span><strong>{selectedCompany.name}</strong></div><div><span>状態</span><strong>{companyStatusLabels[selectedCompany.status ?? (selectedCompany.enabled ? 'active' : 'suspended')]}</strong></div><div><span>メモ</span><strong>{selectedCompany.memo || '未記録'}</strong></div></div> : <p className="empty-note">加盟店を選択してください。</p>}</section>
    </main>
  )
}

function Kpi({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function Ranking({ items, title }: { items: Array<[string, string]>; title: string }) { return <section><h3>{title}</h3>{items.length > 0 ? <ol>{items.map(([label, value]) => <li key={`${title}-${label}`}><span>{label}</span><strong>{value}</strong></li>)}</ol> : <p>データなし</p>}</section> }
function Input({ label, onChange, type = 'text', value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) { return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function staffStatusLabel(status: StaffMember['status'], enabled: boolean) { if (status === 'retired') return '退職'; if (status === 'leave') return '休職中'; if (status === 'disabled' || !enabled) return '無効'; return '在籍中' }
function areaItems(records: StoredCaseRecord[], key: 'pickupArea' | 'dropoffArea'): Array<[string, string]> { const counts = new Map<string, number>(); records.forEach((record) => { const area = record[key] || '未設定'; counts.set(area, (counts.get(area) ?? 0) + 1) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, count]) => [area, `${count}件`]) }
function areaSalesItems(records: StoredCaseRecord[]): Array<[string, string]> { const counts = new Map<string, number>(); records.forEach((record) => { const area = record.pickupArea || '未設定'; counts.set(area, (counts.get(area) ?? 0) + record.totalFareYen) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, sales]) => [area, `${formatFareYen(sales)}円`]) }
function areaAverageItems(records: StoredCaseRecord[]): Array<[string, string]> { const totals = new Map<string, { count: number; sales: number }>(); records.forEach((record) => { const area = record.pickupArea || '未設定'; const current = totals.get(area) ?? { count: 0, sales: 0 }; totals.set(area, { count: current.count + 1, sales: current.sales + record.totalFareYen }) }); return [...totals.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 6).map(([area, summary]) => [area, `${formatFareYen(summary.count ? Math.round(summary.sales / summary.count) : 0)}円`]) }
