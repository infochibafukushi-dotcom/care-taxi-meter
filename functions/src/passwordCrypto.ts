import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto'

export const PASSWORD_HASH_ALGORITHM = 'scrypt' as const

export type PasswordHashParameters = {
  N: number
  r: number
  p: number
  keyLength: number
  saltBytes: number
}

/** Conservative Node scrypt defaults (OWASP-aligned). */
export const DEFAULT_HASH_PARAMETERS: PasswordHashParameters = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
}

export type PasswordHashRecord = {
  passwordHash: string
  passwordSalt: string
  hashAlgorithm: typeof PASSWORD_HASH_ALGORITHM
  hashParameters: PasswordHashParameters
}

const toBase64 = (value: Buffer) => value.toString('base64')
const fromBase64 = (value: string) => Buffer.from(value, 'base64')

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  parameters: PasswordHashParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keyLength,
      { N: parameters.N, r: parameters.r, p: parameters.p },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey as Buffer)
      },
    )
  })
}

export async function hashPassword(
  password: string,
  parameters: PasswordHashParameters = DEFAULT_HASH_PARAMETERS,
): Promise<PasswordHashRecord> {
  const salt = randomBytes(parameters.saltBytes)
  const derived = await scryptAsync(password, salt, parameters.keyLength, parameters)

  return {
    passwordHash: toBase64(derived),
    passwordSalt: toBase64(salt),
    hashAlgorithm: PASSWORD_HASH_ALGORITHM,
    hashParameters: { ...parameters },
  }
}

export async function verifyPassword(
  password: string,
  record: Pick<PasswordHashRecord, 'passwordHash' | 'passwordSalt' | 'hashAlgorithm' | 'hashParameters'>,
): Promise<boolean> {
  if (record.hashAlgorithm !== PASSWORD_HASH_ALGORITHM) {
    return false
  }

  const parameters = record.hashParameters || DEFAULT_HASH_PARAMETERS
  const salt = fromBase64(record.passwordSalt)
  const expected = fromBase64(record.passwordHash)
  if (!salt.length || !expected.length) {
    return false
  }

  const derived = await scryptAsync(
    password,
    salt,
    parameters.keyLength || expected.length,
    parameters,
  )

  if (derived.length !== expected.length) {
    return false
  }

  return timingSafeEqual(derived, expected)
}

/** Redact secrets from arbitrary log/error payloads. */
export function redactAuthSecrets(value: unknown): unknown {
  const sensitiveKeys = new Set([
    'password',
    'passwordHash',
    'passwordSalt',
    'salt',
    'hash',
    'customToken',
    'token',
    'idToken',
    'refreshToken',
  ])

  if (Array.isArray(value)) {
    return value.map((item) => redactAuthSecrets(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKeys.has(key)) {
      result[key] = nested == null || nested === '' ? '' : '[redacted]'
      continue
    }
    result[key] = redactAuthSecrets(nested)
  }
  return result
}
