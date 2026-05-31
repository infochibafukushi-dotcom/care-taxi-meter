import type { StaffMember, Store, Vehicle } from '../../types/work'

type ClockInPanelProps = {
  isSaving: boolean
  selectedStaffId: string
  selectedStoreId: string
  selectedVehicleId: string
  staffMembers: StaffMember[]
  stores: Store[]
  vehicles: Vehicle[]
  onClockIn: () => void
  onStaffChange: (staffId: string) => void
  onStoreChange: (storeId: string) => void
  onVehicleChange: (vehicleId: string) => void
}

export function ClockInPanel({
  isSaving,
  selectedStaffId,
  selectedStoreId,
  selectedVehicleId,
  staffMembers,
  stores,
  vehicles,
  onClockIn,
  onStaffChange,
  onStoreChange,
  onVehicleChange,
}: ClockInPanelProps) {
  const enabledStores = stores
    .filter((store) => store.enabled)
    .sort((firstStore, secondStore) => firstStore.name.localeCompare(secondStore.name, 'ja'))
  const selectableStaffMembers = staffMembers
    .filter(
      (staffMember) =>
        staffMember.enabled,
    )
    .sort((firstStaff, secondStaff) => firstStaff.sortOrder - secondStaff.sortOrder)
  const selectableVehicles = vehicles
    .filter(
      (vehicle) =>
        vehicle.enabled &&
        vehicle.status === '稼働中',
    )
    .sort((firstVehicle, secondVehicle) => firstVehicle.sortOrder - secondVehicle.sortOrder)
  const canClockIn = Boolean(selectedStoreId && selectedStaffId && selectedVehicleId)

  return (
    <section className="work-session-panel" aria-labelledby="clock-in-title">
      <div className="work-session-panel__header">
        <div>
          <span>WORK</span>
          <h2 id="clock-in-title">本日の出勤</h2>
        </div>
        <strong>未出勤</strong>
      </div>

      <div className="work-session-form">
        <label>
          店舗
          <select
            value={selectedStoreId}
            onChange={(event) => onStoreChange(event.target.value)}
          >
            <option value="">店舗を選択</option>
            {enabledStores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          スタッフ
          <select
            value={selectedStaffId}
            onChange={(event) => onStaffChange(event.target.value)}
          >
            <option value="">スタッフを選択</option>
            {selectableStaffMembers.map((staffMember) => (
              <option key={staffMember.id} value={staffMember.id}>
                {staffMember.name}（{staffMember.role}）
              </option>
            ))}
          </select>
        </label>

        <label>
          車両
          <select
            value={selectedVehicleId}
            onChange={(event) => onVehicleChange(event.target.value)}
          >
            <option value="">車両を選択</option>
            {selectableVehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name} / {vehicle.number || 'ナンバー未設定'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        className="work-session-primary-button"
        type="button"
        disabled={!canClockIn || isSaving}
        onClick={onClockIn}
      >
        出勤
      </button>
    </section>
  )
}
