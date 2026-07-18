import { useState } from 'react'
import type { StaffMember, StaffRole, Store } from '../../types/work'
import { ROLE_LABELS, staffRoleSelectGroups } from '../../types/permissions'
import {
  deleteStaffMemberCompletely,
  formatStaffCompleteDeleteSummary,
  isStaffMemberPersisted,
} from '../../services/staffDeletion'

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
  canCompleteDelete?: boolean
  currentStaffId?: string
  currentFranchiseeId?: string
  onCompleteDeleteSuccess?: (staffId: string, message: string) => void | Promise<void>
}

type PendingDeleteTarget = {
  staffMember: StaffMember
  isPersisted: boolean
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
  canCompleteDelete = false,
  currentStaffId = '',
  currentFranchiseeId = '',
  onCompleteDeleteSuccess,
}: StaffManagementPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteTarget | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleStoreChange = (staffMember: StaffMember, storeId: string) => {
    const store = stores.find((item) => item.id === storeId)
    onUpdate(staffMember.id, {
      storeId,
      storeName: store?.name ?? '',
    })
  }

  const canShowCompleteDeleteButton = (staffMember: StaffMember) => {
    if (!canCompleteDelete) {
      return false
    }

    if (staffMember.id === currentStaffId) {
      return false
    }

    if (staffMember.role === 'owner' || staffMember.role === 'hq_admin') {
      return false
    }

    const staffFranchiseeId = (staffMember.franchiseeId || staffMember.companyId || '').trim()
    if (!staffFranchiseeId || staffFranchiseeId !== currentFranchiseeId) {
      return false
    }

    return true
  }

  const openDeleteModal = async (staffMember: StaffMember) => {
    setDeleteError('')
    setConfirmName('')
    const persisted = await isStaffMemberPersisted(staffMember.id)
    setPendingDelete({ staffMember, isPersisted: persisted })
  }

  const closeDeleteModal = () => {
    if (isDeleting) {
      return
    }

    setPendingDelete(null)
    setConfirmName('')
    setDeleteError('')
  }

  const handleCompleteDelete = async () => {
    if (!pendingDelete || isDeleting) {
      return
    }

    const { staffMember, isPersisted } = pendingDelete
    if (confirmName !== staffMember.name) {
      return
    }

    setIsDeleting(true)
    setDeleteError('')

    try {
      if (!isPersisted) {
        await onCompleteDeleteSuccess?.(staffMember.id, `${staffMember.name || '従業員'}を一覧から削除しました。`)
        closeDeleteModal()
        return
      }

      const result = await deleteStaffMemberCompletely(staffMember.id)
      const summaryMessage = formatStaffCompleteDeleteSummary(
        result.targetName || staffMember.name,
        result.deletedCounts,
      )
      const warningMessage = result.warnings?.length
        ? `${summaryMessage} ${result.warnings.join(' ')}`
        : summaryMessage

      await onCompleteDeleteSuccess?.(staffMember.id, warningMessage)
      closeDeleteModal()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '従業員の完全削除に失敗しました。')
    } finally {
      setIsDeleting(false)
    }
  }

  const pendingStaffName = pendingDelete?.staffMember.name ?? ''
  const canSubmitDelete = Boolean(pendingDelete && confirmName === pendingStaffName && !isDeleting)

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
        <table className="admin-master-table admin-master-table--wide admin-master-table--staff">
          <thead>
            <tr>
              <th>有効</th>
              <th>順</th>
              <th>会社ID</th>
              <th>店舗</th>
              <th>氏名</th>
              <th>ログインID</th>
              <th>新しいパスワード</th>
              <th>権限</th>
              <th>状態</th>
              <th>電話番号</th>
              <th>メール</th>
              <th>住所</th>
              <th>免許番号</th>
              <th>免許期限</th>
              <th>事故歴</th>
              <th>メモ</th>
              {canCompleteDelete ? <th className="admin-master-table__actions">操作</th> : null}
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
                  <td>
                    <input
                      type="password"
                      name="new-staff-password"
                      autoComplete="new-password"
                      placeholder="変更する場合のみ入力"
                      aria-label="新しいパスワード"
                      value={staffMember.password}
                      onChange={(event) => onUpdate(staffMember.id, { password: event.target.value })}
                    />
                  </td>
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
                  {canCompleteDelete ? (
                    <td className="admin-master-table__actions">
                      {canShowCompleteDeleteButton(staffMember) ? (
                        <button
                          type="button"
                          className="staff-complete-delete-button"
                          onClick={() => void openDeleteModal(staffMember)}
                        >
                          完全削除
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr><td colSpan={canCompleteDelete ? 17 : 16}>従業員が未登録です。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingDelete ? (
        <div className="settings-backdrop" role="presentation" onClick={closeDeleteModal}>
          <section
            aria-labelledby="staff-complete-delete-title"
            aria-modal="true"
            className="settings-modal staff-complete-delete-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <h2 id="staff-complete-delete-title">従業員の完全削除</h2>
              <button type="button" onClick={closeDeleteModal} disabled={isDeleting}>閉じる</button>
            </div>

            <p>従業員「{pendingStaffName}」を完全削除しますか？</p>
            <p>以下の関連データも削除されます。</p>
            <ul className="staff-complete-delete-list">
              <li>出勤、退勤、勤務履歴</li>
              <li>運行記録</li>
              <li>売上、精算記録</li>
              <li>PLに反映されている売上</li>
              <li>GPSルート</li>
              <li>対象従業員に紐づくテストログ</li>
            </ul>
            <p>削除後は元に戻せません。<br />PL・売上分析・日報の金額も変更されます。</p>
            <p>確認のため、従業員名を入力してください。</p>

            <label className="pre-opening-reset-input-label" htmlFor="staff-complete-delete-confirm-name">
              従業員名
            </label>
            <input
              id="staff-complete-delete-confirm-name"
              className="pre-opening-reset-input"
              type="text"
              value={confirmName}
              disabled={isDeleting}
              onChange={(event) => setConfirmName(event.target.value)}
            />

            {deleteError ? <p className="case-error" role="alert">{deleteError}</p> : null}

            <div className="pre-opening-reset-actions staff-complete-delete-actions">
              <button type="button" onClick={closeDeleteModal} disabled={isDeleting}>キャンセル</button>
              <button
                type="button"
                className="staff-complete-delete-button staff-complete-delete-button--submit"
                disabled={!canSubmitDelete}
                onClick={() => void handleCompleteDelete()}
              >
                {isDeleting ? '削除中…' : '完全削除'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
