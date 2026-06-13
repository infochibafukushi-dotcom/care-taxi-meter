import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ensureDefaultCompany, fetchCompanies, saveCompany, updateCompanyStatus } from '../services/companies'
import { fetchCaseRecords } from '../services/caseRecords'
import { fetchStaffMembers, saveStaffMember } from '../services/staffMembers'
import { fetchStores, saveStore } from '../services/stores'
import { fetchVehicles } from '../services/vehicles'
import { useWorkSession } from '../hooks/useWorkSession'
import { loadAuthStaffSession } from '../services/authSession'
import { defaultFranchiseeId } from '../services/tenancy'
import { defaultHeadquartersInfo, fetchHeadquartersInfo, saveHeadquartersInfo } from '../services/hqSettings'
import type { HeadquartersInfo } from '../services/hqSettings'
import type { Company, CompanyStatus, StaffMember, Store, Vehicle } from '../types/work'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { resetHeadquartersDevelopmentData } from '../services/developmentReset'

const companyStatusLabels: Record<CompanyStatus, string> = {
  screening: '審査中',
  preparing: '開業準備中',
  active: '営業中',
  suspended: '休止中',
  ending: '解約予定',
  terminated: '解約済み',
  archived: '解約済み',
}

const editableCompanyStatuses: CompanyStatus[] = [
  'screening',
  'preparing',
  'active',
  'suspended',
  'ending',
  'terminated',
]

const createCompanyDraft = (sortOrder: number): Company => ({
  id: '',
  name: '',
  corporateName: '',
  representativeName: '',
  representativeLoginId: '',
  representativeInitialPassword: '',
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

type CompanySortKey = 'joinedAt' | 'membershipMonths' | 'name' | 'sales' | 'cases'

type CompanySummary = {
  activeDriverCount: number
  activeVehicleCount: number
  averageFareYen: number
  caseCount: number
  company: Company
  lastCaseAt: string
  monthCaseCount: number
  monthSalesYen: number
  previousMonthSalesYen: number
  salesYen: number
  staffCount: number
  storeCount: number
  todaySalesYen: number
  vehicleCount: number
  yearAgoMonthSalesYen: number
}

const createOwnerLoginDraft = (): OwnerLoginDraft => ({ password: '', userId: '' })

const getOwnerStaffForCompany = (staffMembers: StaffMember[], companyId: string) =>
  staffMembers.find((staffMember) => staffMember.companyId === companyId && staffMember.role === 'owner') ?? null

const createOwnerLoginDraftFromCompany = (company: Company, staffMembers: StaffMember[]): OwnerLoginDraft => {
  const ownerStaff = getOwnerStaffForCompany(staffMembers, company.id)
  return {
    password: ownerStaff?.password || company.representativeInitialPassword || '',
    userId: ownerStaff?.loginId || ownerStaff?.userId || company.representativeLoginId || '',
  }
}

const normalizeCompanyId = (value: string) =>
  value.trim().toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const getCompanyId = (company: Company) => normalizeCompanyId(company.id || company.name)
const isPlaceholderCompanyId = (value: string) => /^-+$/.test(value)
const getCompanyDisplayId = (company: Company) => isPlaceholderCompanyId(company.id) && company.name.trim() ? company.name : company.id
const getCompanyStatus = (company: Company): CompanyStatus => company.status ?? (company.enabled ? 'active' : 'suspended')
const isHeadquartersCompany = (company: Company) => company.id === defaultFranchiseeId || company.plan === 'FC本部'

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10)
const getMonthStart = (offsetMonths = 0) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1, 0, 0, 0))
}
const getDayStart = (offsetDays = 0) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, 0, 0, 0))
}
const isBetween = (value: string, start: Date, end: Date) => value >= start.toISOString() && value < end.toISOString()
const formatDate = (value?: string) => value || '未設定'
const formatPercent = (current: number, previous: number) => previous > 0 ? `${Math.round(((current - previous) / previous) * 100)}%` : '－'
const formatDiffYen = (current: number, previous: number) => `${current - previous >= 0 ? '+' : ''}${formatFareYen(current - previous)}円`

const getMembershipMonths = (start?: string, end = new Date()) => {
  if (!start) return 0
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime())) return 0
  return Math.max((end.getFullYear() - startDate.getFullYear()) * 12 + end.getMonth() - startDate.getMonth(), 0)
}

const formatMembership = (start?: string) => {
  const months = getMembershipMonths(start)
  if (!start) return '未設定'
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
  const [headquartersInfo, setHeadquartersInfo] = useState<HeadquartersInfo>(defaultHeadquartersInfo)
  const [draftCompany, setDraftCompany] = useState<Company>(createCompanyDraft(1))
  const [ownerLoginDraft, setOwnerLoginDraft] = useState<OwnerLoginDraft>(createOwnerLoginDraft())
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [sortKey, setSortKey] = useState<CompanySortKey>('joinedAt')
  const [message, setMessage] = useState('加盟店情報を読み込み中です。')
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      await ensureDefaultCompany()
      const [companyItems, storeItems, staffItems, vehicleItems, records, hqInfo] = await Promise.all([
        fetchCompanies(),
        fetchStores(),
        fetchStaffMembers(),
        fetchVehicles(),
        fetchCaseRecords(),
        fetchHeadquartersInfo(),
      ])
      const franchiseCompanyItems = companyItems.filter((company) => !isHeadquartersCompany(company))
      setCompanies(companyItems)
      setStores(storeItems)
      setStaffMembers(staffItems)
      setVehicles(vehicleItems)
      setCaseRecords(records)
      setHeadquartersInfo(hqInfo)
      setSelectedCompanyId((currentCompanyId) => currentCompanyId && franchiseCompanyItems.some((company) => company.id === currentCompanyId) ? currentCompanyId : franchiseCompanyItems[0]?.id || '')
      setDraftCompany(createCompanyDraft(franchiseCompanyItems.length + 1))
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
  const franchiseCompanies = useMemo(() => companies.filter((company) => !isHeadquartersCompany(company)), [companies])
  const franchiseCompanyIds = useMemo(() => new Set(franchiseCompanies.map((company) => company.id)), [franchiseCompanies])
  const franchiseCaseRecords = useMemo(() => caseRecords.filter((caseRecord) => franchiseCompanyIds.has(caseRecord.companyId)), [caseRecords, franchiseCompanyIds])
  const selectedCompany = franchiseCompanies.find((company) => company.id === selectedCompanyId) ?? null
  const currentMonthStart = getMonthStart(0)
  const nextMonthStart = getMonthStart(1)
  const previousMonthStart = getMonthStart(-1)
  const yearAgoMonthStart = getMonthStart(-12)
  const yearAgoNextMonthStart = getMonthStart(-11)
  const todayStart = getDayStart(0)
  const tomorrowStart = getDayStart(1)
  const thirtyDaysAgo = getDayStart(-30)

  const companySummaries = useMemo<CompanySummary[]>(() => franchiseCompanies.map((company) => {
    const companyStores = stores.filter((store) => store.companyId === company.id)
    const companyStaffMembers = staffMembers.filter((staffMember) => staffMember.companyId === company.id)
    const companyVehicles = vehicles.filter((vehicle) => vehicle.companyId === company.id)
    const companyRecords = franchiseCaseRecords.filter((caseRecord) => caseRecord.companyId === company.id)
    const monthRecords = companyRecords.filter((caseRecord) => isBetween(caseRecord.closedAt, currentMonthStart, nextMonthStart))
    const previousMonthRecords = companyRecords.filter((caseRecord) => isBetween(caseRecord.closedAt, previousMonthStart, currentMonthStart))
    const yearAgoMonthRecords = companyRecords.filter((caseRecord) => isBetween(caseRecord.closedAt, yearAgoMonthStart, yearAgoNextMonthStart))
    const todayRecords = companyRecords.filter((caseRecord) => isBetween(caseRecord.closedAt, todayStart, tomorrowStart))
    const monthSalesYen = monthRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    const previousMonthSalesYen = previousMonthRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    const yearAgoMonthSalesYen = yearAgoMonthRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    const salesYen = companyRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0)
    const lastCaseAt = companyRecords[0]?.closedAt ?? ''

    return {
      activeDriverCount: companyStaffMembers.filter((staffMember) => staffMember.role === 'driver' && staffMember.enabled).length,
      activeVehicleCount: companyVehicles.filter((vehicle) => vehicle.enabled && vehicle.status === '稼働中').length,
      averageFareYen: monthRecords.length > 0 ? Math.round(monthSalesYen / monthRecords.length) : 0,
      caseCount: companyRecords.length,
      company,
      lastCaseAt,
      monthCaseCount: monthRecords.length,
      monthSalesYen,
      previousMonthSalesYen,
      salesYen,
      staffCount: companyStaffMembers.length,
      storeCount: companyStores.length,
      todaySalesYen: todayRecords.reduce((total, caseRecord) => total + caseRecord.totalFareYen, 0),
      vehicleCount: companyVehicles.length,
      yearAgoMonthSalesYen,
    }
  }), [currentMonthStart, franchiseCaseRecords, franchiseCompanies, nextMonthStart, previousMonthStart, staffMembers, stores, todayStart, tomorrowStart, vehicles, yearAgoMonthStart, yearAgoNextMonthStart])

  const sortedCompanySummaries = useMemo(() => [...companySummaries].sort((a, b) => {
    if (sortKey === 'name') return a.company.name.localeCompare(b.company.name, 'ja')
    if (sortKey === 'sales') return b.monthSalesYen - a.monthSalesYen
    if (sortKey === 'cases') return b.monthCaseCount - a.monthCaseCount
    if (sortKey === 'membershipMonths') return getMembershipMonths(b.company.contractStartDate) - getMembershipMonths(a.company.contractStartDate)
    return (b.company.contractStartDate ?? '').localeCompare(a.company.contractStartDate ?? '')
  }), [companySummaries, sortKey])

  const selectedSummary = companySummaries.find((summary) => summary.company.id === selectedCompanyId) ?? null

  const kpis = useMemo(() => {
    const activeCompanies = franchiseCompanies.filter((company) => getCompanyStatus(company) === 'active')
    const suspendedCompanies = franchiseCompanies.filter((company) => getCompanyStatus(company) === 'suspended')
    const endingCompanies = franchiseCompanies.filter((company) => getCompanyStatus(company) === 'ending')
    const terminatedCompanies = franchiseCompanies.filter((company) => ['terminated', 'archived'].includes(getCompanyStatus(company)))
    const todaySalesYen = companySummaries.reduce((total, summary) => total + summary.todaySalesYen, 0)
    const monthSalesYen = companySummaries.reduce((total, summary) => total + summary.monthSalesYen, 0)
    const previousMonthSalesYen = companySummaries.reduce((total, summary) => total + summary.previousMonthSalesYen, 0)
    const totalCaseCount = companySummaries.reduce((total, summary) => total + summary.caseCount, 0)
    const totalSalesYen = companySummaries.reduce((total, summary) => total + summary.salesYen, 0)

    return {
      activeCompanies,
      averageFareYen: totalCaseCount > 0 ? Math.round(totalSalesYen / totalCaseCount) : 0,
      endingCompanies,
      monthSalesYen,
      previousMonthSalesYen,
      suspendedCompanies,
      terminatedCompanies,
      todaySalesYen,
      totalCaseCount,
      totalSalesYen,
    }
  }, [companySummaries, franchiseCompanies])

  const rankingBySales = [...companySummaries].sort((a, b) => b.monthSalesYen - a.monthSalesYen).slice(0, 5)
  const rankingByCases = [...companySummaries].sort((a, b) => b.monthCaseCount - a.monthCaseCount).slice(0, 5)
  const rankingByAverage = [...companySummaries].sort((a, b) => b.averageFareYen - a.averageFareYen).slice(0, 5)
  const rankingByGrowth = [...companySummaries].sort((a, b) => (b.monthSalesYen - b.previousMonthSalesYen) - (a.monthSalesYen - a.previousMonthSalesYen)).slice(0, 5)
  const alerts = [
    ...companySummaries.filter((summary) => summary.previousMonthSalesYen > 0 && summary.monthSalesYen < summary.previousMonthSalesYen * 0.7).map((summary) => `売上急減加盟店: ${summary.company.name}`),
    ...companySummaries.filter((summary) => !summary.lastCaseAt || summary.lastCaseAt < thirtyDaysAgo.toISOString()).map((summary) => `30日案件なし: ${summary.company.name}`),
    ...franchiseCompanies.filter((company) => getCompanyStatus(company) === 'suspended').map((company) => `休止中加盟店: ${company.name}`),
    ...franchiseCompanies.filter((company) => getCompanyStatus(company) === 'ending').map((company) => `解約予定加盟店: ${company.name}`),
    ...franchiseCompanies.filter((company) => company.billingStatus === '未払い' || company.paymentStatus === '未払い').map((company) => `未払い加盟店: ${company.name}`),
    ...franchiseCompanies.filter((company) => !company.lastLoginAt).map((company) => `ログインなし加盟店: ${company.name}`),
  ].slice(0, 10)

  const updateDraftCompany = (key: keyof Company, value: string | boolean | number) => setDraftCompany((currentCompany) => ({ ...currentCompany, [key]: value }))
  const updateHeadquartersInfo = (key: keyof HeadquartersInfo, value: string) => setHeadquartersInfo((currentInfo) => ({ ...currentInfo, [key]: value }))
  const updateOwnerLoginDraft = (key: keyof OwnerLoginDraft, value: string) => setOwnerLoginDraft((currentOwnerLogin) => ({ ...currentOwnerLogin, [key]: value }))

  const handleCompanySave = async () => {
    const companyId = getCompanyId(draftCompany)
    const companyName = draftCompany.name.trim()
    const ownerUserId = ownerLoginDraft.userId.trim() || draftCompany.representativeLoginId?.trim() || ''
    const ownerPassword = ownerLoginDraft.password.trim()
    const existingOwnerStaff = getOwnerStaffForCompany(staffMembers, companyId)
    const existingCompany = franchiseCompanies.find((company) => company.id === companyId) ?? null
    const isExistingCompany = existingCompany !== null
    if (!companyId || !companyName) { setMessage('加盟店IDと加盟店名を入力してください。'); return }
    if (!isExistingCompany && (!ownerUserId || !ownerPassword)) { setMessage('新規加盟店は代表ログインIDと初期パスワードを入力してください。'); return }
    if (isExistingCompany && ownerUserId && !ownerPassword && !existingOwnerStaff?.password) { setMessage('代表者ログインIDを保存する場合は初期パスワードも入力してください。'); return }

    const ownerName = draftCompany.representativeName?.trim() || draftCompany.ownerName.trim() || ownerUserId
    const nextStatus = draftCompany.status ?? 'screening'
    setMessage(isExistingCompany ? '加盟店情報を保存中です。' : '加盟店と代表アカウントを保存中です。')
    await saveCompany({
      ...draftCompany,
      id: companyId,
      name: companyName,
      ownerName,
      representativeName: ownerName,
      representativeLoginId: ownerUserId,
      representativeInitialPassword: ownerPassword || draftCompany.representativeInitialPassword || existingCompany?.representativeInitialPassword || '',
      enabled: ['screening', 'preparing', 'active', 'ending'].includes(nextStatus),
      status: nextStatus,
    })

    const initialStoreId = `${companyId}_main-store`
    const initialStoreName = companyName
    let ownerStore = stores.find((store) => store.companyId === companyId)

    if (!isExistingCompany) {
      ownerStore = await saveStore({ id: initialStoreId, companyId, franchiseeId: companyId, name: initialStoreName, storeName: initialStoreName, companyName, ownerName, address: draftCompany.address, phoneNumber: draftCompany.phoneNumber, email: draftCompany.email, status: 'active', enabled: true, isActive: true, sortOrder: 1 })
    } else {
      await updateCompanyStatus({ ...draftCompany, id: companyId }, nextStatus)
    }

    if (ownerUserId || (!isExistingCompany && ownerPassword)) {
      const ownerStaffId = existingOwnerStaff?.id || `${companyId}_owner`
      await saveStaffMember({
        id: ownerStaffId,
        companyId,
        franchiseeId: companyId,
        storeId: existingOwnerStaff?.storeId || ownerStore?.id || initialStoreId,
        storeName: existingOwnerStaff?.storeName || ownerStore?.name || initialStoreName,
        userId: ownerUserId || existingOwnerStaff?.userId || ownerStaffId,
        loginId: ownerUserId || existingOwnerStaff?.loginId || existingOwnerStaff?.userId || ownerStaffId,
        password: ownerPassword || existingOwnerStaff?.password || '',
        name: ownerName,
        role: 'owner',
        canDrive: existingOwnerStaff?.canDrive ?? true,
        isActive: true,
        status: existingOwnerStaff?.status ?? 'employed',
        phoneNumber: draftCompany.phoneNumber,
        email: draftCompany.email,
        address: draftCompany.address,
        licenseNumber: existingOwnerStaff?.licenseNumber || '',
        licenseExpiresAt: existingOwnerStaff?.licenseExpiresAt || '',
        accidentHistory: existingOwnerStaff?.accidentHistory || '',
        memo: existingOwnerStaff?.memo || '加盟店代表者登録・ID発行で作成したオーナーアカウント',
        enabled: true,
        sortOrder: existingOwnerStaff?.sortOrder || 1,
      })
    }

    await loadData()
    setSelectedCompanyId(companyId)
    setMessage(isExistingCompany ? '加盟店情報を保存しました。' : '加盟店と代表者IDを保存しました。')
  }

  const handleHeadquartersInfoSave = async () => {
    setMessage('本部情報を保存中です。')
    try {
      const savedInfo = await saveHeadquartersInfo(headquartersInfo)
      setHeadquartersInfo(savedInfo)
      setMessage('本部情報を保存しました。')
    } catch (error) {
      setMessage(error instanceof Error ? `本部情報を保存できませんでした。${error.message}` : '本部情報を保存できませんでした。')
    }
  }

  const handleDevelopmentDataReset = async () => {
    const confirmed = window.confirm('加盟店・売上・勤務・従業員・車両データを削除し、FC本部の初期データのみ再作成します。実行しますか？')
    if (!confirmed) return
    setMessage('データをリセット中です。')
    try {
      const summary = await resetHeadquartersDevelopmentData()
      await loadData()
      setSelectedCompanyId('')
      setMessage(`データをリセットしました。削除件数: ${Object.values(summary.deletedByCollection).reduce((total, count) => total + count, 0)}件`)
    } catch (error) {
      setMessage(error instanceof Error ? `データリセットに失敗しました。${error.message}` : 'データリセットに失敗しました。')
    }
  }

  if (!isHqAdmin) {
    return (
      <main className="page page--admin page--hq" aria-labelledby="hq-title">
        <section className="admin-section">
          <p className="eyebrow">FC本部管理システム</p>
          <h1 id="hq-title">アクセス権限がありません</h1>
          <p className="case-error">FC本部管理画面は hq_admin のみ利用できます。</p>
          <Link className="secondary-action" to="/">TOPへ戻る</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page page--admin page--hq hq-desktop" aria-labelledby="hq-title">
      <section className="admin-section hq-hero">
        <div>
          <p className="eyebrow">FC本部管理システム</p>
          <h1 id="hq-title">株式会社千葉福祉サポート</h1>
          <p className="lead">FC本部として加盟店を管理・分析・支援する画面です。FC本部は加盟店一覧、ランキング、契約管理の対象外です。</p>
        </div>
        <button className="secondary-action" type="button" onClick={handleDevelopmentDataReset}>開発データリセット</button>
      </section>
      <nav className="hq-menu" aria-label="FC本部メニュー">
        {['ダッシュボード','加盟店管理','売上分析','エリア分析','契約・請求管理','従業員・アカウント管理','FCノウハウ共有','システム設定'].map((item) => <a key={item} href={`#${item}`}>{item}</a>)}
      </nav>
      <p className="save-note">{isLoading ? '読み込み中です。' : message}</p>

      <section className="admin-section" id="ダッシュボード">
        <h2>KPI</h2>
        <div className="hq-kpi-grid">
          <Kpi label="本日売上" value={`${formatFareYen(kpis.todaySalesYen)}円`} />
          <Kpi label="今月売上" value={`${formatFareYen(kpis.monthSalesYen)}円`} />
          <Kpi label="前月売上" value={`${formatFareYen(kpis.previousMonthSalesYen)}円`} />
          <Kpi label="前月比" value={formatPercent(kpis.monthSalesYen, kpis.previousMonthSalesYen)} />
          <Kpi label="加盟店数" value={`${franchiseCompanies.length}社`} />
          <Kpi label="稼働加盟店数" value={`${kpis.activeCompanies.length}社`} />
          <Kpi label="休止加盟店数" value={`${kpis.suspendedCompanies.length}社`} />
          <Kpi label="解約予定加盟店数" value={`${kpis.endingCompanies.length}社`} />
          <Kpi label="解約加盟店数" value={`${kpis.terminatedCompanies.length}社`} />
          <Kpi label="総案件数" value={`${kpis.totalCaseCount}件`} />
          <Kpi label="平均単価" value={`${formatFareYen(kpis.averageFareYen)}円`} />
          <Kpi label="総車両数" value={`${vehicles.filter((vehicle) => franchiseCompanyIds.has(vehicle.companyId)).length}台`} />
          <Kpi label="総従業員数" value={`${staffMembers.filter((staff) => franchiseCompanyIds.has(staff.companyId)).length}人`} />
        </div>
        <div className="hq-rankings">
          <Ranking title="加盟店別売上ランキング" items={rankingBySales.map((item) => [item.company.name, `${formatFareYen(item.monthSalesYen)}円`])} />
          <Ranking title="加盟店別案件数ランキング" items={rankingByCases.map((item) => [item.company.name, `${item.monthCaseCount}件`])} />
          <Ranking title="加盟店別平均単価ランキング" items={rankingByAverage.map((item) => [item.company.name, `${formatFareYen(item.averageFareYen)}円`])} />
          <Ranking title="加盟店別成長率ランキング" items={rankingByGrowth.map((item) => [item.company.name, formatDiffYen(item.monthSalesYen, item.previousMonthSalesYen)])} />
        </div>
        <div className="hq-alerts">
          <h3>注意表示</h3>
          {alerts.length > 0 ? alerts.map((alert) => <p key={alert}>⚠ {alert}</p>) : <p>現在の注意表示はありません。</p>}
        </div>
      </section>

      <section className="admin-section" id="加盟店管理">
        <h2>加盟店登録・編集</h2>
        <div className="settings-grid hq-form-grid">
          <Input label="加盟店ID" value={draftCompany.id} onChange={(value) => updateDraftCompany('id', value)} />
          <Input label="屋号名" value={draftCompany.name} onChange={(value) => updateDraftCompany('name', value)} />
          <Input label="会社名（法人名）" value={draftCompany.corporateName ?? ''} onChange={(value) => updateDraftCompany('corporateName', value)} />
          <Input label="代表者名" value={draftCompany.representativeName ?? draftCompany.ownerName} onChange={(value) => updateDraftCompany('representativeName', value)} />
          <Input label="代表者メールアドレス" value={draftCompany.email} onChange={(value) => updateDraftCompany('email', value)} />
          <Input label="代表者ログインID" value={ownerLoginDraft.userId} onChange={(value) => { updateOwnerLoginDraft('userId', value); updateDraftCompany('representativeLoginId', value) }} />
          <Input label="初期パスワード" type="password" value={ownerLoginDraft.password} onChange={(value) => { updateOwnerLoginDraft('password', value); updateDraftCompany('representativeInitialPassword', value) }} />
          <Input label="電話番号" value={draftCompany.phoneNumber} onChange={(value) => updateDraftCompany('phoneNumber', value)} />
          <Input label="主な営業エリア" value={draftCompany.area ?? ''} onChange={(value) => updateDraftCompany('area', value)} />
          <Input label="加盟日" type="date" value={draftCompany.contractStartDate ?? ''} onChange={(value) => updateDraftCompany('contractStartDate', value)} />
          <Input label="契約終了日" type="date" value={draftCompany.contractEndDate ?? ''} onChange={(value) => updateDraftCompany('contractEndDate', value)} />
          <Input label="プラン" value={draftCompany.plan ?? ''} onChange={(value) => updateDraftCompany('plan', value)} />
          <Input label="月額料金" type="number" value={String(draftCompany.monthlyFee ?? 0)} onChange={(value) => updateDraftCompany('monthlyFee', Number(value) || 0)} />
          <Input label="初期費用" type="number" value={String(draftCompany.initialFee ?? 0)} onChange={(value) => updateDraftCompany('initialFee', Number(value) || 0)} />
          <label>
            加盟店ステータス
            <select value={draftCompany.status ?? 'screening'} onChange={(event) => updateDraftCompany('status', event.target.value)}>
              {editableCompanyStatuses.map((status) => <option key={status} value={status}>{companyStatusLabels[status]}</option>)}
            </select>
          </label>
        </div>
        <label className="settings-textarea-label">所在地<textarea value={draftCompany.address} onChange={(event) => updateDraftCompany('address', event.target.value)} /></label>
        <label className="settings-textarea-label">メモ<textarea value={draftCompany.memo} onChange={(event) => updateDraftCompany('memo', event.target.value)} /></label>
        <div className="hq-form-actions">
          <button className="primary-action" type="button" onClick={handleCompanySave}>加盟店情報を保存</button>
          <button className="secondary-action" type="button" onClick={() => { setDraftCompany(createCompanyDraft(franchiseCompanies.length + 1)); setOwnerLoginDraft(createOwnerLoginDraft()) }}>新規入力に戻す</button>
        </div>

        <div className="hq-list-toolbar">
          <h2>加盟店一覧</h2>
          <label>
            並び替え
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as CompanySortKey)}>
              <option value="name">加盟店名</option>
              <option value="sales">売上</option>
              <option value="cases">案件数</option>
              <option value="joinedAt">加盟日</option>
              <option value="membershipMonths">加盟期間</option>
            </select>
          </label>
        </div>
        <div className="admin-table-wrapper hq-table-wrapper">
          <table className="admin-table hq-company-table">
            <thead>
              <tr>{['加盟店ID','加盟店名','代表者名','エリア','加盟日','加盟期間','プラン','ステータス','店舗数','従業員数','車両数','今月売上','今月案件数','最終ログイン','操作'].map((head) => <th key={head}>{head}</th>)}</tr>
            </thead>
            <tbody>
              {sortedCompanySummaries.map((summary) => (
                <tr key={summary.company.id}>
                  <td>{getCompanyDisplayId(summary.company)}</td>
                  <td>{summary.company.name}</td>
                  <td>{summary.company.representativeName || summary.company.ownerName}</td>
                  <td>{summary.company.area || '未設定'}</td>
                  <td>{formatDate(summary.company.contractStartDate)}</td>
                  <td>{formatMembership(summary.company.contractStartDate)}</td>
                  <td>{summary.company.plan || '未設定'}</td>
                  <td><StatusBadge status={getCompanyStatus(summary.company)} /></td>
                  <td>{summary.storeCount}</td>
                  <td>{summary.staffCount}</td>
                  <td>{summary.vehicleCount}</td>
                  <td>{formatFareYen(summary.monthSalesYen)}円</td>
                  <td>{summary.monthCaseCount}</td>
                  <td>{summary.company.lastLoginAt || '未記録'}</td>
                  <td className="hq-actions">
                    <button type="button" onClick={() => setSelectedCompanyId(summary.company.id)}>詳細</button>
                    <button type="button" onClick={() => { setDraftCompany(summary.company); setSelectedCompanyId(summary.company.id); setOwnerLoginDraft(createOwnerLoginDraftFromCompany(summary.company, staffMembers)) }}>編集</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section" id="売上分析">
        <h2>売上分析</h2>
        <div className="work-dashboard-grid">
          <div><span>全体売上</span><strong>{formatFareYen(kpis.totalSalesYen)}円</strong></div>
          <div><span>今月売上</span><strong>{formatFareYen(kpis.monthSalesYen)}円</strong></div>
          <div><span>前月売上</span><strong>{formatFareYen(kpis.previousMonthSalesYen)}円</strong></div>
          <div><span>総案件数</span><strong>{kpis.totalCaseCount}件</strong></div>
          <div><span>平均単価</span><strong>{formatFareYen(kpis.averageFareYen)}円</strong></div>
          <div><span>支払方法別売上</span><strong>{paymentMethodSummary(franchiseCaseRecords)}</strong></div>
        </div>
      </section>

      <section className="admin-section" id="エリア分析">
        <h2>エリア分析</h2>
        <div className="hq-rankings">
          <Ranking title="乗車地エリア別件数" items={areaItems(franchiseCaseRecords, 'pickupArea')} />
          <Ranking title="降車地エリア別件数" items={areaItems(franchiseCaseRecords, 'dropoffArea')} />
          <Ranking title="エリア別売上" items={areaSalesItems(franchiseCaseRecords)} />
          <Ranking title="エリア別平均単価" items={areaAverageItems(franchiseCaseRecords)} />
        </div>
        <p className="empty-note">FC本部は集計から除外し、加盟店データのみでエリア分析します。</p>
      </section>

      <section className="admin-section" id="契約・請求管理">
        <h2>契約・請求管理</h2>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead><tr>{['加盟店名','契約開始日','契約終了日','契約ステータス','プラン','月額料金','初期費用','請求状態','最終請求月','支払状況','メモ'].map((head) => <th key={head}>{head}</th>)}</tr></thead>
            <tbody>{franchiseCompanies.map((company) => <tr key={company.id}><td>{company.name}</td><td>{formatDate(company.contractStartDate)}</td><td>{formatDate(company.contractEndDate)}</td><td>{company.contractStatus || '契約前'}</td><td>{company.plan || '未設定'}</td><td>{formatFareYen(company.monthlyFee ?? 0)}円</td><td>{formatFareYen(company.initialFee ?? 0)}円</td><td>{company.billingStatus || '未請求'}</td><td>{company.lastBillingMonth || '未設定'}</td><td>{company.paymentStatus || '未請求'}</td><td>{company.memo}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="admin-section" id="従業員・アカウント管理">
        <h2>従業員・アカウント管理</h2>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead><tr>{['従業員ID','氏名','所属加盟店','所属店舗','権限','メールアドレス','ログインID','状態','最終ログイン','登録日','退職日'].map((head) => <th key={head}>{head}</th>)}</tr></thead>
            <tbody>{staffMembers.filter((staff) => franchiseCompanyIds.has(staff.companyId)).map((staff) => <tr key={staff.id}><td>{staff.id}</td><td>{staff.name}</td><td>{franchiseCompanies.find((company) => company.id === staff.companyId)?.name || staff.companyId}</td><td>{staff.storeName}</td><td>{staff.role}</td><td>{staff.email}</td><td>{staff.loginId || staff.userId}</td><td>{staffStatusLabel(staff.status, staff.enabled)}</td><td>{staff.lastLoginAt || '未記録'}</td><td>{staff.joinedAt || '未記録'}</td><td>{staff.retiredAt || '－'}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="empty-note">従業員は物理削除せず、無効化・退職状態で過去案件、勤怠、領収書履歴との紐づけを保持します。</p>
      </section>

      <section className="admin-section" id="FCノウハウ共有">
        <h2>FCノウハウ共有</h2>
        <div className="work-dashboard-grid">{['開業準備','営業活動','ケアマネ営業','病院営業','料金設定','接客対応','事故防止','成功事例','システム操作'].map((category) => <div key={category}><span>カテゴリ</span><strong>{category}</strong></div>)}</div>
        <p className="empty-note">FC本部は投稿作成・編集・削除・公開設定、加盟店側は閲覧・検索を行う方針です。</p>
      </section>

      <section className="admin-section" id="システム設定">
        <h2>システム設定</h2>
        <section className="hq-settings-panel">
          <h3>本部情報</h3>
          <div className="settings-grid hq-form-grid">
            <Input label="本部名称" value={headquartersInfo.name} onChange={(value) => updateHeadquartersInfo('name', value)} />
            <Input label="代表者名" value={headquartersInfo.representativeName} onChange={(value) => updateHeadquartersInfo('representativeName', value)} />
            <Input label="電話番号" value={headquartersInfo.phoneNumber} onChange={(value) => updateHeadquartersInfo('phoneNumber', value)} />
            <Input label="メールアドレス" value={headquartersInfo.email} onChange={(value) => updateHeadquartersInfo('email', value)} />
          </div>
          <label className="settings-textarea-label">所在地<textarea value={headquartersInfo.address} onChange={(event) => updateHeadquartersInfo('address', event.target.value)} /></label>
          <label className="settings-textarea-label">メモ<textarea value={headquartersInfo.memo} onChange={(event) => updateHeadquartersInfo('memo', event.target.value)} /></label>
          <button className="primary-action" type="button" onClick={handleHeadquartersInfoSave}>本部情報を保存</button>
        </section>
        <div className="work-dashboard-grid">{['ロール定義','権限設定','初期プラン設定','加盟店ステータス','契約ステータス','請求ステータス','FCノウハウカテゴリ','本部連絡先'].map((item) => <div key={item}><span>本部専用</span><strong>{item}</strong></div>)}</div>
      </section>

      <section className="admin-section">
        <h2>加盟店カルテ</h2>
        {selectedCompany && selectedSummary ? (
          <div className="hq-company-profile">
            <ProfileBlock title="基本情報" rows={[
              ['加盟店名', selectedCompany.name],
              ['代表者', selectedCompany.representativeName || selectedCompany.ownerName || '未設定'],
              ['エリア', selectedCompany.area || '未設定'],
              ['加盟日', formatDate(selectedCompany.contractStartDate)],
              ['加盟期間', formatMembership(selectedCompany.contractStartDate)],
              ['ステータス', companyStatusLabels[getCompanyStatus(selectedCompany)]],
              ['プラン', selectedCompany.plan || '未設定'],
              ['月額料金', `${formatFareYen(selectedCompany.monthlyFee ?? 0)}円`],
              ['店舗数', `${selectedSummary.storeCount}店舗`],
              ['従業員数', `${selectedSummary.staffCount}人`],
              ['車両数', `${selectedSummary.vehicleCount}台`],
            ]} />
            <ProfileBlock title="売上情報" rows={[
              ['今月売上', `${formatFareYen(selectedSummary.monthSalesYen)}円`],
              ['前月売上', `${formatFareYen(selectedSummary.previousMonthSalesYen)}円`],
              ['前年差', formatDiffYen(selectedSummary.monthSalesYen, selectedSummary.yearAgoMonthSalesYen)],
              ['前月比', formatPercent(selectedSummary.monthSalesYen, selectedSummary.previousMonthSalesYen)],
              ['平均単価', `${formatFareYen(selectedSummary.averageFareYen)}円`],
              ['案件数', `${selectedSummary.monthCaseCount}件`],
            ]} />
            <ProfileBlock title="利用状況" rows={[
              ['最終ログイン', selectedCompany.lastLoginAt || '未記録'],
              ['最終案件日', selectedSummary.lastCaseAt ? toDateInputValue(new Date(selectedSummary.lastCaseAt)) : '未記録'],
              ['稼働ドライバー数', `${selectedSummary.activeDriverCount}人`],
              ['稼働車両数', `${selectedSummary.activeVehicleCount}台`],
            ]} />
            <ProfileBlock title="契約情報" rows={[
              ['契約開始日', formatDate(selectedCompany.contractStartDate)],
              ['契約終了日', formatDate(selectedCompany.contractEndDate)],
              ['契約状態', selectedCompany.contractStatus || '契約前'],
              ['請求状態', selectedCompany.billingStatus || '未請求'],
              ['メモ', selectedCompany.memo || '未記録'],
            ]} />
          </div>
        ) : (
          <p className="empty-note">加盟店を選択してください。</p>
        )}
      </section>
    </main>
  )
}

function Kpi({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function Ranking({ items, title }: { items: Array<[string, string]>; title: string }) { return <section><h3>{title}</h3>{items.length > 0 ? <ol>{items.map(([label, value]) => <li key={`${title}-${label}`}><span>{label}</span><strong>{value}</strong></li>)}</ol> : <p>データなし</p>}</section> }
function Input({ label, onChange, type = 'text', value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) { return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function StatusBadge({ status }: { status: CompanyStatus }) { return <span className={`hq-status-badge hq-status-badge--${status}`}>{companyStatusLabels[status]}</span> }
function ProfileBlock({ rows, title }: { rows: Array<[string, string]>; title: string }) { return <section><h3>{title}</h3>{rows.map(([label, value]) => <div key={`${title}-${label}`}><span>{label}</span><strong>{value}</strong></div>)}</section> }
function staffStatusLabel(status: StaffMember['status'], enabled: boolean) { if (status === 'retired') return '退職'; if (status === 'leave') return '休職中'; if (status === 'disabled' || !enabled) return '無効'; return '在籍中' }
function areaItems(records: StoredCaseRecord[], key: 'pickupArea' | 'dropoffArea'): Array<[string, string]> { const counts = new Map<string, number>(); records.forEach((record) => { const area = record[key] || '未設定'; counts.set(area, (counts.get(area) ?? 0) + 1) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, count]) => [area, `${count}件`]) }
function areaSalesItems(records: StoredCaseRecord[]): Array<[string, string]> { const counts = new Map<string, number>(); records.forEach((record) => { const area = record.pickupArea || '未設定'; counts.set(area, (counts.get(area) ?? 0) + record.totalFareYen) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, sales]) => [area, `${formatFareYen(sales)}円`]) }
function areaAverageItems(records: StoredCaseRecord[]): Array<[string, string]> { const totals = new Map<string, { count: number; sales: number }>(); records.forEach((record) => { const area = record.pickupArea || '未設定'; const current = totals.get(area) ?? { count: 0, sales: 0 }; totals.set(area, { count: current.count + 1, sales: current.sales + record.totalFareYen }) }); return [...totals.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 6).map(([area, summary]) => [area, `${formatFareYen(summary.count ? Math.round(summary.sales / summary.count) : 0)}円`]) }
function paymentMethodSummary(records: StoredCaseRecord[]) { const totals = new Map<string, number>(); records.forEach((record) => totals.set(record.paymentMethod, (totals.get(record.paymentMethod) ?? 0) + record.totalFareYen)); return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([method, sales]) => `${method}:${formatFareYen(sales)}円`).join(' / ') || '未集計' }
