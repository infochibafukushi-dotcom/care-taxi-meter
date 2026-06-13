import type { StaffRole } from './work'

export const ROLE_LABELS: Record<StaffRole, string> = {
  driver: 'ドライバー',
  manager: 'マネージャー',
  owner: 'オーナー',
  hq_admin: 'FC本部管理者',
}

export const assignableStaffRoles: StaffRole[] = ['driver', 'manager', 'owner']
export const staffRoleSelectGroups: Array<{ label?: string; roles: StaffRole[] }> = [
  { roles: assignableStaffRoles },
  { label: 'FC本部管理者', roles: ['hq_admin'] },
]

export const roleHomePaths: Record<StaffRole, string> = {
  driver: '/driver',
  manager: '/manager',
  owner: '/owner',
  hq_admin: '/hq',
}

export const managementRoles: StaffRole[] = ['manager', 'owner', 'hq_admin']

export const canAccessAdminSection = (role: StaffRole | '', sectionId: string) => {
  if (role === 'hq_admin') {
    return false
  }

  if (role === 'owner') {
    return [
      'company',
      'fare',
      'staff',
      'stores',
      'vehicles',
      'analytics',
      'personalOperations',
    ].includes(sectionId)
  }

  if (role === 'manager') {
    return ['staff', 'vehicles', 'analytics', 'personalOperations'].includes(sectionId)
  }

  return false
}

export const canManageCaseRecord = (role: StaffRole | '') =>
  ['manager', 'owner', 'hq_admin'].includes(role)

export const canCancelCaseRecord = (role: StaffRole | '') =>
  ['driver', 'manager', 'owner', 'hq_admin'].includes(role)

export const canDeleteCaseRecord = canManageCaseRecord
export const canRestoreCaseRecord = canManageCaseRecord
