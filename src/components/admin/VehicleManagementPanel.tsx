import type { Vehicle, VehicleFuelType, VehicleStatus } from '../../types/work'
import { vehicleFuelTypes, vehicleStatuses } from '../../types/work'

type VehicleManagementPanelProps = {
  message: string
  vehicles: Vehicle[]
  onAdd: () => void
  onSave: () => void
  onUpdate: (id: string, updates: Partial<Vehicle>) => void
}

export function VehicleManagementPanel({
  message,
  vehicles,
  onAdd,
  onSave,
  onUpdate,
}: VehicleManagementPanelProps) {
  return (
    <section className="admin-master-panel" aria-labelledby="vehicle-management-title">
      <div className="admin-master-panel__header">
        <div>
          <p className="eyebrow">Vehicles</p>
          <h2 id="vehicle-management-title">車両管理</h2>
        </div>
        <div className="admin-master-actions">
          <button type="button" onClick={onAdd}>+ 車両追加</button>
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
              <th>車両名</th>
              <th>ナンバー</th>
              <th>状態</th>
              <th>燃料</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length > 0 ? (
              vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={vehicle.enabled}
                      onChange={(event) => onUpdate(vehicle.id, { enabled: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      min="1"
                      type="number"
                      value={vehicle.sortOrder}
                      onChange={(event) => onUpdate(vehicle.id, { sortOrder: Math.max(Number(event.target.value) || 1, 1) })}
                    />
                  </td>
                  <td>
                    <input
                      value={vehicle.name}
                      onChange={(event) => onUpdate(vehicle.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={vehicle.number}
                      onChange={(event) => onUpdate(vehicle.id, { number: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={vehicle.status}
                      onChange={(event) => onUpdate(vehicle.id, { status: event.target.value as VehicleStatus })}
                    >
                      {vehicleStatuses.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={vehicle.fuelType}
                      onChange={(event) => onUpdate(vehicle.id, { fuelType: event.target.value as VehicleFuelType })}
                    >
                      {vehicleFuelTypes.map((fuelType) => (
                        <option key={fuelType || 'empty'} value={fuelType}>{fuelType || '未設定'}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>車両が未登録です。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
