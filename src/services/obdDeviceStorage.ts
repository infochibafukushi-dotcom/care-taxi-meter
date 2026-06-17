const LAST_OBD_DEVICE_ID_KEY = 'lastObdDeviceId'
const LAST_OBD_DEVICE_NAME_KEY = 'lastObdDeviceName'

export type StoredObdDevice = {
  id: string
  name: string
}

export function saveLastObdDevice(device: Pick<BluetoothDevice, 'id' | 'name'>): void {
  window.localStorage.setItem(LAST_OBD_DEVICE_ID_KEY, device.id)
  window.localStorage.setItem(LAST_OBD_DEVICE_NAME_KEY, device.name ?? '')
}

export function getLastObdDevice(): StoredObdDevice | null {
  const id = window.localStorage.getItem(LAST_OBD_DEVICE_ID_KEY)
  if (!id) {
    return null
  }

  return {
    id,
    name: window.localStorage.getItem(LAST_OBD_DEVICE_NAME_KEY) ?? '',
  }
}

export function clearLastObdDevice(): void {
  window.localStorage.removeItem(LAST_OBD_DEVICE_ID_KEY)
  window.localStorage.removeItem(LAST_OBD_DEVICE_NAME_KEY)
}
