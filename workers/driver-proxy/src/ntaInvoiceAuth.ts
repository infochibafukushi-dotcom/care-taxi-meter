import { canUseInvoiceRegistry, normalizeAccountingAccessRole } from './ntaInvoiceAccess.ts'

export type InvoiceAuthActor = {
  userId: string
  staffId: string
  role: string
  franchiseeId: string
  storeId: string
}

export type InvoiceAuthResult =
  | { ok: true; actor: InvoiceAuthActor }
  | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN'; message: string }

export { canUseInvoiceRegistry, normalizeAccountingAccessRole } from './ntaInvoiceAccess.ts'

const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (padded.length % 4)) % 4
  const base64 = padded + '='.repeat(padLength)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const decodeJwtJson = <T>(part: string): T | null => {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(part))
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

type GoogleCertCache = {
  expiresAt: number
  certs: Record<string, string>
}

let certCache: GoogleCertCache | null = null

/** test helper */
export const clearGoogleCertCacheForTests = () => {
  certCache = null
}

const fetchGoogleCerts = async (fetchImpl: typeof fetch): Promise<Record<string, string>> => {
  const now = Date.now()
  if (certCache && certCache.expiresAt > now) {
    return certCache.certs
  }

  const response = await fetchImpl(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  )
  if (!response.ok) {
    throw new Error('failed_to_fetch_google_certs')
  }

  const certs = (await response.json()) as Record<string, string>
  const cacheControl = response.headers.get('cache-control') ?? ''
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl)
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600
  certCache = {
    certs,
    expiresAt: now + Math.max(60, maxAgeSec) * 1000,
  }
  return certs
}

const pemCertificateToDer = (pem: string): Uint8Array => {
  const cleaned = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Extract SubjectPublicKeyInfo DER bytes from an X.509 certificate. */
export const extractSpkiFromX509 = (der: Uint8Array): Uint8Array => {
  let offset = 0

  const readByte = () => {
    if (offset >= der.length) throw new Error('invalid_der')
    return der[offset++]
  }

  const readLength = () => {
    const first = readByte()
    if (first < 0x80) return first
    const count = first & 0x7f
    if (count === 0 || count > 4) throw new Error('invalid_der')
    let length = 0
    for (let i = 0; i < count; i += 1) {
      length = (length << 8) | readByte()
    }
    return length
  }

  const skipTag = (expectedTag: number) => {
    const tag = readByte()
    if (tag !== expectedTag) throw new Error('invalid_der')
    const length = readLength()
    offset += length
  }

  const enterSequence = () => {
    const tag = readByte()
    if (tag !== 0x30) throw new Error('invalid_der')
    return readLength()
  }

  enterSequence() // Certificate
  enterSequence() // tbsCertificate

  if (der[offset] === 0xa0) {
    skipTag(0xa0) // version
  }
  skipTag(0x02) // serialNumber
  skipTag(0x30) // signature
  skipTag(0x30) // issuer
  skipTag(0x30) // validity
  skipTag(0x30) // subject

  const spkiStart = offset
  const tag = readByte()
  if (tag !== 0x30) throw new Error('invalid_der')
  const length = readLength()
  offset += length
  return der.subarray(spkiStart, offset)
}

export type VerifyFirebaseIdTokenOptions = {
  idToken: string
  projectId: string
  fetchImpl?: typeof fetch
  /** テスト用: 署名検証をスキップして claims のみ読む */
  unsafeDecodeOnly?: boolean
}

/**
 * Firebase ID Token を検証し、スタッフ claims を返す。
 * Worker に firebase-admin は入れず、Google x509 + Web Crypto で検証する。
 */
export const verifyFirebaseIdToken = async ({
  idToken,
  projectId,
  fetchImpl = fetch,
  unsafeDecodeOnly = false,
}: VerifyFirebaseIdTokenOptions): Promise<InvoiceAuthResult> => {
  const trimmedProjectId = projectId.trim()
  if (!trimmedProjectId) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: '認証設定が完了していません。管理者へお問い合わせください。',
    }
  }

  const token = idToken.trim()
  if (!token) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'ログインが必要です。',
    }
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
  }

  const header = decodeJwtJson<{ alg?: string; kid?: string }>(parts[0])
  const payload = decodeJwtJson<Record<string, unknown>>(parts[1])
  if (!header || !payload) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
  }

  if (!unsafeDecodeOnly) {
    if (header.alg !== 'RS256' || !header.kid) {
      return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
    }

    try {
      const certs = await fetchGoogleCerts(fetchImpl)
      const pem = certs[header.kid]
      if (!pem) {
        return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
      }

      const spki = extractSpkiFromX509(pemCertificateToDer(pem))
      const key = await crypto.subtle.importKey(
        'spki',
        spki,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
      const signature = base64UrlToBytes(parts[2])
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signature,
        signingInput,
      )
      if (!valid) {
        return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
      }
    } catch {
      return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
    }
  }

  const iss = String(payload.iss ?? '')
  const aud = String(payload.aud ?? '')
  const expectedIss = `https://securetoken.google.com/${trimmedProjectId}`
  if (iss !== expectedIss || aud !== trimmedProjectId) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
  }

  const exp = Number(payload.exp ?? 0)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() - 60_000) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'ログインの有効期限が切れています。再ログインしてください。',
    }
  }

  const role = String(payload.role ?? '')
  if (!canUseInvoiceRegistry(role)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: '経理機能を利用する権限がありません。',
    }
  }

  const franchiseeId =
    String(payload.franchiseeId ?? '').trim() || String(payload.companyId ?? '').trim()
  const storeId = String(payload.storeId ?? '').trim()
  const staffId = String(payload.staffId ?? '').trim()
  const userId = String(payload.user_id ?? payload.sub ?? staffId).trim()

  if (!userId || !franchiseeId) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'ログインが必要です。' }
  }

  const normalizedRole = normalizeAccountingAccessRole(role)

  return {
    ok: true,
    actor: {
      userId,
      staffId: staffId || userId,
      role: normalizedRole || role,
      franchiseeId,
      storeId,
    },
  }
}

export const extractBearerToken = (request: Request): string => {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? ''
}
