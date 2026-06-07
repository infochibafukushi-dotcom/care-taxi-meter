import type { StaffRole } from './work'

export const ROLE_LABELS: Record<StaffRole, string> = {
  driver: 'ドライバー',
  manager: 'マネージャー',
  owner: 'オーナー',
  superAdmin: '本部管理者',
}

export const assignableStaffRoles: StaffRole[] = ['driver', 'manager', 'owner']
export const staffRoleSelectGroups: Array<{ label?: string; roles: StaffRole[] }> = [
  { roles: assignableStaffRoles },
  { label: '本部管理者（FC）', roles: ['superAdmin'] },
]

export const roleHomePaths: Record<StaffRole, string> = {
  driver: '/driver',
  manager: '/manager',
  owner: '/owner',
  superAdmin: '/superadmin',
}

export const managementRoles: StaffRole[] = ['manager', 'owner', 'superAdmin']

export const canAccessAdminSection = (role: StaffRole | '', sectionId: string) => {
  if (role === 'superAdmin') {
    return true
  }

  if (role === 'owner') {
    return [
      'company',
      'fare',
      'receipt',
      'staff',
      'stores',
      'vehicles',
      'analytics',
      'personalOperations',
      'system',
    ].includes(sectionId)
  }

  if (role === 'manager') {
    return ['staff', 'vehicles', 'analytics', 'personalOperations'].includes(sectionId)
  }

  return false
}

export const canManageCaseRecord = (role: StaffRole | '') =>
  ['manager', 'owner', 'superAdmin'].includes(role)

export const canDeleteCaseRecord = canManageCaseRecord
