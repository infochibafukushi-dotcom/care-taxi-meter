/**
 * Client-side Auth V2 flags.
 * Phase2 trial: VITE_AUTH_V2_ENABLED=true with ENFORCE hard-locked false.
 */
export const AUTH_V2_ENABLED =
  String(import.meta.env.VITE_AUTH_V2_ENABLED || '').toLowerCase() === 'true'

/** Do not enable in this phase. Always treated as false by getClientAuthFlags(). */
export const AUTH_V2_ENFORCE =
  String(import.meta.env.VITE_AUTH_V2_ENFORCE || '').toLowerCase() === 'true'

export function getClientAuthFlags() {
  return {
    AUTH_V2_ENABLED,
    AUTH_V2_ENFORCE: false, // hard-locked off for phase2 regardless of env typos
  }
}
