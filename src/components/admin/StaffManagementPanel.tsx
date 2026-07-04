import type { StaffMember, StaffRole, Store } from '../../types/work'
import { ROLE_LABELS, staffRoleSelectGroups } from '../../types/permissions'

type StaffManagementPanelProps = {
  message: string
  staffMembers: StaffMember[]
  stores: Store[]
  onAdd: () => void
  onSave: () => void
  onUpdate: (id: string, updates: Partial<StaffMember>) => void
  canAssignHqAdmin?: boolean
  canSelectStore?: boolean
  canEdit?: boolean
}

export function StaffManagementPanel({
  message,
  staffMembers,
  stores,
  onAdd,
  onSave,
  onUpdate,
  canAssignHqAdmin = false,
  canSelectStore = true,
  canEdit = true,
}: StaffManagementPanelProps) {
  const handleStoreChange = (staffMember: StaffMember, storeId: string) => {
    const store = stores.find((item) => item.id === storeId)
    onUpdate(staffMember.id, {
      storeId,
      storeName: store?.name ?? '',
    })
  }

  return (
    <section className="admin-master-panel" aria-labelledby="staff-management-title">
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Staff</p>
          <h2 id="staff-management-title">従業員管理</h2>
        </div>
        {canEdit ? (
          <div className="admin-master-actions">
            <button type="button" onClick={onAdd}>+ 従業員追加</button>
            <button type="button" onClick={onSave}>保存</button>
          </div>
        ) : null}
      </div>
      {message ? <p className="save-note">{message}</p> : null}
      {!canEdit ? (
        <p className="save-note" role="status">従業員情報の編集権限がありません。</p>
      ) : null}
      <div className="admin-master-table-wrap">
        <table className="admin-master-table admin-master-table--wide">
          <thead>
            <tr>
              <th>有効</th>
              <th>順</th>
              <th>会社ID</th>
              <th>店舗</th>
              <th>氏名</th>
              <th>ログインID</th>
              <th>パスワード</th>
              <th>権限</th>
              <th>状態</th>
              <th>電話番号</th>
              <th>メール</th>
              <th>住所</th>
              <th>免許番号</th>
              <th>免許期限</th>
              <th>事故歴</th>
              <th>メモ</th>
            </tr>
          </thead>
          <tbody>
            {staffMembers.length > 0 ? (
              staffMembers.map((staffMember) => (
                <tr key={staffMember.id}>
                  <td><input type="checkbox" checked={staffMember.enabled} onChange={(event) => onUpdate(staffMember.id, { enabled: event.target.checked })} /></td>
                  <td><input min="1" type="number" value={staffMember.sortOrder} onChange={(event) => onUpdate(staffMember.id, { sortOrder: Math.max(Number(event.target.value) || 1, 1) })} /></td>
                  <td><input value={staffMember.companyId} onChange={(event) => onUpdate(staffMember.id, { companyId: event.target.value })} /></td>
                  <td>
                    {canSelectStore ? (
                      <select value={staffMember.storeId} onChange={(event) => handleStoreChange(staffMember, event.target.value)}>
                        <option value="">未設定</option>
                        {stores
                          .filter((store) => !staffMember.companyId || store.companyId === staffMember.companyId)
                          .map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                      </select>
                    ) : (
                      <span>{staffMember.storeName || stores.find((store) => store.id === staffMember.storeId)?.name || '既定店舗'}</span>
                    )}
                  </td>
                  <td><input value={staffMember.name} onChange={(event) => onUpdate(staffMember.id, { name: event.target.value })} /></td>
                  <td><input value={staffMember.userId || staffMember.loginId || staffMember.name} onChange={(event) => onUpdate(staffMember.id, { userId: event.target.value, loginId: event.target.value })} /></td>
                  <td><input type="password" value={staffMember.password} onChange={(event) => onUpdate(staffMember.id, { password: event.target.value })} /></td>
                  <td>
                    <select
                      value={staffMember.role}
                      disabled={staffMember.role === 'hq_admin' && !canAssignHqAdmin}
                      onChange={(event) => onUpdate(staffMember.id, { role: event.target.value as StaffRole })}
                    >
                      {staffRoleSelectGroups.map((group, groupIndex) =>
                        group.label ? (
                          <optgroup key={group.label} label={group.label}>
                            {group.roles.map((role) => (
                              <option key={role} value={role} disabled={role === 'hq_admin' && !canAssignHqAdmin}>
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </optgroup>
                        ) : (
                          group.roles.map((role) => (
                            <option key={`${groupIndex}-${role}`} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))
                        ),
                      )}
                    </select>
                  </td>
                  <td>
                    <select value={staffMember.status ?? (staffMember.enabled ? 'employed' : 'disabled')} onChange={(event) => onUpdate(staffMember.id, { status: event.target.value as StaffMember['status'], enabled: event.target.value !== 'disabled' && event.target.value !== 'retired', isActive: event.target.value !== 'disabled' && event.target.value !== 'retired' })}>
                      <option value="employed">在籍中</option>
                      <option value="leave">休職中</option>
                      <option value="retired">退職</option>
                      <option value="disabled">無効</option>
                    </select>
                  </td>
                  <td><input value={staffMember.phoneNumber} onChange={(event) => onUpdate(staffMember.id, { phoneNumber: event.target.value })} /></td>
                  <td><input value={staffMember.email} onChange={(event) => onUpdate(staffMember.id, { email: event.target.value })} /></td>
                  <td><input value={staffMember.address} onChange={(event) => onUpdate(staffMember.id, { address: event.target.value })} /></td>
                  <td><input value={staffMember.licenseNumber} onChange={(event) => onUpdate(staffMember.id, { licenseNumber: event.target.value })} /></td>
                  <td><input type="date" value={staffMember.licenseExpiresAt} onChange={(event) => onUpdate(staffMember.id, { licenseExpiresAt: event.target.value })} /></td>
                  <td><input value={staffMember.accidentHistory} onChange={(event) => onUpdate(staffMember.id, { accidentHistory: event.target.value })} /></td>
                  <td><input value={staffMember.memo} onChange={(event) => onUpdate(staffMember.id, { memo: event.target.value })} /></td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={16}>従業員が未登録です。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
