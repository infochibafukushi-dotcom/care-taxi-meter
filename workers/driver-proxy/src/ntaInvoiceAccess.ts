/**
 * Worker 側のインボイス登録確認権限。
 * フロントの `canAccessAccounting` / `canAccessInvoiceRegistry`（src/types/permissions.ts）と
 * 同じ判定に揃える。新しい role 名は追加しない。
 *
 * 許可:
 * - owner / franchisee_owner … FC加盟店オーナー（経理 UI 利用可）
 * - hq_admin / superAdmin … FC本部管理者
 *
 * 不許可（一例）:
 * - manager / store_manager … 経理 UI 権限なし（Firestore isAccountingUser とは別）
 * - driver
 */
export const normalizeAccountingAccessRole = (
  role: string,
): 'owner' | 'hq_admin' | 'manager' | 'driver' | '' => {
  const trimmed = role.trim()
  if (trimmed === 'superAdmin' || trimmed === 'hq_admin') return 'hq_admin'
  if (trimmed === 'franchisee_owner' || trimmed === 'owner') return 'owner'
  if (trimmed === 'store_manager' || trimmed === 'manager') return 'manager'
  if (trimmed === 'driver') return 'driver'
  return ''
}

/** Mirrors src/types/permissions.ts `canAccessAccounting` after claim-role normalization. */
export const canUseInvoiceRegistry = (role: string): boolean => {
  const normalized = normalizeAccountingAccessRole(role)
  return normalized === 'owner' || normalized === 'hq_admin'
}
