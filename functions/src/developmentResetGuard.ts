/**
 * Server-side development reset policy (fail-closed).
 * Keep in sync with src/utils/developmentResetGuard.ts (covered by mirror test).
 */

export const PRODUCTION_FIREBASE_PROJECT_IDS = ['care-taxi-meter'] as const

export const DEVELOPMENT_RESET_CONFIRM_PREFIX = 'RESET-DEV-DATA:'

export type DevelopmentResetDecision =
  | { allowed: true; projectId: string }
  | { allowed: false; reason: string }

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

export const resolveFunctionsProjectId = () => {
  const fromEnv =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    ''
  if (fromEnv.trim()) {
    return fromEnv.trim()
  }
  const firebaseConfig = process.env.FIREBASE_CONFIG
  if (firebaseConfig) {
    try {
      const parsed = JSON.parse(firebaseConfig) as { projectId?: string }
      return String(parsed.projectId ?? '').trim()
    } catch {
      return ''
    }
  }
  return ''
}

export const readFunctionsDevelopmentResetConfig = () => {
  const enabledRaw = (process.env.DEV_RESET_ENABLED ?? '').trim().toLowerCase()
  const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes'
  return {
    enabled,
    allowedProjectIds: process.env.DEV_RESET_ALLOWED_PROJECT_IDS ?? '',
    projectId: resolveFunctionsProjectId(),
  }
}

export const evaluateDevelopmentResetGuard = (input: {
  projectId?: string | null
  enabled?: boolean | null
  allowedProjectIds?: string | readonly string[] | null
  isCi?: boolean | null
}): DevelopmentResetDecision => {
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

export const assertDevelopmentResetAllowedForFunctions = (extra?: {
  confirmText?: string | null
  expectedConfirmForProject?: boolean
}) => {
  const config = readFunctionsDevelopmentResetConfig()
  const decision = evaluateDevelopmentResetGuard({
    projectId: config.projectId,
    enabled: config.enabled,
    allowedProjectIds: config.allowedProjectIds,
    isCi: (process.env.CI ?? '').toLowerCase() === 'true',
  })
  if (!decision.allowed) {
    throw new Error(decision.reason)
  }
  if (extra?.expectedConfirmForProject) {
    if (!matchesDevelopmentResetConfirmText(extra.confirmText, decision.projectId)) {
      throw new Error(
        `confirmText が不正です。${buildDevelopmentResetConfirmText(decision.projectId)} を指定してください。`,
      )
    }
  }
  return decision.projectId
}
