import type { StaffMember, StaffRole, Store } from '../../types/work'
import { staffRoles } from '../../types/work'

type StaffManagementPanelProps = {
  message: string
  staffMembers: StaffMember[]
  stores: Store[]
  onAdd: () => void
  onSave: () => void
  onUpdate: (id: string, updates: Partial<StaffMember>) => void
}

export function StaffManagementPanel({
  message,
  staffMembers,
  stores,
  onAdd,
  onSave,
  onUpdate,
}: StaffManagementPanelProps) {
  const handleStoreChange = (staffMember: StaffMember, storeId: string) => {
    const store = stores.find((item) => item.id === storeId)
    onUpdate(staffMember.id, {
      storeId,
      storeName: store?.name ?? '',
      tenantId: store?.tenantId ?? '',
      organizationId: store?.organizationId ?? '',
    })
  }

  return (
    <section className="admin-master-panel" aria-labelledby="staff-management-title">
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Staff</p>
          <h2 id="staff-management-title">スタッフ管理</h2>
        </div>
        <div className="admin-master-actions">
          <button type="button" onClick={onAdd}>+ スタッフ追加</button>
          <button type="button" onClick={onSave}>保存</button>
        </div>
      </div>
      {message ? <p className="save-note">{message}</p> : null}
      <div className="admin-master-table-wrap">
        <table className="admin-master-table">
          <thead>
            <tr>
              <th>表示</th>
              <th>順</th>
              <th>スタッフ名</th>
              <th>ロール</th>
              <th>店舗</th>
              <th>メール</th>
            </tr>
          </thead>
          <tbody>
            {staffMembers.length > 0 ? (
              staffMembers.map((staffMember) => (
                <tr key={staffMember.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={staffMember.enabled}
                      onChange={(event) => onUpdate(staffMember.id, { enabled: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      min="1"
                      type="number"
                      value={staffMember.sortOrder}
                      onChange={(event) => onUpdate(staffMember.id, { sortOrder: Math.max(Number(event.target.value) || 1, 1) })}
                    />
                  </td>
                  <td>
                    <input
                      value={staffMember.name}
                      onChange={(event) => onUpdate(staffMember.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={staffMember.role}
                      onChange={(event) => onUpdate(staffMember.id, { role: event.target.value as StaffRole })}
                    >
                      {staffRoles.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={staffMember.storeId}
                      onChange={(event) => handleStoreChange(staffMember, event.target.value)}
                    >
                      <option value="">未設定</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>{store.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={staffMember.email}
                      onChange={(event) => onUpdate(staffMember.id, { email: event.target.value })}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>スタッフが未登録です。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
