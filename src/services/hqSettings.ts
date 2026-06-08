import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'

export type HeadquartersInfo = {
  address: string
  email: string
  memo: string
  name: string
  phoneNumber: string
  representativeName: string
}

const hqSettingsCollectionName = 'hqSettings'
const headquartersInfoDocumentId = 'headquartersInfo'

export const defaultHeadquartersInfo: HeadquartersInfo = {
  address: '',
  email: '',
  memo: '',
  name: '株式会社千葉福祉サポート',
  phoneNumber: '',
  representativeName: '山本信勝',
}

const toString = (value: unknown) => (typeof value === 'string' ? value : '')

const getHeadquartersInfoRef = () => {
  const db = getFirestore(getFirebaseApp())
  return doc(db, hqSettingsCollectionName, headquartersInfoDocumentId)
}

export async function fetchHeadquartersInfo() {
  const snapshot = await getDoc(getHeadquartersInfoRef())
  if (!snapshot.exists()) return defaultHeadquartersInfo
  const data = snapshot.data()

  return {
    address: toString(data.address),
    email: toString(data.email),
    memo: toString(data.memo),
    name: toString(data.name) || defaultHeadquartersInfo.name,
    phoneNumber: toString(data.phoneNumber),
    representativeName: toString(data.representativeName) || defaultHeadquartersInfo.representativeName,
  }
}

export async function saveHeadquartersInfo(headquartersInfo: HeadquartersInfo) {
  await setDoc(
    getHeadquartersInfoRef(),
    {
      ...headquartersInfo,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  return headquartersInfo
}
