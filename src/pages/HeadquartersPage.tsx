import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ensureDefaultCompany, fetchCompanies, migrateCompaniesSubscriptionPlans, saveCompany, updateCompanyStatus } from '../services/companies'
import { fetchCaseRecords } from '../services/caseRecords'
import { fetchStaffMembers, saveStaffMember } from '../services/staffMembers'
import { fetchStores, saveStore } from '../services/stores'
import { fetchVehicles } from '../services/vehicles'
import { useWorkSession } from '../hooks/useWorkSession'
import { clearAuthStaffSession, loadAuthStaffSession, saveHqViewingSession } from '../services/authSession'
import { defaultFranchiseeId } from '../services/tenancy'
import { defaultHeadquartersInfo, fetchHeadquartersInfo, saveHeadquartersInfo } from '../services/hqSettings'
import type { HeadquartersInfo } from '../services/hqSettings'
import type { Company, CompanyStatus, StaffMember, Store, Vehicle } from '../types/work'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import { getActualFareYen } from '../utils/caseRecords'
import { resetHeadquartersDevelopmentData } from '../services/developmentReset'
import {
  applySubscriptionPlanToCompany,
  defaultSubscriptionPlan,
  formatPermissionIndicator,
  getSubscriptionPlanLabel,
  getSubscriptionPlanMonthlyFee,
  isSubscriptionPlan,
  subscriptionPlanDefinitions,
} from '../services/subscriptionPlans'
import type { SubscriptionPlan } from '../types/work'
import {
  DEVICE_UNSET_LABEL,
  formatDeviceModel,
  getObdModelOptions,
  getPrinterModelOptions,
} from '../constants/deviceModels'

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

const createCompanyDraft = (sortOrder: number): Company =>
  applySubscriptionPlanToCompany(
    {
      id: '',
      name: '',
      corporateName: '',
      representativeName: '',
      representativeLoginId: '',
      representativeInitialPassword: '',
      area: '',
      status: 'screening',
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
      postalCode: '',
      invoiceNumber: '',
      email: '',
      address: '',
      memo: '',
    },
    defaultSubscriptionPlan,
  )

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
  previousMonthCaseCount: number
  salesYen: number
  staffCount: number
  storeCount: number
  todaySalesYen: number
  vehicleCount: number
  yearAgoMonthSalesYen: number
  yearAgoMonthCaseCount: number
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
const formatRate = (value: number) => `${Math.round(value)}%`
const toDateString = (value?: string) => value ? toDateInputValue(new Date(value)) : '未記録'
const getDaysSince = (value?: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(Math.floor((Date.now() - date.getTime()) / 86400000), 0)
}

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
  const navigate = useNavigate()
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
      const migratedCount = await migrateCompaniesSubscriptionPlans()
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
      setMessage(migratedCount > 0 ? `加盟店情報を読み込みました。${migratedCount}件の契約プランを初期化しました。` : '加盟店情報を読み込みました。')
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
    const monthSalesYen = monthRecords.reduce((total, caseRecord) => total + getActualFareYen(caseRecord), 0)
    const previousMonthSalesYen = previousMonthRecords.reduce((total, caseRecord) => total + getActualFareYen(caseRecord), 0)
    const yearAgoMonthSalesYen = yearAgoMonthRecords.reduce((total, caseRecord) => total + getActualFareYen(caseRecord), 0)
    const salesYen = companyRecords.reduce((total, caseRecord) => total + getActualFareYen(caseRecord), 0)
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
      previousMonthCaseCount: previousMonthRecords.length,
      salesYen,
      staffCount: companyStaffMembers.length,
      storeCount: companyStores.length,
      todaySalesYen: todayRecords.reduce((total, caseRecord) => total + getActualFareYen(caseRecord), 0),
      vehicleCount: companyVehicles.length,
      yearAgoMonthSalesYen,
      yearAgoMonthCaseCount: yearAgoMonthRecords.length,
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
    const retainedCompanies = franchiseCompanies.filter((company) => !['terminated', 'archived'].includes(getCompanyStatus(company)))
    const monthSalesYen = companySummaries.reduce((total, summary) => total + summary.monthSalesYen, 0)
    const monthCaseCount = companySummaries.reduce((total, summary) => total + summary.monthCaseCount, 0)
    const totalMembershipMonths = franchiseCompanies.reduce((total, company) => total + getMembershipMonths(company.contractStartDate), 0)
    const monthlyFranchiseFeeYen = franchiseCompanies.reduce((total, company) => total + (company.monthlyFee ?? 0), 0)

    return {
      activeCompanies,
      averageFareYen: monthCaseCount > 0 ? Math.round(monthSalesYen / monthCaseCount) : 0,
      averageMembershipMonths: franchiseCompanies.length > 0 ? Math.round(totalMembershipMonths / franchiseCompanies.length) : 0,
      monthCaseCount,
      monthSalesYen,
      monthlyFranchiseFeeYen,
      retentionRate: franchiseCompanies.length > 0 ? (retainedCompanies.length / franchiseCompanies.length) * 100 : 0,
    }
  }, [companySummaries, franchiseCompanies])

  const rankingBySales = [...companySummaries].sort((a, b) => b.monthSalesYen - a.monthSalesYen).slice(0, 5)
  const rankingByGrowth = [...companySummaries].sort((a, b) => growthRate(b.monthSalesYen, b.yearAgoMonthSalesYen) - growthRate(a.monthSalesYen, a.yearAgoMonthSalesYen)).slice(0, 5)
  const rankingByMembership = [...companySummaries].sort((a, b) => getMembershipMonths(b.company.contractStartDate) - getMembershipMonths(a.company.contractStartDate)).slice(0, 5)
  const supportTargets = companySummaries.map((summary) => ({ summary, reasons: supportReasons(summary, thirtyDaysAgo) })).filter((item) => item.reasons.length > 0)
  const planItems = planRatioItems(franchiseCompanies)
  const areaRanking = areaCompanyItems(franchiseCompanies)
  const salesCategoryItems = salesCategoryRatioItems(franchiseCaseRecords)
  const franchiseRevenueItems = planRevenueRatioItems(franchiseCompanies)
  const planRevenueRanking = planRevenueItems(franchiseCompanies)

  const updateDraftCompany = (key: keyof Company, value: string | boolean | number) => setDraftCompany((currentCompany) => ({ ...currentCompany, [key]: value }))
  const updateDraftSubscriptionPlan = (plan: SubscriptionPlan) => setDraftCompany((currentCompany) => applySubscriptionPlanToCompany(currentCompany, plan))
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
    const subscriptionPlan = isSubscriptionPlan(draftCompany.subscriptionPlan)
      ? draftCompany.subscriptionPlan
      : defaultSubscriptionPlan
    const companyToSave = applySubscriptionPlanToCompany(
      {
        ...draftCompany,
        id: companyId,
        name: companyName,
        ownerName,
        representativeName: ownerName,
        representativeLoginId: ownerUserId,
        representativeInitialPassword: ownerPassword || draftCompany.representativeInitialPassword || existingCompany?.representativeInitialPassword || '',
        enabled: ['screening', 'preparing', 'active', 'ending'].includes(nextStatus),
        status: nextStatus,
      },
      subscriptionPlan,
    )
    setMessage(isExistingCompany ? '加盟店情報を保存中です。' : '加盟店と代表アカウントを保存中です。')
    await saveCompany(companyToSave)

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

  const handleLogout = () => {
    workSession.logout()
    clearAuthStaffSession()
    sessionStorage.clear()
    localStorage.clear()
    navigate('/')
  }

  const handleOpenCompanyTop = (summary: CompanySummary) => {
    const ownerStaff = getOwnerStaffForCompany(staffMembers, summary.company.id)
    const ownerStore = stores.find((store) => store.companyId === summary.company.id)
    saveHqViewingSession({
      companyId: summary.company.id,
      franchiseeId: summary.company.franchiseeId || summary.company.id,
      id: ownerStaff?.id || `${summary.company.id}_hq_viewer`,
      name: ownerStaff?.name || summary.company.representativeName || summary.company.ownerName || 'FC本部閲覧',
      role: 'owner',
      storeId: ownerStaff?.storeId || ownerStore?.id || `${summary.company.id}_main-store`,
      storeName: ownerStaff?.storeName || ownerStore?.name || summary.company.name,
    }, summary.company.name, authSession, '/hq')
    navigate('/owner')
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
        <div className="hq-hero-actions">
          <span>管理者：{authSession?.name || workSession.currentSession?.staffName || '未設定'}</span>
          <button className="secondary-action" type="button" onClick={handleLogout}>ログアウト</button>
          <button className="secondary-action" type="button" onClick={handleDevelopmentDataReset}>開発データリセット</button>
        </div>
      </section>
      <nav className="hq-menu" aria-label="FC本部メニュー">
        {['要対応加盟店','FC全体KPI','加盟店管理','FC収益分析','売上分析','エリア分析','ランキング','管理者設定'].map((item) => <a key={item} href={`#${item}`}>{item}</a>)}
      </nav>
      <p className="save-note">{isLoading ? '読み込み中です。' : message}</p>

      <section className="admin-section hq-priority" id="要対応加盟店">
        <h2>要対応加盟店</h2>
        <p className="empty-note">30日以上案件なし、前月比50%以上減少、14日以上ログインなし、面談予定日超過を優先表示します。</p>
        {supportTargets.length > 0 ? (
          <div className="hq-support-grid">
            {supportTargets.map(({ summary, reasons }) => (
              <article className="hq-support-card" key={summary.company.id}>
                <h3>⚠ {summary.company.name}</h3>
                <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                <button type="button" onClick={() => setSelectedCompanyId(summary.company.id)}>加盟店詳細</button><button type="button" onClick={() => handleOpenCompanyTop(summary)}>加盟店TOP確認</button>
              </article>
            ))}
          </div>
        ) : <p className="empty-note">現在、要対応加盟店はありません。</p>}
      </section>

      <section className="admin-section" id="FC全体KPI">
        <h2>FC全体KPI</h2>
        <div className="hq-kpi-grid">
          <Kpi label="加盟店数" value={`${franchiseCompanies.length}社`} />
          <Kpi label="稼働加盟店数" value={`${kpis.activeCompanies.length}社`} />
          <Kpi label="継続率" value={formatRate(kpis.retentionRate)} />
          <Kpi label="平均加盟年数" value={`${(kpis.averageMembershipMonths / 12).toFixed(1)}年`} />
          <Kpi label="月間総売上" value={`${formatFareYen(kpis.monthSalesYen)}円`} />
          <Kpi label="月間総案件数" value={`${kpis.monthCaseCount}件`} />
          <Kpi label="平均単価" value={`${formatFareYen(kpis.averageFareYen)}円`} />
          <Kpi label="今月加盟料" value={`${formatFareYen(kpis.monthlyFranchiseFeeYen)}円`} />
        </div>
        <div className="hq-rankings">
          <RatioChart title="加盟プラン比率" items={planItems} />
          <RatioChart title="売上カテゴリー別割合" items={salesCategoryItems} />
          <Ranking title="エリア別加盟店数" items={areaRanking} />
        </div>
      </section>

      <section className="admin-section" id="ランキング">
        <h2>ランキング TOP5</h2>
        <div className="hq-rankings">
          <Ranking title="売上ランキング" items={rankingBySales.map((item) => [item.company.name, `${formatFareYen(item.monthSalesYen)}円`])} />
          <Ranking title="成長率ランキング（前年同月比）" items={rankingByGrowth.map((item) => [item.company.name, `${formatRate(growthRate(item.monthSalesYen, item.yearAgoMonthSalesYen))}`])} />
          <Ranking title="継続加盟ランキング" items={rankingByMembership.map((item) => [item.company.name, formatMembership(item.company.contractStartDate)])} />
        </div>
      </section>

      <section className="admin-section" id="加盟店管理">
        <div className="hq-list-toolbar">
          <h2>加盟店管理</h2>
          <details className="hq-registration-panel">
            <summary>＋加盟店登録</summary>
            <div className="settings-grid hq-form-grid">
              <Input label="加盟店ID" value={draftCompany.id} onChange={(value) => updateDraftCompany('id', value)} />
              <Input label="屋号名" value={draftCompany.name} onChange={(value) => updateDraftCompany('name', value)} />
              <Input label="会社名（法人名）" value={draftCompany.corporateName ?? ''} onChange={(value) => updateDraftCompany('corporateName', value)} />
              <Input label="代表者名" value={draftCompany.representativeName ?? draftCompany.ownerName} onChange={(value) => updateDraftCompany('representativeName', value)} />
              <Input label="代表者ログインID" value={ownerLoginDraft.userId} onChange={(value) => { updateOwnerLoginDraft('userId', value); updateDraftCompany('representativeLoginId', value) }} />
              <Input label="初期パスワード" type="password" value={ownerLoginDraft.password} onChange={(value) => { updateOwnerLoginDraft('password', value); updateDraftCompany('representativeInitialPassword', value) }} />
              <Input label="主な営業エリア" value={draftCompany.area ?? ''} onChange={(value) => updateDraftCompany('area', value)} />
              <Input label="加盟日" type="date" value={draftCompany.contractStartDate ?? ''} onChange={(value) => updateDraftCompany('contractStartDate', value)} />
              <label>
                契約プラン
                <select
                  value={draftCompany.subscriptionPlan ?? defaultSubscriptionPlan}
                  onChange={(event) => updateDraftSubscriptionPlan(event.target.value as SubscriptionPlan)}
                >
                  {subscriptionPlanDefinitions.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.displayLabel}</option>
                  ))}
                </select>
              </label>
              <label>加盟店ステータス<select value={draftCompany.status ?? 'screening'} onChange={(event) => updateDraftCompany('status', event.target.value)}>{editableCompanyStatuses.map((status) => <option key={status} value={status}>{companyStatusLabels[status]}</option>)}</select></label>
              <fieldset className="hq-device-settings">
                <legend>機器設定</legend>
                <label>
                  OBD機種
                  <select
                    value={draftCompany.defaultObdModel ?? ''}
                    onChange={(event) => updateDraftCompany('defaultObdModel', event.target.value)}
                  >
                    <option value="">{DEVICE_UNSET_LABEL}</option>
                    {getObdModelOptions().map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
                <label>
                  プリンター機種
                  <select
                    value={draftCompany.defaultPrinterModel ?? ''}
                    onChange={(event) => updateDraftCompany('defaultPrinterModel', event.target.value)}
                  >
                    <option value="">{DEVICE_UNSET_LABEL}</option>
                    {getPrinterModelOptions().map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
              </fieldset>
            </div>
            <div className="hq-form-actions"><button className="primary-action" type="button" onClick={handleCompanySave}>加盟店情報を保存</button></div>
          </details>
          <label>並び替え<select value={sortKey} onChange={(event) => setSortKey(event.target.value as CompanySortKey)}><option value="name">加盟店名</option><option value="sales">売上</option><option value="cases">案件数</option><option value="joinedAt">加盟日</option><option value="membershipMonths">加盟期間</option></select></label>
        </div>
        <div className="admin-table-wrapper hq-table-wrapper">
          <table className="admin-table hq-company-table hq-company-table--simple">
            <thead><tr>{['加盟店名','OBD','プリンター','契約プラン','月額料金','メール通知','LINE通知','OBDM','ステータス','今月売上','案件数','最終ログイン','詳細'].map((head) => <th key={head}>{head}</th>)}</tr></thead>
            <tbody>{sortedCompanySummaries.map((summary) => {
              const plan = summary.company.subscriptionPlan ?? defaultSubscriptionPlan
              const notificationSettings = summary.company.notificationSettings
              const meterPermissions = summary.company.meterPermissions
              return (
                <tr key={summary.company.id}>
                  <td>{summary.company.name}</td>
                  <td>{formatDeviceModel(summary.company.defaultObdModel)}</td>
                  <td>{formatDeviceModel(summary.company.defaultPrinterModel)}</td>
                  <td>{getSubscriptionPlanLabel(plan)}</td>
                  <td>{formatFareYen(summary.company.monthlyFee ?? getSubscriptionPlanMonthlyFee(plan))}円</td>
                  <td>{formatPermissionIndicator(notificationSettings?.email ?? true)}</td>
                  <td>{formatPermissionIndicator(notificationSettings?.line ?? false)}</td>
                  <td>{formatPermissionIndicator(meterPermissions?.obd ?? false)}</td>
                  <td><StatusBadge status={getCompanyStatus(summary.company)} /></td>
                  <td>{formatFareYen(summary.monthSalesYen)}円</td>
                  <td>{summary.monthCaseCount}</td>
                  <td>{summary.company.lastLoginAt || '未記録'}</td>
                  <td className="hq-actions"><button type="button" onClick={() => setSelectedCompanyId(summary.company.id)}>詳細</button><button type="button" onClick={() => handleOpenCompanyTop(summary)}>加盟店TOP確認</button><button type="button" onClick={() => { setDraftCompany(summary.company.subscriptionPlan ? summary.company : applySubscriptionPlanToCompany(summary.company, defaultSubscriptionPlan)); setSelectedCompanyId(summary.company.id); setOwnerLoginDraft(createOwnerLoginDraftFromCompany(summary.company, staffMembers)) }}>編集</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="admin-section" id="FC収益分析">
        <h2>FC収益分析</h2>
        <div className="hq-rankings">
          <Ranking title="プラン別加盟店数" items={planItems.map((item) => [item.label, `${item.value}社`])} />
          <Ranking title="プラン別加盟料収益" items={planRevenueRanking} />
          <RatioChart title="プラン別加盟料構成比" items={franchiseRevenueItems} />
        </div>
      </section>

      <section className="admin-section" id="売上分析">
        <h2>売上分析</h2>
        <div className="work-dashboard-grid"><div><span>月間総売上</span><strong>{formatFareYen(kpis.monthSalesYen)}円</strong></div><div><span>月間総案件数</span><strong>{kpis.monthCaseCount}件</strong></div><div><span>平均単価</span><strong>{formatFareYen(kpis.averageFareYen)}円</strong></div></div>
        <div className="hq-rankings"><RatioChart title="売上カテゴリー別割合" items={salesCategoryItems} /></div>
      </section>

      <section className="admin-section" id="エリア分析">
        <h2>エリア分析</h2>
        <div className="hq-rankings"><Ranking title="加盟店数" items={areaRanking} /></div>
      </section>

      <details className="admin-section" id="管理者設定">
        <summary><h2>管理者設定</h2></summary>
        <section className="hq-settings-panel">
          <h3>本部情報</h3>
          <div className="settings-grid hq-form-grid"><Input label="本部名称" value={headquartersInfo.name} onChange={(value) => updateHeadquartersInfo('name', value)} /><Input label="代表者名" value={headquartersInfo.representativeName} onChange={(value) => updateHeadquartersInfo('representativeName', value)} /><Input label="電話番号" value={headquartersInfo.phoneNumber} onChange={(value) => updateHeadquartersInfo('phoneNumber', value)} /><Input label="メールアドレス" value={headquartersInfo.email} onChange={(value) => updateHeadquartersInfo('email', value)} /></div>
          <button className="primary-action" type="button" onClick={handleHeadquartersInfoSave}>本部情報を保存</button>
        </section>
        <div className="work-dashboard-grid">{['ロール設定','権限設定','プラン設定','ステータス設定','ノウハウカテゴリ管理'].map((item) => <div key={item}><span>本部専用</span><strong>{item}</strong></div>)}</div>
      </details>

      <section className="admin-section">
        <h2>加盟店詳細画面</h2>
        {selectedCompany && selectedSummary ? (
          <div className="hq-company-profile">
            <ProfileBlock title="基本情報" rows={[
              ['加盟店名', selectedCompany.name],
              ['代表者', selectedCompany.representativeName || selectedCompany.ownerName || '未設定'],
              ['エリア', selectedCompany.area || '未設定'],
              ['加盟日', formatDate(selectedCompany.contractStartDate)],
              ['加盟期間', formatMembership(selectedCompany.contractStartDate)],
              ['ステータス', companyStatusLabels[getCompanyStatus(selectedCompany)]],
              ['契約プラン', getSubscriptionPlanLabel(selectedCompany.subscriptionPlan ?? defaultSubscriptionPlan)],
              ['月額料金', `${formatFareYen(selectedCompany.monthlyFee ?? getSubscriptionPlanMonthlyFee(selectedCompany.subscriptionPlan ?? defaultSubscriptionPlan))}円`],
              ['メール通知', formatPermissionIndicator(selectedCompany.notificationSettings?.email ?? true)],
              ['LINE通知', formatPermissionIndicator(selectedCompany.notificationSettings?.line ?? false)],
              ['OBDM', formatPermissionIndicator(selectedCompany.meterPermissions?.obd ?? false)],
              ['OBD貸与', formatPermissionIndicator(selectedCompany.obdAdapterLoanEnabled ?? false)],
              ['店舗数', `${selectedSummary.storeCount}店舗`],
              ['従業員数', `${selectedSummary.staffCount}人`],
              ['車両数', `${selectedSummary.vehicleCount}台`],
            ]} />
            <ProfileBlock title="機器設定" rows={[
              ['OBD機種', formatDeviceModel(selectedCompany.defaultObdModel)],
              ['プリンター機種', formatDeviceModel(selectedCompany.defaultPrinterModel)],
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
              ['最終案件日', toDateString(selectedSummary.lastCaseAt)],
              ['稼働ドライバー数', `${selectedSummary.activeDriverCount}人`],
              ['稼働車両数', `${selectedSummary.activeVehicleCount}台`],
            ]} />
            <ProfileBlock title="面談管理" rows={[
              ['最終Zoom面談日', (selectedCompany as Company & { lastMeetingDate?: string }).lastMeetingDate || '未記録'],
              ['次回面談予定日', (selectedCompany as Company & { nextMeetingDate?: string }).nextMeetingDate || '未設定'],
              ['面談メモ', (selectedCompany as Company & { meetingMemo?: string }).meetingMemo || '未記録'],
            ]} />
            <ProfileBlock title="バックドア機能" rows={[
              ['詳細案件一覧', '必要時のみ確認'],
              ['従業員一覧', '必要時のみ確認'],
              ['車両一覧', '必要時のみ確認'],
              ['料金設定確認', '必要時のみ確認'],
            ]} />
          </div>
        ) : (
          <p className="empty-note">加盟店を選択してください。</p>
        )}
      </section>
    </main>
  )
}


function growthRate(current: number, previous: number) { return previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0 }
function supportReasons(summary: CompanySummary, thirtyDaysAgo: Date) {
  const reasons: string[] = []
  const lastLoginDays = getDaysSince(summary.company.lastLoginAt)
  const nextMeetingDate = (summary.company as Company & { nextMeetingDate?: string }).nextMeetingDate
  if (!summary.lastCaseAt || summary.lastCaseAt < thirtyDaysAgo.toISOString()) reasons.push('30日以上案件なし')
  if (summary.previousMonthSalesYen > 0 && summary.monthSalesYen <= summary.previousMonthSalesYen * 0.5) reasons.push(`前月比売上 ${formatPercent(summary.monthSalesYen, summary.previousMonthSalesYen)}`)
  if (summary.previousMonthCaseCount > 0 && summary.monthCaseCount <= summary.previousMonthCaseCount * 0.5) reasons.push(`前月比案件数 ${formatPercent(summary.monthCaseCount, summary.previousMonthCaseCount)}`)
  if (lastLoginDays === null || lastLoginDays >= 14) reasons.push(lastLoginDays === null ? 'ログイン記録なし' : `最終ログイン ${lastLoginDays}日前`)
  if (nextMeetingDate && nextMeetingDate < toDateInputValue(new Date())) reasons.push('面談予定日超過')
  return reasons
}
function planRatioItems(companies: Company[]): RatioItem[] {
  const counts = new Map<string, number>()
  companies.forEach((company) => {
    const plan = getSubscriptionPlanLabel(company.subscriptionPlan ?? defaultSubscriptionPlan)
    counts.set(plan, (counts.get(plan) ?? 0) + 1)
  })
  const total = companies.length || 1
  return subscriptionPlanDefinitions.map((definition) => ({
    label: definition.label,
    value: counts.get(definition.label) ?? 0,
    percent: ((counts.get(definition.label) ?? 0) / total) * 100,
  }))
}
function planRevenueItems(companies: Company[]): Array<[string, string]> {
  const totals = new Map<string, number>()
  companies.forEach((company) => {
    const plan = getSubscriptionPlanLabel(company.subscriptionPlan ?? defaultSubscriptionPlan)
    totals.set(plan, (totals.get(plan) ?? 0) + (company.monthlyFee ?? getSubscriptionPlanMonthlyFee(company.subscriptionPlan ?? defaultSubscriptionPlan)))
  })
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([plan, fee]) => [plan, `${formatFareYen(fee)}円`])
}
function planRevenueRatioItems(companies: Company[]): RatioItem[] { const items = planRevenueItems(companies).map(([label, value]) => ({ label, value: Number(value.replace(/[^0-9]/g, '')) || 0 })); const total = items.reduce((sum, item) => sum + item.value, 0) || 1; return items.map((item) => ({ ...item, percent: (item.value / total) * 100, suffix: '円' })) }
function areaCompanyItems(companies: Company[]): Array<[string, string]> { const counts = new Map<string, number>(); companies.forEach((company) => { const area = company.area || '未設定'; counts.set(area, (counts.get(area) ?? 0) + 1) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([area, count]) => [area, `${count}社`]) }
function salesCategoryRatioItems(records: StoredCaseRecord[]): RatioItem[] {
  const totals = [
    ['運賃', records.reduce((t, r) => t + r.basicFareYen + r.meterTimeFareYen, 0)],
    ['介助', records.reduce((t, r) => t + r.careOptionFareYen, 0)],
    ['待機', records.reduce((t, r) => t + r.waitingFareYen, 0)],
    ['付き添い', records.reduce((t, r) => t + r.escortFareYen, 0)],
    ['予約配車', records.reduce((t, r) => t + r.dispatchFareYen, 0)],
  ] as Array<[string, number]>
  const total = totals.reduce((sum, [, value]) => sum + value, 0) || 1
  return totals.map(([label, value]) => ({ label, value, percent: (value / total) * 100, suffix: '円' }))
}
type RatioItem = { label: string; percent: number; suffix?: string; value: number }
function RatioChart({ items, title }: { items: RatioItem[]; title: string }) { return <section><h3>{title}</h3><div className="hq-ratio-bars">{items.map((item) => <div key={`${title}-${item.label}`}><span>{item.label}</span><div className="hq-ratio-track"><i style={{ width: `${Math.max(item.percent, 2)}%` }} /></div><strong>{item.suffix ? `${formatFareYen(item.value)}${item.suffix} / ` : `${item.value}社 / `}{formatRate(item.percent)}</strong></div>)}</div></section> }

function Kpi({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function Ranking({ items, title }: { items: Array<[string, string]>; title: string }) { return <section><h3>{title}</h3>{items.length > 0 ? <ol>{items.map(([label, value]) => <li key={`${title}-${label}`}><span>{label}</span><strong>{value}</strong></li>)}</ol> : <p>データなし</p>}</section> }
function Input({ label, onChange, type = 'text', value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) { return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function StatusBadge({ status }: { status: CompanyStatus }) { return <span className={`hq-status-badge hq-status-badge--${status}`}>{companyStatusLabels[status]}</span> }
function ProfileBlock({ rows, title }: { rows: Array<[string, string]>; title: string }) { return <section><h3>{title}</h3>{rows.map(([label, value]) => <div key={`${title}-${label}`}><span>{label}</span><strong>{value}</strong></div>)}</section> }
