import type { Store } from '../../types/work'
import { defaultStore } from '../../services/stores'

type StoreManagementPanelProps = {
  message: string
  stores: Store[]
  onEnsureDefaultStore: () => void
}

export function StoreManagementPanel({
  message,
  stores,
  onEnsureDefaultStore,
}: StoreManagementPanelProps) {
  return (
    <section className="admin-master-panel" aria-labelledby="store-management-title">
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Stores</p>
          <h2 id="store-management-title">店舗管理</h2>
        </div>
        <button className="admin-save-button" type="button" onClick={onEnsureDefaultStore}>
          初期店舗を登録
        </button>
      </div>
      <p className="empty-note">Phase1では最小構成として「{defaultStore.name}」を登録・選択できる状態にします。</p>
      {message ? <p className="save-note">{message}</p> : null}
      <table className="admin-master-table">
        <thead>
          <tr>
            <th>表示</th>
            <th>店舗ID</th>
            <th>店舗名</th>
          </tr>
        </thead>
        <tbody>
          {stores.length > 0 ? (
            stores.map((store) => (
              <tr key={store.id}>
                <td>{store.enabled ? 'ON' : 'OFF'}</td>
                <td>{store.id}</td>
                <td>{store.name}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>店舗が未登録です。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
