/**
 * CLI/scripts development reset policy (fail-closed).
 * Keep aligned with src/utils/developmentResetGuard.ts
 */

export const PRODUCTION_FIREBASE_PROJECT_IDS = Object.freeze(['care-taxi-meter'])
export const DEVELOPMENT_RESET_CONFIRM_PREFIX = 'RESET-DEV-DATA:'

export function parseAllowedProjectIds(value) {
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

export function isProductionFirebaseProjectId(projectId) {
  const id = String(projectId ?? '').trim()
  if (!id) return false
  return PRODUCTION_FIREBASE_PROJECT_IDS.includes(id)
}

export function buildDevelopmentResetConfirmText(projectId) {
  return `${DEVELOPMENT_RESET_CONFIRM_PREFIX}${String(projectId ?? '').trim()}`
}

export function matchesDevelopmentResetConfirmText(confirmText, projectId) {
  const expected = buildDevelopmentResetConfirmText(projectId)
  return Boolean(expected) && String(confirmText ?? '').trim() === expected
}

export function evaluateDevelopmentResetGuard({
  projectId,
  enabled,
  allowedProjectIds,
  isCi,
} = {}) {
  if (isCi === true) {
    return { allowed: false, reason: 'CI環境では開発データリセットを実行できません。' }
  }
  if (enabled !== true) {
    return { allowed: false, reason: '開発データリセットが有効化されていません。' }
  }
  const id = String(projectId ?? '').trim()
  if (!id) {
    return { allowed: false, reason: 'Firebase project ID が未指定です。' }
  }
  if (isProductionFirebaseProjectId(id)) {
    return { allowed: false, reason: '本番 Firebase project では開発データリセットを実行できません。' }
  }
  const allowlist = parseAllowedProjectIds(allowedProjectIds)
  if (allowlist.length === 0) {
    return { allowed: false, reason: '開発用 project ID の allowlist が空です。' }
  }
  if (!allowlist.includes(id)) {
    return {
      allowed: false,
      reason: 'この Firebase project は開発リセット allowlist に含まれていません。',
    }
  }
  return { allowed: true, projectId: id }
}

export function assertCliDevelopmentResetAllowed(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID ?? '').trim()
  const enabledRaw = String(env.DEV_RESET_ENABLED ?? '').trim().toLowerCase()
  const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes'
  const decision = evaluateDevelopmentResetGuard({
    projectId,
    enabled,
    allowedProjectIds: env.DEV_RESET_ALLOWED_PROJECT_IDS ?? '',
    isCi: String(env.CI ?? '').toLowerCase() === 'true',
  })
  if (!decision.allowed) {
    throw new Error(decision.reason)
  }
  const confirm = String(env.CONFIRM_RESET_DEVELOPMENT_DATA ?? '').trim()
  if (!matchesDevelopmentResetConfirmText(confirm, decision.projectId)) {
    throw new Error(
      `確認文字列が一致しません。CONFIRM_RESET_DEVELOPMENT_DATA=${buildDevelopmentResetConfirmText(decision.projectId)} を設定してください。`,
    )
  }
  return decision.projectId
}

export function validateBootstrapAdminPassword(password) {
  const value = String(password ?? '')
  if (value.length < 12) {
    return { ok: false, message: '開発管理者パスワードは12文字以上にしてください。' }
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, message: '開発管理者パスワードは英字と数字を含めてください。' }
  }
  return { ok: true }
}
