import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StoredCaseRecord } from '../../services/caseRecords'
import {
  fetchGpsRouteList,
  formatGpsRouteExpiresAt,
  type GpsRouteListItem,
} from '../../services/gpsRoutes'
import type { TenantAccessScope } from '../../services/tenancy'
import type { StaffMember, Vehicle } from '../../types/work'
import { formatCaseDateTime } from '../../utils/caseRecords'
import { getDatePartsInJapan, getMonthRangeInJapan } from '../../utils/japanDate'

type GpsRouteManagementPanelProps = {
  accessScope: TenantAccessScope
  caseRecords: StoredCaseRecord[]
  staffMembers: StaffMember[]
  vehicles: Vehicle[]
}

const formatSavedDate = (savedAt: string) => {
  if (!savedAt.trim()) {
    return '―'
  }

  return formatCaseDateTime(savedAt)
}

const formatDateInputValue = (isoString: string) => {
  const { day, month, year } = getDatePartsInJapan(new Date(isoString))
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const toClosedAtIso = (dateValue: string, endOfDay: boolean) => {
  const suffix = endOfDay ? 'T23:59:59.999+09:00' : 'T00:00:00+09:00'
  return new Date(`${dateValue}${suffix}`).toISOString()
}

export function GpsRouteManagementPanel({
  accessScope,
  caseRecords,
  staffMembers,
  vehicles,
}: GpsRouteManagementPanelProps) {
  const defaultRange = useMemo(() => getMonthRangeInJapan(new Date()), [])
  const [fromDate, setFromDate] = useState(() => formatDateInputValue(defaultRange.startIso))
  const [toDate, setToDate] = useState(() => {
    const endDate = new Date(defaultRange.endIso)
    endDate.setUTCDate(endDate.getUTCDate() - 1)
    return formatDateInputValue(endDate.toISOString())
  })
  const [selectedStaffId, setSelectedStaffId] = useState('all')
  const [selectedVehicleId, setSelectedVehicleId] = useState('all')
  const [items, setItems] = useState<GpsRouteListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const caseRecordDistanceById = useMemo(
    () => new Map(caseRecords.map((caseRecord) => [caseRecord.id, caseRecord.chargeableDistanceKm])),
    [caseRecords],
  )

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)

    const fromClosedAt = toClosedAtIso(fromDate, false)
    const toClosedAt = toClosedAtIso(toDate, true)

    fetchGpsRouteList(accessScope, caseRecordDistanceById, {
      fromClosedAt,
      toClosedAt,
      staffId: selectedStaffId,
      vehicleId: selectedVehicleId,
    })
      .then((loadedItems) => {
        if (!isMounted) {
          return
        }

        setItems(loadedItems)
        setErrorMessage('')
        setIsLoading(false)
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setItems([])
        setErrorMessage(
          error instanceof Error
            ? `GPSルート一覧を取得できませんでした。${error.message}`
            : 'GPSルート一覧を取得できませんでした。',
        )
        setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [
    accessScope,
    caseRecordDistanceById,
    fromDate,
    selectedStaffId,
    selectedVehicleId,
    toDate,
  ])

  return (
    <section aria-labelledby="gps-route-management-title">
      <p className="empty-note">
        保存済み GPS ルートを一覧表示します。距離は案件の運賃距離（chargeableDistanceKm）を表示します。
      </p>

      <div className="gps-route-filter-grid">
        <label>
          開始日
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          終了日
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <label>
          スタッフ
          <select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)}>
            <option value="all">全スタッフ</option>
            {staffMembers.map((staff) => (
              <option key={staff.id} value={staff.id}>{staff.name}</option>
            ))}
          </select>
        </label>
        <label>
          車両
          <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
            <option value="all">全車両</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? <p className="empty-note">GPSルート一覧を読み込み中です。</p> : null}
      {errorMessage ? <p className="case-error" role="alert">{errorMessage}</p> : null}

      {!isLoading && !errorMessage ? (
        <div className="gps-route-list-table-wrap">
          <table className="gps-route-list-table">
            <thead>
              <tr>
                <th scope="col">案件番号</th>
                <th scope="col">GPSログ件数</th>
                <th scope="col">距離</th>
                <th scope="col">保存日</th>
                <th scope="col">期限日</th>
                <th scope="col">スタッフ</th>
                <th scope="col">車両</th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? items.map((item) => (
                <tr key={item.caseRecordId}>
                  <td>
                    <Link className="text-link" to={`/cases/${item.caseRecordId}`}>
                      {item.caseNumber}
                    </Link>
                  </td>
                  <td>{item.pointCount}件</td>
                  <td>{item.chargeableDistanceKm.toFixed(3)} km</td>
                  <td>{formatSavedDate(item.savedAt)}</td>
                  <td>{formatGpsRouteExpiresAt(item.expiresAt)}</td>
                  <td>{item.staffName || '―'}</td>
                  <td>{item.vehicleName || '―'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>該当する GPS ルートはありません。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
