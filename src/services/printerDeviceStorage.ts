const LAST_PRINTER_DEVICE_ID_KEY = 'lastPrinterDeviceId'
const LAST_PRINTER_DEVICE_NAME_KEY = 'lastPrinterDeviceName'

export type StoredPrinterDevice = {
  id: string
  name: string
}

export function saveLastPrinterDevice(device: Pick<BluetoothDevice, 'id' | 'name'>): void {
  window.localStorage.setItem(LAST_PRINTER_DEVICE_ID_KEY, device.id)
  window.localStorage.setItem(LAST_PRINTER_DEVICE_NAME_KEY, device.name ?? '')
}

export function getLastPrinterDevice(): StoredPrinterDevice | null {
  const id = window.localStorage.getItem(LAST_PRINTER_DEVICE_ID_KEY)
  if (!id) {
    return null
  }

  return {
    id,
    name: window.localStorage.getItem(LAST_PRINTER_DEVICE_NAME_KEY) ?? '',
  }
}

export function clearLastPrinterDevice(): void {
  window.localStorage.removeItem(LAST_PRINTER_DEVICE_ID_KEY)
  window.localStorage.removeItem(LAST_PRINTER_DEVICE_NAME_KEY)
}
