/**
 * Development-data reset policy (fail-closed).
 * Shared pure logic — no secrets. Project IDs are not secrets.
 */

/** Known production Firebase project IDs — always rejected for reset. */
export const PRODUCTION_FIREBASE_PROJECT_IDS = ['care-taxi-meter'] as const

export const DEVELOPMENT_RESET_CONFIRM_PREFIX = 'RESET-DEV-DATA:'

export type DevelopmentResetDecision =
  | { allowed: true; projectId: string }
  | { allowed: false; reason: string }

export type DevelopmentResetGuardInput = {
  projectId?: string | null
  /** Explicit enable flag (must be true). */
  enabled?: boolean | null
  /** Comma-separated or array of allowed development project IDs. */
  allowedProjectIds?: string | readonly string[] | null
  /** When true (e.g. CI=true), always reject. */
  isCi?: boolean | null
  /** Optional: Firebase Emulator — still requires enabled + allowlist (or emulator allow). */
  isEmulator?: boolean | null
}

const normalizeProjectId = (value?: string | null) => (value ?? '').trim()

export const parseAllowedProjectIds = (
  value?: string | readonly string[] | null,
): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const isProductionFirebaseProjectId = (projectId?: string | null) => {
  const id = normalizeProjectId(projectId)
  if (!id) {
    return false
  }
  return (PRODUCTION_FIREBASE_PROJECT_IDS as readonly string[]).includes(id)
}

export const buildDevelopmentResetConfirmText = (projectId: string) =>
  `${DEVELOPMENT_RESET_CONFIRM_PREFIX}${normalizeProjectId(projectId)}`

export const matchesDevelopmentResetConfirmText = (
  confirmText: string | null | undefined,
  projectId: string,
) => {
  const expected = buildDevelopmentResetConfirmText(projectId)
  return Boolean(expected) && (confirmText ?? '').trim() === expected
}

/**
 * Fail-closed: every required condition must pass.
 */
export const evaluateDevelopmentResetGuard = (
  input: DevelopmentResetGuardInput,
): DevelopmentResetDecision => {
  if (input.isCi === true) {
    return { allowed: false, reason: 'CI環境では開発データリセットを実行できません。' }
  }

  if (input.enabled !== true) {
    return { allowed: false, reason: '開発データリセットが有効化されていません。' }
  }

  const projectId = normalizeProjectId(input.projectId)
  if (!projectId) {
    return { allowed: false, reason: 'Firebase project ID が未指定です。' }
  }

  if (isProductionFirebaseProjectId(projectId)) {
    return { allowed: false, reason: '本番 Firebase project では開発データリセットを実行できません。' }
  }

  const allowlist = parseAllowedProjectIds(input.allowedProjectIds)
  if (allowlist.length === 0) {
    return { allowed: false, reason: '開発用 project ID の allowlist が空です。' }
  }

  if (!allowlist.includes(projectId)) {
    return {
      allowed: false,
      reason: 'この Firebase project は開発リセット allowlist に含まれていません。',
    }
  }

  return { allowed: true, projectId }
}

export const assertDevelopmentResetAllowed = (input: DevelopmentResetGuardInput) => {
  const decision = evaluateDevelopmentResetGuard(input)
  if (!decision.allowed) {
    throw new Error(decision.reason)
  }
  return decision.projectId
}

/** Minimum strength for bootstrap admin password supplied at reset time (never hardcoded). */
export const validateBootstrapAdminPassword = (password: string | null | undefined) => {
  const value = password ?? ''
  if (value.length < 12) {
    return { ok: false as const, message: '開発管理者パスワードは12文字以上にしてください。' }
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return {
      ok: false as const,
      message: '開発管理者パスワードは英字と数字を含めてください。',
    }
  }
  return { ok: true as const }
}

/**
 * Client env reader for Vite. Production Pages builds must leave these unset/false.
 */
export const readClientDevelopmentResetConfig = (env: {
  DEV?: boolean
  VITE_DEV_RESET_ENABLED?: string
  VITE_DEV_RESET_ALLOWED_PROJECT_IDS?: string
  VITE_FIREBASE_PROJECT_ID?: string
  MODE?: string
}) => {
  const enabledRaw = (env.VITE_DEV_RESET_ENABLED ?? '').trim().toLowerCase()
  const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes'
  return {
    enabled,
    allowedProjectIds: env.VITE_DEV_RESET_ALLOWED_PROJECT_IDS ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    isViteDev: env.DEV === true,
  }
}

/** Whether the HQ reset UI may be mounted (still requires guard before execute). */
export const isDevelopmentResetUiAllowed = (input: DevelopmentResetGuardInput) =>
  evaluateDevelopmentResetGuard(input).allowed
