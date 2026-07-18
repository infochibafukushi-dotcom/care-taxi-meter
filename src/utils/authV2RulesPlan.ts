/**
 * Proposed Auth V2 Firestore rules additions (NOT fully enforced this phase).
 *
 * Already safe to deploy (additive denies):
 * - staffCredentials: deny all client access
 * - loginAttempts: deny all client access
 *
 * Future cutover candidates (DO NOT enable until AUTH_V2_ENFORCE approval):
 *
 * function rejectsPasswordFieldMutation() {
 *   return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['password']);
 * }
 *
 * // On staffMembers update for non-Functions clients:
 * allow update: if ... && rejectsPasswordFieldMutation();
 *
 * Claims alignment reminders:
 * - sameFranchisee / sameStore / ownStaffData already compare token claims
 * - After AUTH_V2_ENFORCE, loginStaffV2 + setCustomUserClaims become the only claim issuer
 */
export const AUTH_V2_RULES_PHASE1_DEPLOYED = [
  'staffCredentials deny all client read/write',
  'loginAttempts deny all client read/write',
] as const

export const AUTH_V2_RULES_FUTURE = [
  'block client writes to staffMembers.password',
  'require claims.companyId/storeId/staffId/role for tenant isolation (already largely present)',
] as const
