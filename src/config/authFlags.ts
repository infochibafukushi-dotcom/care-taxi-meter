/**
 * Client-side Auth V2 flags.
 * Production Pages deploy must keep VITE_AUTH_V2_ENABLED unset/false so loginStaff stays the path.
 * AUTH_V2_ENFORCE must never be enabled in this phase.
 */
export const AUTH_V2_ENABLED =
  String(import.meta.env.VITE_AUTH_V2_ENABLED || '').toLowerCase() === 'true'

export const AUTH_V2_ENFORCE =
  String(import.meta.env.VITE_AUTH_V2_ENFORCE || '').toLowerCase() === 'true'

export function getClientAuthFlags() {
  return {
    AUTH_V2_ENABLED,
    AUTH_V2_ENFORCE: false, // hard-locked off for this phase regardless of env typos
  }
}
