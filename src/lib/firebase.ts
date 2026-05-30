import { getApp, getApps, initializeApp } from 'firebase/app'
import type { FirebaseApp, FirebaseOptions } from 'firebase/app'

const defaultFirebaseProjectId = 'care-taxi-meter'

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    `${defaultFirebaseProjectId}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseProjectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    `${defaultFirebaseProjectId}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredFirebaseConfig = [
  ['apiKey', 'VITE_FIREBASE_API_KEY'],
  ['authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'VITE_FIREBASE_PROJECT_ID'],
  ['appId', 'VITE_FIREBASE_APP_ID'],
] as const

export const missingFirebaseConfigEnvNames = requiredFirebaseConfig
  .filter(([configKey]) => !firebaseConfig[configKey])
  .map(([, envName]) => envName)

export const isFirebaseConfigured = missingFirebaseConfigEnvNames.length === 0

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      `Firebase接続設定が不足しています: ${missingFirebaseConfigEnvNames.join(', ')}`,
    )
  }

  return getApps().length ? getApp() : initializeApp(firebaseConfig)
}
