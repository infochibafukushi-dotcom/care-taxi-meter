type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

export type StaffClaimsSource = {
  id: string
  companyId: string
  franchiseeId: string
  storeId: string
  role: StaffRole
}

export type StaffCustomClaims = {
  role: StaffRole
  franchiseeId: string
  companyId: string
  storeId: string
  staffId: string
}

const toAuthRole = (role: StaffRole): StaffRole => {
  if (role === 'hq_admin') return 'hq_admin'
  if (role === 'owner') return 'owner'
  if (role === 'manager') return 'manager'
  return 'driver'
}

export const buildStaffCustomClaims = (staffMember: StaffClaimsSource): StaffCustomClaims => ({
  role: toAuthRole(staffMember.role),
  franchiseeId: staffMember.franchiseeId || staffMember.companyId,
  companyId: staffMember.companyId,
  storeId: staffMember.storeId,
  staffId: staffMember.id,
})

/** True when a lower-privilege role would receive higher claims (should never happen). */
export const claimsMatchStaffRole = (staffRole: StaffRole, claimsRole: StaffRole) => {
  if (staffRole === 'driver') return claimsRole === 'driver'
  if (staffRole === 'manager') return claimsRole === 'manager' || claimsRole === 'driver'
  return true
}
