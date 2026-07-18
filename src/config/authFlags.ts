/**
 * Client-side Auth V2 flags (Phase3B).
 * ENFORCE=true forces loginStaffV2 only — legacy loginStaff is retired.
 */
export const AUTH_V2_ENABLED =
  String(import.meta.env.VITE_AUTH_V2_ENABLED || '').toLowerCase() === 'true'

export const AUTH_V2_ENFORCE =
  String(import.meta.env.VITE_AUTH_V2_ENFORCE || '').toLowerCase() === 'true'

export function getClientAuthFlags() {
  return {
    AUTH_V2_ENABLED,
    AUTH_V2_ENFORCE,
  }
}
