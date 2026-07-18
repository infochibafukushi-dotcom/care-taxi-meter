import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { defaultAdminStaffMemberId, defaultAdminStaffUserId } from './staffMembers'
import { defaultCompany } from './companies'
import { headquartersStore } from './stores'
import { saveStaffMemberProfileViaFunctions } from './staffAuthAdmin'
import {
  assertDevelopmentResetAllowed,
  matchesDevelopmentResetConfirmText,
  readClientDevelopmentResetConfig,
  validateBootstrapAdminPassword,
} from '../utils/developmentResetGuard'

const resetBatchSize = 450

const resetCollections = [
  'auditLogs',
  'caseRecords',
  'workSessions',
  'meterSettings',
  'vehicles',
  'stores',
  'staffMembers',
  'companies',
]

export type ResetSummary = {
  deletedByCollection: Record<string, number>
  recreatedDocuments: string[]
  projectId: string
}

export type HeadquartersDevelopmentResetInput = {
  projectId: string
  confirmText: string
  bootstrapAdminPassword: string
}

async function deleteCollection(collectionName: string) {
  const db = getFirestore(getFirebaseApp())
  let deletedCount = 0

  while (true) {
    const snapshots = await getDocs(
      query(collection(db, collectionName), orderBy('__name__'), limit(resetBatchSize)),
    )

    if (snapshots.empty) {
      return deletedCount
    }

    const batch = writeBatch(db)
    snapshots.docs.forEach((snapshot) => {
      batch.delete(snapshot.ref)
    })
    await batch.commit()
    deletedCount += snapshots.size
  }
}

async function recreateInitialData(bootstrapAdminPassword: string) {
  const db = getFirestore(getFirebaseApp())
  const recreatedDocuments = [
    `companies/${defaultCompany.id}`,
    `stores/${headquartersStore.id}`,
    `staffMembers/${defaultAdminStaffMemberId}`,
  ]

  await setDoc(doc(db, 'companies', defaultCompany.id), {
    ...defaultCompany,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'stores', headquartersStore.id), {
    ...headquartersStore,
    companyId: defaultCompany.id,
    franchiseeId: defaultCompany.id,
    storeName: headquartersStore.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'staffMembers', defaultAdminStaffMemberId), {
    id: defaultAdminStaffMemberId,
    companyId: defaultCompany.id,
    franchiseeId: defaultCompany.id,
    storeId: headquartersStore.id,
    storeName: headquartersStore.name,
    userId: defaultAdminStaffUserId,
    name: defaultAdminStaffUserId,
    role: 'hq_admin',
    canDrive: false,
    isActive: true,
    phoneNumber: '',
    email: '',
    address: '',
    licenseNumber: '',
    licenseExpiresAt: '',
    accidentHistory: '',
    memo: 'FC本部初期管理者アカウント（開発リセットで再作成）',
    enabled: true,
    sortOrder: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Phase3B: bootstrap password goes to staffCredentials via Functions only.
  await saveStaffMemberProfileViaFunctions({
    staffMember: {
      id: defaultAdminStaffMemberId,
      companyId: defaultCompany.id,
      franchiseeId: defaultCompany.id,
      storeId: headquartersStore.id,
      storeName: headquartersStore.name,
      userId: defaultAdminStaffUserId,
      loginId: defaultAdminStaffUserId,
      name: defaultAdminStaffUserId,
      role: 'hq_admin',
      canDrive: false,
      isActive: true,
      phoneNumber: '',
      email: '',
      address: '',
      licenseNumber: '',
      licenseExpiresAt: '',
      accidentHistory: '',
      memo: 'FC本部初期管理者アカウント（開発リセットで再作成）',
      enabled: true,
      sortOrder: 1,
    },
    password: bootstrapAdminPassword,
  })

  return recreatedDocuments
}

const resolveClientProjectId = () => {
  const config = readClientDevelopmentResetConfig(import.meta.env)
  return (
    config.projectId ||
    (typeof import.meta.env.VITE_FIREBASE_PROJECT_ID === 'string'
      ? import.meta.env.VITE_FIREBASE_PROJECT_ID
      : '')
  )
}

/**
 * Destructive HQ reset — only after multi-layer development guard + confirm + bootstrap password.
 * Never call from production builds (UI is gated; this also enforces fail-closed).
 */
export async function resetHeadquartersDevelopmentData(
  input: HeadquartersDevelopmentResetInput,
): Promise<ResetSummary> {
  const envConfig = readClientDevelopmentResetConfig(import.meta.env)
  const projectId = assertDevelopmentResetAllowed({
    projectId: input.projectId || resolveClientProjectId(),
    enabled: envConfig.enabled,
    allowedProjectIds: envConfig.allowedProjectIds,
    isCi: false,
  })

  if (!matchesDevelopmentResetConfirmText(input.confirmText, projectId)) {
    throw new Error('確認文字列が一致しません。')
  }

  if (input.projectId.trim() !== projectId) {
    throw new Error('入力された project ID が現在の環境と一致しません。')
  }

  const passwordCheck = validateBootstrapAdminPassword(input.bootstrapAdminPassword)
  if (!passwordCheck.ok) {
    throw new Error(passwordCheck.message)
  }

  const deletedByCollection: ResetSummary['deletedByCollection'] = {}

  for (const collectionName of resetCollections) {
    deletedByCollection[collectionName] = await deleteCollection(collectionName)
  }

  const recreatedDocuments = await recreateInitialData(input.bootstrapAdminPassword)

  return {
    deletedByCollection,
    recreatedDocuments,
    projectId,
  }
}
