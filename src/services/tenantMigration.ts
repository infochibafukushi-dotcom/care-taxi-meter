import { collection, doc, getDoc, getDocs, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { defaultFranchiseeId, defaultStoreId, defaultStoreName } from './tenancy'
import { ensureDefaultStore } from './stores'
import { sanitizeMeterSettings } from './meterSettings'

const tenantCollections = ['caseRecords', 'staffMembers', 'vehicles', 'workSessions', 'reservations']

export async function migrateLegacyDefaultTenantData() {
  const db = getFirestore(getFirebaseApp())
  await ensureDefaultStore(defaultFranchiseeId)

  const legacySettingsSnapshot = await getDoc(doc(db, 'appSettings', 'meterSettings'))
  if (legacySettingsSnapshot.exists()) {
    await setDoc(
      doc(db, 'meterSettings', `${defaultFranchiseeId}_${defaultStoreId}`),
      {
        ...sanitizeMeterSettings(legacySettingsSnapshot.data()),
        companyId: defaultFranchiseeId,
        franchiseeId: defaultFranchiseeId,
        storeId: defaultStoreId,
        migratedFrom: 'appSettings/meterSettings',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  }

  for (const collectionName of tenantCollections) {
    const snapshots = await getDocs(collection(db, collectionName))
    await Promise.all(
      snapshots.docs.map((snapshot) => {
        const data = snapshot.data()
        if (data.franchiseeId && data.storeId) {
          return Promise.resolve()
        }

        return updateDoc(snapshot.ref, {
          companyId: data.companyId || defaultFranchiseeId,
          franchiseeId: data.franchiseeId || data.companyId || defaultFranchiseeId,
          storeId: data.storeId || defaultStoreId,
          storeName: data.storeName || defaultStoreName,
          migratedAt: serverTimestamp(),
        })
      }),
    )
  }
}
