export type PrinterConnectionMethod = 'ble-web-bluetooth' | 'classic-web-serial' | 'none'

export type BluetoothPrinterCapabilities = {
  isSecureContext: boolean
  hasWebBluetooth: boolean
  hasWebSerial: boolean
  hasWebBluetoothGetDevices: boolean
  userAgent: string
  platform: string
  recommendedMethod: PrinterConnectionMethod
  notes: string[]
}

/** Bluetooth Classic Serial Port Profile (SPP) の Service Class ID */
export const BLUETOOTH_SPP_SERVICE_CLASS_ID = '00001101-0000-1000-8000-00805f9b34fb'

/** 一般的な BLE レシートプリンター向け GATT UUID（機種により異なる） */
export const BLE_PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'
export const BLE_PRINTER_WRITE_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'

export function detectBluetoothPrinterCapabilities(): BluetoothPrinterCapabilities {
  const notes: string[] = []
  const isSecureContext = window.isSecureContext
  const hasWebBluetooth = 'bluetooth' in navigator && Boolean(navigator.bluetooth)
  const hasWebSerial = 'serial' in navigator && Boolean(navigator.serial)
  const hasWebBluetoothGetDevices = Boolean(navigator.bluetooth?.getDevices)

  if (!isSecureContext) {
    notes.push('HTTPS 等の Secure Context が必要です（GitHub Pages デプロイは HTTPS のため問題ありません）。')
  }

  if (!hasWebBluetooth) {
    notes.push('Web Bluetooth 非対応（iOS Safari / Firefox 等）。BLE プリンター接続は不可。')
  }

  if (!hasWebSerial) {
    notes.push('Web Serial 非対応。Bluetooth Classic (SPP) プリンター接続は不可。')
  } else {
    notes.push(
      'Web Serial 対応: Chrome 117+ デスクトップ、Chrome 138+ Android で Bluetooth Classic (SPP) 接続可能。事前に OS 設定でプリンターをペアリングしてください。',
    )
  }

  if (hasWebBluetooth) {
    notes.push(
      'Web Bluetooth 対応: BLE プリンターに GATT 経由で ESC/POS バイト列を送信可能（Service/Characteristic UUID は機種依存）。',
    )
  }

  let recommendedMethod: PrinterConnectionMethod = 'none'

  if (hasWebSerial) {
    recommendedMethod = 'classic-web-serial'
    notes.push(
      '市販の ESC/POS Bluetooth プリンターは Classic SPP が主流のため、Web Serial 経由が第一候補です。',
    )
  } else if (hasWebBluetooth) {
    recommendedMethod = 'ble-web-bluetooth'
    notes.push('Web Serial が使えない環境では、BLE 対応プリンターのみ Web Bluetooth で接続できます。')
  }

  return {
    isSecureContext,
    hasWebBluetooth,
    hasWebSerial,
    hasWebBluetoothGetDevices,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    recommendedMethod,
    notes,
  }
}
