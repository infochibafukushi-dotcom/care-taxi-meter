export const DEFAULT_ALLOWED_ORIGINS = [
  'https://infochibafukushi-dotcom.github.io',
  'http://localhost:5173',
] as const

export function parseAllowedOrigins(env: {
  ALLOWED_ORIGIN?: string
  ALLOWED_ORIGINS?: string
}): string[] {
  const fromList = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const legacy = env.ALLOWED_ORIGIN?.trim()
  const merged = [...fromList, ...(legacy ? [legacy] : [])]
  const unique = [...new Set(merged)]
  return unique.length > 0 ? unique : [...DEFAULT_ALLOWED_ORIGINS]
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return true
  return allowedOrigins.includes(origin)
}

export function resolveCorsOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[],
): string | null {
  if (!requestOrigin) return null
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null
}
