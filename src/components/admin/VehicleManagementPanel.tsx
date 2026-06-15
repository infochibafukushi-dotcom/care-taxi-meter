import type { StandardVehicleType, Store, Vehicle, VehicleFuelType, VehicleStatus } from '../../types/work'
import { standardVehicleTypes, vehicleFuelTypes, vehicleStatuses } from '../../types/work'

type VehicleManagementPanelProps = {
  message: string
  stores: Store[]
  vehicles: Vehicle[]
  onAdd: () => void
  onSave: () => void
  onUpdate: (id: string, updates: Partial<Vehicle>) => void
  canSelectStore?: boolean
}

const getVehicleTypeOptions = (vehicleType: string) => {
  if (!vehicleType || standardVehicleTypes.includes(vehicleType as StandardVehicleType)) {
    return standardVehicleTypes
  }

  return [vehicleType, ...standardVehicleTypes]
}

export function VehicleManagementPanel({
  message,
  stores,
  vehicles,
  onAdd,
  onSave,
  onUpdate,
  canSelectStore = true,
}: VehicleManagementPanelProps) {
  const handleStoreChange = (vehicle: Vehicle, storeId: string) => {
    const store = stores.find((item) => item.id === storeId)
    onUpdate(vehicle.id, {
      storeId,
      storeName: store?.name ?? '',
    })
  }

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
        <table className="admin-master-table admin-master-table--wide">
          <thead>
            <tr>
              <th>表示</th>
              <th>順</th>
              <th>会社ID</th>
              <th>店舗</th>
              <th>車両名</th>
              <th>ナンバー</th>
              <th>状態</th>
              <th>燃料</th>
              <th>車両種別</th>
              <th>車いす台数</th>
              <th>ストレッチャー</th>
              <th>車検期限</th>
              <th>保険期限</th>
              <th>メモ</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length > 0 ? (
              vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td><input type="checkbox" checked={vehicle.enabled} onChange={(event) => onUpdate(vehicle.id, { enabled: event.target.checked })} /></td>
                  <td><input min="1" type="number" value={vehicle.sortOrder} onChange={(event) => onUpdate(vehicle.id, { sortOrder: Math.max(Number(event.target.value) || 1, 1) })} /></td>
                  <td><input value={vehicle.companyId} onChange={(event) => onUpdate(vehicle.id, { companyId: event.target.value })} /></td>
                  <td>
                    {canSelectStore ? (
                      <select value={vehicle.storeId} onChange={(event) => handleStoreChange(vehicle, event.target.value)}>
                        <option value="">未設定</option>
                        {stores
                          .filter((store) => !vehicle.companyId || store.companyId === vehicle.companyId)
                          .map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                      </select>
                    ) : (
                      <span>{vehicle.storeName || stores.find((store) => store.id === vehicle.storeId)?.name || '既定店舗'}</span>
                    )}
                  </td>
                  <td><input value={vehicle.name} onChange={(event) => onUpdate(vehicle.id, { name: event.target.value })} /></td>
                  <td><input value={vehicle.number} onChange={(event) => onUpdate(vehicle.id, { number: event.target.value })} /></td>
                  <td>
                    <select value={vehicle.status} onChange={(event) => onUpdate(vehicle.id, { status: event.target.value as VehicleStatus })}>
                      {vehicleStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={vehicle.fuelType} onChange={(event) => onUpdate(vehicle.id, { fuelType: event.target.value as VehicleFuelType })}>
                      {vehicleFuelTypes.map((fuelType) => <option key={fuelType || 'empty'} value={fuelType}>{fuelType || '未設定'}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${vehicle.name || '車両'}の車両種別`}
                      value={vehicle.vehicleType}
                      onChange={(event) => onUpdate(vehicle.id, { vehicleType: event.target.value })}
                    >
                      <option value="">未設定</option>
                      {getVehicleTypeOptions(vehicle.vehicleType).map((vehicleType) => (
                        <option key={vehicleType} value={vehicleType}>
                          {standardVehicleTypes.includes(vehicleType as StandardVehicleType) ? vehicleType : `既存データ：${vehicleType}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td><input min="0" type="number" value={vehicle.wheelchairCapacity} onChange={(event) => onUpdate(vehicle.id, { wheelchairCapacity: Math.max(Number(event.target.value) || 0, 0) })} /></td>
                  <td><input type="checkbox" checked={vehicle.stretcherSupported} onChange={(event) => onUpdate(vehicle.id, { stretcherSupported: event.target.checked })} /></td>
                  <td><input type="date" value={vehicle.inspectionExpiresAt} onChange={(event) => onUpdate(vehicle.id, { inspectionExpiresAt: event.target.value })} /></td>
                  <td><input type="date" value={vehicle.insuranceExpiresAt} onChange={(event) => onUpdate(vehicle.id, { insuranceExpiresAt: event.target.value })} /></td>
                  <td><input value={vehicle.memo} onChange={(event) => onUpdate(vehicle.id, { memo: event.target.value })} /></td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={14}>車両が未登録です。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
