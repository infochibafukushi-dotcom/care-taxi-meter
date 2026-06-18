import {
  BLE_PRINTER_SERVICE_UUID,
  BLE_PRINTER_WRITE_CHARACTERISTIC_UUID,
  BLUETOOTH_SPP_SERVICE_CLASS_ID,
} from '../utils/bluetoothPrinterCapabilities'
import { getLastPrinterDevice, saveLastPrinterDevice } from './printerDeviceStorage'
import { buildTestReceiptEscPos, writeEscPosInChunks } from '../utils/escPosCommands'

export type EscPosPrinterLogType = 'info' | 'data' | 'error'

export type EscPosPrinterLogEntry = {
  message: string
  timestamp: number
  type: EscPosPrinterLogType
}

export type EscPosPrinterLogHandler = (entry: EscPosPrinterLogEntry) => void

export type EscPosPrinterConnectionMethod = 'ble' | 'serial' | null

const createLogEntry = (type: EscPosPrinterLogType, message: string): EscPosPrinterLogEntry => ({
  message,
  timestamp: Date.now(),
  type,
})

const isBluetoothSppPort = (port: SerialPort) => {
  const classId = String(port.getInfo().bluetoothServiceClassId ?? '').toLowerCase()
  return classId === BLUETOOTH_SPP_SERVICE_CLASS_ID.toLowerCase()
}

/** BLE プリンター接続（Web Bluetooth API） */
export class BleEscPosPrinterConnection {
  private device: BluetoothDevice | null = null
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
  private onLog: EscPosPrinterLogHandler = () => undefined

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.onLog = handler
  }

  isConnected() {
    return Boolean(this.writeCharacteristic && this.device?.gatt?.connected)
  }

  private async attachToDevice(device: BluetoothDevice): Promise<void> {
    device.addEventListener('gattserverdisconnected', () => {
      this.onLog(createLogEntry('info', 'BLE プリンターが切断されました'))
      this.writeCharacteristic = null
      this.device = null
    })

    const server = device.gatt
    if (!server) {
      throw new Error('GATT サーバーが利用できません')
    }

    if (!server.connected) {
      await server.connect()
    }

    const service = await server.getPrimaryService(BLE_PRINTER_SERVICE_UUID)
    const characteristic = await service.getCharacteristic(BLE_PRINTER_WRITE_CHARACTERISTIC_UUID)

    this.device = device
    this.writeCharacteristic = characteristic
    saveLastPrinterDevice(device)

    this.onLog(
      createLogEntry('info', `接続成功: ${device.name ?? 'BLEプリンター'} (${BLE_PRINTER_SERVICE_UUID})`),
    )
  }

  async connectGrantedDevice(): Promise<boolean> {
    if (!navigator.bluetooth?.getDevices) {
      return false
    }

    const permittedDevices = await navigator.bluetooth.getDevices()
    const lastDevice = getLastPrinterDevice()
    const device =
      (lastDevice
        ? permittedDevices.find((candidate) => candidate.id === lastDevice.id)
        : undefined) ?? permittedDevices[0]

    if (!device) {
      return false
    }

    try {
      this.onLog(createLogEntry('info', '許可済み BLE プリンターへ再接続します'))
      await this.attachToDevice(device)
      return true
    } catch {
      return false
    }
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

    await this.attachToDevice(device)
  }

  async printReceipt(data: Uint8Array): Promise<void> {
    if (!this.writeCharacteristic) {
      throw new Error('プリンターが接続されていません')
    }

    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    await writeEscPosInChunks(async (chunk) => {
      await this.writeCharacteristic!.writeValue(new Uint8Array(chunk))
    }, data)

    this.onLog(createLogEntry('info', '印字データ送信完了'))
  }

  async printTestReceipt(): Promise<void> {
    await this.printReceipt(buildTestReceiptEscPos())
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

  isConnected() {
    return Boolean(this.port?.writable)
  }

  private async openPort(port: SerialPort): Promise<void> {
    if (!port.writable) {
      await port.open({ baudRate: 9600 })
    }

    this.port = port
    const info = port.getInfo()

    this.onLog(
      createLogEntry(
        'info',
        `接続成功: SPP (Service Class ID: ${info.bluetoothServiceClassId ?? BLUETOOTH_SPP_SERVICE_CLASS_ID})`,
      ),
    )
  }

  async connectGrantedPort(): Promise<boolean> {
    if (!navigator.serial) {
      return false
    }

    const ports = await navigator.serial.getPorts()
    const port =
      ports.find((candidate) => isBluetoothSppPort(candidate)) ??
      (ports.length === 1 ? ports[0] : undefined)

    if (!port) {
      return false
    }

    try {
      this.onLog(createLogEntry('info', '許可済みシリアルポートへ再接続します'))
      await this.openPort(port)
      return true
    } catch {
      this.port = null
      return false
    }
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

    await this.openPort(port)
  }

  async printReceipt(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) {
      throw new Error('プリンターが接続されていません')
    }

    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    const writer = this.port.writable.getWriter()

    try {
      await writeEscPosInChunks(async (chunk) => {
        await writer.write(chunk)
      }, data)
    } finally {
      writer.releaseLock()
    }

    this.onLog(createLogEntry('info', '印字データ送信完了'))
  }

  async printTestReceipt(): Promise<void> {
    await this.printReceipt(buildTestReceiptEscPos())
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

/** 精算画面向け: Serial 優先で接続・印字を行うファサード */
export class EscPosPrinterService {
  private readonly serialConnection = new SerialEscPosPrinterConnection()
  private readonly bleConnection = new BleEscPosPrinterConnection()
  private activeMethod: EscPosPrinterConnectionMethod = null

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.serialConnection.setLogHandler(handler)
    this.bleConnection.setLogHandler(handler)
  }

  getActiveMethod() {
    return this.activeMethod
  }

  isConnected() {
    if (this.activeMethod === 'serial') {
      return this.serialConnection.isConnected()
    }

    if (this.activeMethod === 'ble') {
      return this.bleConnection.isConnected()
    }

    return this.serialConnection.isConnected() || this.bleConnection.isConnected()
  }

  private getActiveConnection() {
    if (this.activeMethod === 'ble') {
      return this.bleConnection
    }

    return this.serialConnection
  }

  async connectIfNeeded(): Promise<void> {
    if (this.isConnected()) {
      return
    }

    if (navigator.serial) {
      const reconnected = await this.serialConnection.connectGrantedPort()
      if (reconnected) {
        this.activeMethod = 'serial'
        return
      }
    }

    if (navigator.bluetooth?.getDevices) {
      const reconnected = await this.bleConnection.connectGrantedDevice()
      if (reconnected) {
        this.activeMethod = 'ble'
        return
      }
    }

    if (navigator.serial) {
      await this.serialConnection.connect()
      this.activeMethod = 'serial'
      return
    }

    if (navigator.bluetooth) {
      await this.bleConnection.connect()
      this.activeMethod = 'ble'
      return
    }

    throw new Error('このブラウザはプリンター接続に対応していません')
  }

  async printReceipt(data: Uint8Array): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('プリンターが接続されていません')
    }

    await this.getActiveConnection().printReceipt(data)
  }
}

export const thermalPrinterService = new EscPosPrinterService()
