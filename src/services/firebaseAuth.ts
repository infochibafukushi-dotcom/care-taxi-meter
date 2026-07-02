import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut, type User } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember } from '../types/work'

const functionsRegion = 'asia-northeast1'

type LoginStaffResponse = {
  customToken: string
  companyName?: string
  staffMember: StaffMember
}

const getFirebaseAuth = () => getAuth(getFirebaseApp())

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

export async function signInStaffWithFirebaseAuth({
  companyId,
  password,
  userId,
}: {
  companyId: string
  password: string
  userId: string
}): Promise<{ staffMember: StaffMember; companyName: string } | null> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const loginStaff = httpsCallable<
    { companyId: string; userId: string; password: string },
    LoginStaffResponse
  >(functions, 'loginStaff')

  try {
    const response = await loginStaff({ companyId, userId, password })
    const customToken = response.data?.customToken
    const staffMember = response.data?.staffMember

    if (!customToken || !staffMember?.id) {
      return null
    }

    await signInWithCustomToken(getFirebaseAuth(), customToken)

    return {
      staffMember,
      companyName: response.data.companyName || '',
    }
  } catch (error) {
    const callableError = error as {
      code?: unknown
      message?: unknown
      details?: unknown
      name?: unknown
    }
    // Temporary production debugging log. Do not include credentials.
    console.error('[firebaseAuth] loginStaff callable failed', {
      code: typeof callableError.code === 'string' ? callableError.code : null,
      message: typeof callableError.message === 'string' ? callableError.message : String(error),
      details: callableError.details ?? null,
      name: typeof callableError.name === 'string' ? callableError.name : null,
    })
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not-found')) {
      return null
    }
    if (message.includes('resource-exhausted') || message.includes('しばらくしてから再度お試しください')) {
      throw new Error('しばらくしてから再度お試しください。')
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
