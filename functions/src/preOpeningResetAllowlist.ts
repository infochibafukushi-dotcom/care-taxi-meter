/**
 * Allowlist for meter-side pre-opening business data reset.
 * Only paths listed here may be counted or deleted.
 * Unknown collections / Storage prefixes are never deleted.
 */

/** Top-level Firestore collections deleted by franchiseeId + storeId scope. */
export const PRE_OPENING_RESET_SCOPED_COLLECTIONS = [
  'caseRecords',
  'workSessions',
  'auditLogs',
  'maintenanceLogs',
  'adminActionLogs',
  'operationLogs',
  'debugLogs',
  'errorLogs',
  'resetLogs',
] as const

/** Extra Firestore targets with custom delete/count logic (still allowlisted). */
export const PRE_OPENING_RESET_EXTRA_TARGETS = [
  'caseCounters',
  'staffAttendance',
  'loginAttempts',
] as const

/** Storage path templates that may be deleted. Never include accounting/. */
export const PRE_OPENING_RESET_STORAGE_PREFIX_TEMPLATES = [
  'operations/{franchiseeId}/{storeId}/',
  'receipts/{franchiseeId}/{storeId}/',
] as const

/**
 * Explicitly protected data categories. Documented for capability/UI;
 * none of these are on the delete allowlist.
 */
export const PRE_OPENING_RESET_PRESERVED_CATEGORIES = [
  'franchisees',
  'stores',
  'employees',
  'vehicles',
  'fareSettings',
  'meterSettings',
  'companySettings',
  'firebaseAuth',
  'accounting',
  'accountingReceipts',
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'accountingFixedAssets',
  'accountingSettlementAuxiliary',
  'accountingStorage',
] as const

/** Firestore collections that must never appear on the delete allowlist. */
export const PRE_OPENING_RESET_PROTECTED_FIRESTORE_COLLECTIONS = [
  'companies',
  'stores',
  'staffMembers',
  'vehicles',
  'meterSettings',
  'hqSettings',
  'fcPlans',
  'appSettings',
  'accountingReceipts',
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'accountingFixedAssets',
  'accountingSettlementAuxiliary',
] as const

export const PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT = 'accounting/' as const

export type PreOpeningResetScopedCollection =
  (typeof PRE_OPENING_RESET_SCOPED_COLLECTIONS)[number]

export type PreOpeningResetExtraTarget = (typeof PRE_OPENING_RESET_EXTRA_TARGETS)[number]

export type PreOpeningResetFirestoreTargetKey =
  | PreOpeningResetScopedCollection
  | PreOpeningResetExtraTarget
  | 'storageFiles'

export const PRE_OPENING_RESET_FIRESTORE_TARGET_KEYS = [
  ...PRE_OPENING_RESET_SCOPED_COLLECTIONS,
  ...PRE_OPENING_RESET_EXTRA_TARGETS,
  'storageFiles',
] as const satisfies readonly PreOpeningResetFirestoreTargetKey[]

export function buildAllowlistedStoragePrefixes(
  franchiseeId: string,
  storeId: string,
): string[] {
  return PRE_OPENING_RESET_STORAGE_PREFIX_TEMPLATES.map((template) =>
    template
      .replace('{franchiseeId}', franchiseeId)
      .replace('{storeId}', storeId),
  )
}

export function isAllowlistedScopedCollection(collectionName: string): boolean {
  return (PRE_OPENING_RESET_SCOPED_COLLECTIONS as readonly string[]).includes(collectionName)
}

export function isProtectedFirestoreCollection(collectionName: string): boolean {
  return (PRE_OPENING_RESET_PROTECTED_FIRESTORE_COLLECTIONS as readonly string[]).includes(
    collectionName,
  )
}

export function isProtectedStoragePath(storagePath: string): boolean {
  return storagePath === PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT
    || storagePath.startsWith(PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT)
}

export function assertAllowlistExcludesAccounting(): void {
  for (const collectionName of PRE_OPENING_RESET_SCOPED_COLLECTIONS) {
    if (collectionName.startsWith('accounting') || isProtectedFirestoreCollection(collectionName)) {
      throw new Error(`Allowlist must not include protected collection: ${collectionName}`)
    }
  }
  for (const template of PRE_OPENING_RESET_STORAGE_PREFIX_TEMPLATES) {
    if (template.startsWith(PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT) || template.includes('/accounting/')) {
      throw new Error(`Storage allowlist must not include accounting paths: ${template}`)
    }
  }
}

assertAllowlistExcludesAccounting()
