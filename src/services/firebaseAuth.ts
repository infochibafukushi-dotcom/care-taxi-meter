import { FirebaseError } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut, type User } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { AUTH_V2_ENABLED } from '../config/authFlags'
import type { StaffMember, StaffRole } from '../types/work'

const functionsRegion = 'asia-northeast1'

export type LoginStaffResult = {
  customToken: string
  companyName: string
  staffMember: StaffMember
}

type LoginStaffResponse = {
  customToken?: string
  token?: string
  companyName?: string
  staffMember?: Record<string, unknown>
  staff?: Record<string, unknown>
  result?: Record<string, unknown>
}

const validRoles: StaffRole[] = ['driver', 'manager', 'owner', 'hq_admin']

const getFirebaseAuth = () => getAuth(getFirebaseApp())

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')

const toRole = (value: unknown): StaffRole => {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  return typeof value === 'string' && validRoles.includes(value as StaffRole)
    ? (value as StaffRole)
    : 'driver'
}

const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback

const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const isCallableNotFoundError = (error: unknown) =>
  error instanceof FirebaseError && error.code === 'functions/not-found'

const unwrapLoginStaffPayload = (data: unknown): Record<string, unknown> | null => {
  if (!data || typeof data !== 'object') {
    return null
  }

  const root = data as LoginStaffResponse
  if (root.result && typeof root.result === 'object') {
    return root.result
  }

  return root as Record<string, unknown>
}

const normalizeLoginStaffMember = (data: Record<string, unknown>, id: string): StaffMember => {
  const role = toRole(data.role)

  return {
    id,
    companyId: toStringValue(data.companyId) || toStringValue(data.franchiseeId),
    franchiseeId: toStringValue(data.franchiseeId) || toStringValue(data.companyId),
    storeId: toStringValue(data.storeId),
    storeName: toStringValue(data.storeName),
    userId: toStringValue(data.userId) || toStringValue(data.loginId),
    loginId: toStringValue(data.loginId) || toStringValue(data.userId),
    password: '',
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role,
    canDrive: toBooleanValue(data.canDrive, role === 'owner' || role === 'driver'),
    isActive: toBooleanValue(data.isActive, toBooleanValue(data.enabled)),
    phoneNumber: toStringValue(data.phoneNumber),
    email: toStringValue(data.email),
    address: toStringValue(data.address),
    licenseNumber: toStringValue(data.licenseNumber),
    licenseExpiresAt: toStringValue(data.licenseExpiresAt),
    accidentHistory: toStringValue(data.accidentHistory),
    memo: toStringValue(data.memo),
    enabled: toBooleanValue(data.enabled, toBooleanValue(data.isActive)),
    sortOrder: toNumberValue(data.sortOrder),
  }
}

const assertNoSensitiveAuthFields = (payload: Record<string, unknown>, context: string) => {
  const forbidden = ['password', 'passwordHash', 'passwordSalt', 'salt', 'hash']
  for (const key of forbidden) {
    if (key in payload && payload[key] != null && payload[key] !== '') {
      console.error(`[firebaseAuth] ${context} unexpectedly included sensitive field`, { field: key })
      throw new Error('認証応答に不正な項目が含まれています。')
    }
  }
  const staffSource = payload.staffMember ?? payload.staff
  if (staffSource && typeof staffSource === 'object') {
    for (const key of forbidden) {
      if (key in (staffSource as Record<string, unknown>)) {
        const value = (staffSource as Record<string, unknown>)[key]
        if (value != null && value !== '') {
          console.error(`[firebaseAuth] ${context} staff payload included sensitive field`, {
            field: key,
          })
          throw new Error('認証応答に不正な項目が含まれています。')
        }
      }
    }
  }
}

const parseLoginStaffResponse = (data: unknown, context: string): LoginStaffResult | null => {
  const payload = unwrapLoginStaffPayload(data)
  if (!payload) {
    console.error(`[firebaseAuth] ${context} response payload is empty`, {
      payloadType: data === null ? 'null' : typeof data,
    })
    return null
  }

  assertNoSensitiveAuthFields(payload, context)

  const customToken = toStringValue(payload.customToken) || toStringValue(payload.token)
  const staffSource = payload.staffMember ?? payload.staff
  const staffRecord =
    staffSource && typeof staffSource === 'object' ? (staffSource as Record<string, unknown>) : null
  const staffId = staffRecord ? toStringValue(staffRecord.id) : ''

  if (!customToken || !staffRecord || !staffId) {
    console.error(`[firebaseAuth] ${context} response missing required fields`, {
      payloadKeys: Object.keys(payload),
      hasCustomToken: Boolean(customToken),
      hasStaffMember: Boolean(staffRecord),
      hasStaffId: Boolean(staffId),
    })
    return null
  }

  const staffMember = normalizeLoginStaffMember(staffRecord, staffId)
  console.info(`[firebaseAuth] ${context} response parsed`, {
    staffId: staffMember.id,
    role: staffMember.role,
    companyId: staffMember.companyId,
    payloadKeys: Object.keys(payload).filter(
      (key) => !['customToken', 'token', 'password', 'passwordHash', 'passwordSalt'].includes(key),
    ),
  })

  return {
    customToken,
    companyName: toStringValue(payload.companyName),
    staffMember,
  }
}

export const waitForFirebaseAuthUser = (): Promise<User | null> =>
  new Promise((resolve) => {
    const auth = getFirebaseAuth()
    if (auth.currentUser) {
      resolve(auth.currentUser)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      resolve(user)
    })
  })

async function callLoginCallable(
  functionName: 'loginStaff' | 'loginStaffV2',
  payload: { companyId: string; userId: string; password: string },
) {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const loginCallable = httpsCallable<
    { companyId: string; userId: string; password: string },
    LoginStaffResponse
  >(functions, functionName)
  return loginCallable(payload)
}

export async function signInStaffWithFirebaseAuth({
  companyId,
  password,
  userId,
}: {
  companyId: string
  password: string
  userId: string
}): Promise<LoginStaffResult | null> {
  // AUTH_V2_ENFORCE is intentionally hard-off on the client this phase.
  // Selective V2 testing requires VITE_AUTH_V2_ENABLED=true; default keeps loginStaff.
  const functionName = AUTH_V2_ENABLED ? 'loginStaffV2' : 'loginStaff'

  try {
    const response = await callLoginCallable(functionName, { companyId, userId, password })
    const parsed = parseLoginStaffResponse(response.data, functionName)
    if (!parsed) {
      return null
    }

    await signInWithCustomToken(getFirebaseAuth(), parsed.customToken)
    console.info('[firebaseAuth] signInWithCustomToken succeeded', {
      staffId: parsed.staffMember.id,
      authUid: getFirebaseAuth().currentUser?.uid ?? null,
      authPath: functionName,
    })

    return parsed
  } catch (error) {
    const callableError = error as {
      code?: unknown
      message?: unknown
      details?: unknown
      name?: unknown
    }
    console.error(`[firebaseAuth] ${functionName} callable failed`, {
      code: typeof callableError.code === 'string' ? callableError.code : null,
      message: typeof callableError.message === 'string' ? callableError.message : String(error),
      detailsKeys:
        callableError.details && typeof callableError.details === 'object'
          ? Object.keys(callableError.details as Record<string, unknown>)
          : null,
      name: typeof callableError.name === 'string' ? callableError.name : null,
    })

    if (isCallableNotFoundError(error)) {
      return null
    }

    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('resource-exhausted') || message.includes('しばらくしてから再度お試しください')) {
      throw new Error('しばらくしてから再度お試しください。', { cause: error })
    }

    throw error
  }
}

export async function signOutFirebaseAuth() {
  const auth = getFirebaseAuth()
  if (!auth.currentUser) {
    return
  }
  await signOut(auth)
}
