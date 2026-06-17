import {
  BLE_PRINTER_SERVICE_UUID,
  BLE_PRINTER_WRITE_CHARACTERISTIC_UUID,
  BLUETOOTH_SPP_SERVICE_CLASS_ID,
} from '../utils/bluetoothPrinterCapabilities'
import { buildTestReceiptEscPos, writeEscPosInChunks } from '../utils/escPosCommands'

export type EscPosPrinterLogType = 'info' | 'data' | 'error'

export type EscPosPrinterLogEntry = {
  message: string
  timestamp: number
  type: EscPosPrinterLogType
}

export type EscPosPrinterLogHandler = (entry: EscPosPrinterLogEntry) => void

const createLogEntry = (type: EscPosPrinterLogType, message: string): EscPosPrinterLogEntry => ({
  message,
  timestamp: Date.now(),
  type,
})

/** BLE プリンター接続（Web Bluetooth API） */
export class BleEscPosPrinterConnection {
  private device: BluetoothDevice | null = null
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
  private onLog: EscPosPrinterLogHandler = () => undefined

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.onLog = handler
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('このブラウザは Web Bluetooth に対応していません')
    }

    this.onLog(createLogEntry('info', 'BLE プリンターを選択してください'))

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_PRINTER_SERVICE_UUID] }],
      optionalServices: [BLE_PRINTER_SERVICE_UUID],
    })

    device.addEventListener('gattserverdisconnected', () => {
      this.onLog(createLogEntry('info', 'BLE プリンターが切断されました'))
      this.writeCharacteristic = null
      this.device = null
    })

    const server = device.gatt
    if (!server) {
      throw new Error('GATT サーバーが利用できません')
    }

    await server.connect()

    const service = await server.getPrimaryService(BLE_PRINTER_SERVICE_UUID)
    const characteristic = await service.getCharacteristic(BLE_PRINTER_WRITE_CHARACTERISTIC_UUID)

    this.device = device
    this.writeCharacteristic = characteristic

    this.onLog(
      createLogEntry('info', `接続成功: ${device.name ?? 'BLEプリンター'} (${BLE_PRINTER_SERVICE_UUID})`),
    )
  }

  async printTestReceipt(): Promise<void> {
    if (!this.writeCharacteristic) {
      throw new Error('プリンターが接続されていません')
    }

    const data = buildTestReceiptEscPos()
    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    await writeEscPosInChunks(async (chunk) => {
      await this.writeCharacteristic!.writeValue(new Uint8Array(chunk))
    }, data)

    this.onLog(createLogEntry('info', 'テスト印字データ送信完了'))
  }

  async disconnect(): Promise<void> {
    const device = this.device
    if (device?.gatt?.connected) {
      device.gatt.disconnect()
    }

    this.writeCharacteristic = null
    this.device = null
    this.onLog(createLogEntry('info', '切断完了'))
  }
}

/** Bluetooth Classic (SPP) プリンター接続（Web Serial API） */
export class SerialEscPosPrinterConnection {
  private port: SerialPort | null = null
  private onLog: EscPosPrinterLogHandler = () => undefined

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.onLog = handler
  }

  async connect(): Promise<void> {
    if (!navigator.serial) {
      throw new Error('このブラウザは Web Serial API に対応していません')
    }

    this.onLog(
      createLogEntry(
        'info',
        'OS 設定でプリンターをペアリング済みであることを確認してから選択してください',
      ),
    )

    const port = await navigator.serial.requestPort({
      filters: [{ bluetoothServiceClassId: BLUETOOTH_SPP_SERVICE_CLASS_ID }],
      allowedBluetoothServiceClassIds: [BLUETOOTH_SPP_SERVICE_CLASS_ID],
    })

    await port.open({ baudRate: 9600 })

    this.port = port
    const info = port.getInfo()

    this.onLog(
      createLogEntry(
        'info',
        `接続成功: SPP (Service Class ID: ${info.bluetoothServiceClassId ?? BLUETOOTH_SPP_SERVICE_CLASS_ID})`,
      ),
    )
  }

  async printTestReceipt(): Promise<void> {
    if (!this.port?.writable) {
      throw new Error('プリンターが接続されていません')
    }

    const data = buildTestReceiptEscPos()
    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    const writer = this.port.writable.getWriter()

    try {
      await writeEscPosInChunks(async (chunk) => {
        await writer.write(chunk)
      }, data)
    } finally {
      writer.releaseLock()
    }

    this.onLog(createLogEntry('info', 'テスト印字データ送信完了'))
  }

  async disconnect(): Promise<void> {
    if (this.port) {
      await this.port.close()
    }

    this.port = null
    this.onLog(createLogEntry('info', '切断完了'))
  }
}
