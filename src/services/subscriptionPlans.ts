import type { Company, MeterPermissions, NotificationSettings, SubscriptionPlan } from '../types/work'

export type SubscriptionPlanDefinition = {
  id: SubscriptionPlan
  label: string
  monthlyFee: number
  displayLabel: string
  meterPermissions: MeterPermissions
  notificationSettings: NotificationSettings
  obdAdapterLoanEnabled: boolean
}

export const subscriptionPlanDefinitions: SubscriptionPlanDefinition[] = [
  {
    id: 'standard',
    label: 'スタンダード',
    monthlyFee: 9800,
    displayLabel: 'スタンダード（9,800円）',
    meterPermissions: { gps: true, time: true, obd: false },
    notificationSettings: { email: true, line: false },
    obdAdapterLoanEnabled: false,
  },
  {
    id: 'professional',
    label: 'プロフェッショナル',
    monthlyFee: 16800,
    displayLabel: 'プロフェッショナル（16,800円）',
    meterPermissions: { gps: true, time: true, obd: false },
    notificationSettings: { email: true, line: true },
    obdAdapterLoanEnabled: false,
  },
  {
    id: 'premium',
    label: 'プレミアム',
    monthlyFee: 39800,
    displayLabel: 'プレミアム（39,800円）',
    meterPermissions: { gps: true, time: true, obd: true },
    notificationSettings: { email: true, line: true },
    obdAdapterLoanEnabled: true,
  },
]

const subscriptionPlanIds = new Set<SubscriptionPlan>(subscriptionPlanDefinitions.map((plan) => plan.id))

export const defaultSubscriptionPlan: SubscriptionPlan = 'standard'

export const defaultMeterPermissions: MeterPermissions =
  subscriptionPlanDefinitions.find((plan) => plan.id === defaultSubscriptionPlan)!.meterPermissions

export const defaultNotificationSettings: NotificationSettings =
  subscriptionPlanDefinitions.find((plan) => plan.id === defaultSubscriptionPlan)!.notificationSettings

export const hqMeterPermissions: MeterPermissions = { gps: true, time: true, obd: true }

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && subscriptionPlanIds.has(value as SubscriptionPlan)
}

export function getSubscriptionPlanDefinition(plan: SubscriptionPlan) {
  return subscriptionPlanDefinitions.find((definition) => definition.id === plan) ?? subscriptionPlanDefinitions[0]
}

export function getSubscriptionPlanLabel(plan: SubscriptionPlan) {
  return getSubscriptionPlanDefinition(plan).label
}

export function getSubscriptionPlanMonthlyFee(plan: SubscriptionPlan) {
  return getSubscriptionPlanDefinition(plan).monthlyFee
}

export function getPermissionsForPlan(plan: SubscriptionPlan) {
  const definition = getSubscriptionPlanDefinition(plan)
  return {
    meterPermissions: definition.meterPermissions,
    notificationSettings: definition.notificationSettings,
    monthlyFee: definition.monthlyFee,
    planLabel: definition.label,
    obdAdapterLoanEnabled: definition.obdAdapterLoanEnabled,
  }
}

export function applySubscriptionPlanToCompany(company: Company, plan: SubscriptionPlan): Company {
  const permissions = getPermissionsForPlan(plan)
  return {
    ...company,
    subscriptionPlan: plan,
    plan: permissions.planLabel,
    monthlyFee: permissions.monthlyFee,
    meterPermissions: permissions.meterPermissions,
    notificationSettings: permissions.notificationSettings,
    obdAdapterLoanEnabled: permissions.obdAdapterLoanEnabled,
  }
}

export function resolveMeterPermissions(company: Company | null | undefined): MeterPermissions {
  if (!company) return defaultMeterPermissions
  if (company.meterPermissions) return company.meterPermissions
  if (company.subscriptionPlan) return getPermissionsForPlan(company.subscriptionPlan).meterPermissions
  return defaultMeterPermissions
}

export function resolveNotificationSettings(company: Company | null | undefined): NotificationSettings {
  if (!company) return defaultNotificationSettings
  if (company.notificationSettings) return company.notificationSettings
  if (company.subscriptionPlan) return getPermissionsForPlan(company.subscriptionPlan).notificationSettings
  return defaultNotificationSettings
}

export function formatPermissionIndicator(enabled: boolean) {
  return enabled ? '○' : '－'
}

const chibaCareTaxiPatterns = ['ちばケアタクシー', 'ちばケア', 'chiba-care', 'chibacare']

export function isChibaCareTaxiCompany(company: Company) {
  const normalizedValues = [company.id, company.name, company.corporateName ?? '']
    .map((value) => value.trim().toLowerCase())
  return chibaCareTaxiPatterns.some((pattern) =>
    normalizedValues.some((value) => value.includes(pattern.toLowerCase())),
  )
}

export function resolveSubscriptionPlanForMigration(company: Company): SubscriptionPlan {
  if (isChibaCareTaxiCompany(company)) return 'premium'
  if (company.subscriptionPlan && isSubscriptionPlan(company.subscriptionPlan)) {
    return company.subscriptionPlan
  }
  if (company.plan?.includes('プレミアム')) return 'premium'
  if (company.plan?.includes('プロフェッショナル')) return 'professional'
  return defaultSubscriptionPlan
}

export function migrateCompanySubscriptionFields(company: Company): Company | null {
  if (company.plan === 'FC本部') return null

  const nextPlan = resolveSubscriptionPlanForMigration(company)
  const nextCompany = applySubscriptionPlanToCompany(company, nextPlan)
  const hasSamePlan =
    company.subscriptionPlan === nextCompany.subscriptionPlan &&
    company.plan === nextCompany.plan &&
    company.monthlyFee === nextCompany.monthlyFee &&
    company.meterPermissions?.gps === nextCompany.meterPermissions?.gps &&
    company.meterPermissions?.time === nextCompany.meterPermissions?.time &&
    company.meterPermissions?.obd === nextCompany.meterPermissions?.obd &&
    company.notificationSettings?.email === nextCompany.notificationSettings?.email &&
    company.notificationSettings?.line === nextCompany.notificationSettings?.line &&
    company.obdAdapterLoanEnabled === nextCompany.obdAdapterLoanEnabled

  return hasSamePlan ? null : nextCompany
}

export function shouldSendReservationEmail(settings: NotificationSettings) {
  return settings.email
}

export function shouldSendReservationLine(settings: NotificationSettings) {
  return settings.line
}

export function getAllowedMeterModes(permissions: MeterPermissions): Array<'gps' | 'time' | 'obd'> {
  const modes: Array<'gps' | 'time' | 'obd'> = []
  if (permissions.gps) modes.push('gps')
  if (permissions.time) modes.push('time')
  if (permissions.obd) modes.push('obd')
  return modes.length > 0 ? modes : ['gps']
}

export function isMeterModeAllowed(mode: 'gps' | 'time' | 'obd', permissions: MeterPermissions) {
  return getAllowedMeterModes(permissions).includes(mode)
}
