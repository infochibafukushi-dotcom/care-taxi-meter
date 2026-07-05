import {
  BLE_PRINTER_SERVICE_UUID,
  BLE_PRINTER_WRITE_CHARACTERISTIC_UUID,
  BLUETOOTH_SPP_SERVICE_CLASS_ID,
} from '../utils/bluetoothPrinterCapabilities'
import { getLastPrinterDevice, saveLastPrinterDevice } from './printerDeviceStorage'
import { buildTestReceiptEscPos, writeEscPosInChunks } from '../utils/escPosCommands'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'

export type EscPosPrinterLogType = 'info' | 'data' | 'error'

export type EscPosPrinterLogEntry = {
  message: string
  timestamp: number
  type: EscPosPrinterLogType
}

export type EscPosPrinterLogHandler = (entry: EscPosPrinterLogEntry) => void

export type EscPosPrinterConnectionMethod = 'ble' | 'serial' | null

export type EscPosConnectionStageName =
  | 'connectGrantedPort'
  | 'connectGrantedDevice'
  | 'requestPort'
  | 'requestDevice'
  | 'resetConnection'

export type EscPosConnectionStageStatus = 'failure' | 'skipped' | 'success'

export type EscPosConnectionStageDiagnostic = {
  stage: EscPosConnectionStageName
  connectionMethod: 'BLE' | 'Serial'
  status: EscPosConnectionStageStatus
  detail: string
}

type EscPosConnectionAttemptResult = {
  ok: boolean
  detail: string
}

export type PrintConnectionHealthSnapshot = {
  method: EscPosPrinterConnectionMethod
  bleConnected: boolean
  hasWriteCharacteristic: boolean
  serialWritable: boolean
}

const createLogEntry = (type: EscPosPrinterLogType, message: string): EscPosPrinterLogEntry => ({
  message,
  timestamp: Date.now(),
  type,
})

const formatEscPosError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const logEscPosDiagnostic = (label: string, details?: Record<string, unknown>) => {
  if (details) {
    console.error(`[EscPosPrinter] ${label}`, details)
    return
  }

  console.error(`[EscPosPrinter] ${label}`)
}

const isBluetoothSppPort = (port: SerialPort) => {
  const classId = String(port.getInfo().bluetoothServiceClassId ?? '').toLowerCase()
  return classId === BLUETOOTH_SPP_SERVICE_CLASS_ID.toLowerCase()
}

/** BLE プリンター接続（Web Bluetooth API） */
export class BleEscPosPrinterConnection {
  private device: BluetoothDevice | null = null
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
  private onLog: EscPosPrinterLogHandler = () => undefined
  private onDisconnected: (() => void) | null = null

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.onLog = handler
  }

  setDisconnectedHandler(handler: (() => void) | null) {
    this.onDisconnected = handler
  }

  getDevice() {
    return this.device
  }

  hasWriteCharacteristic() {
    return Boolean(this.writeCharacteristic)
  }

  isBleGattConnected() {
    return Boolean(this.device?.gatt?.connected)
  }

  isConnected() {
    return Boolean(this.writeCharacteristic && this.device?.gatt?.connected)
  }

  private handleDisconnect = () => {
    this.onLog(createLogEntry('info', 'BLE プリンターが切断されました'))
    console.log('[PRINT] BLE disconnected: connection state cleared')
    this.writeCharacteristic = null
    this.device = null
    this.onDisconnected?.()
  }

  private async attachToDevice(device: BluetoothDevice): Promise<void> {
    device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    device.addEventListener('gattserverdisconnected', this.handleDisconnect)

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

  async verifyConnectionHealth(): Promise<boolean> {
    const device = this.device
    const characteristic = this.writeCharacteristic

    if (!device?.gatt || !characteristic) {
      return false
    }

    if (!device.gatt.connected) {
      try {
        await device.gatt.connect()
        const service = await device.gatt.getPrimaryService(BLE_PRINTER_SERVICE_UUID)
        this.writeCharacteristic = await service.getCharacteristic(BLE_PRINTER_WRITE_CHARACTERISTIC_UUID)
        return true
      } catch {
        this.writeCharacteristic = null
        this.device = null
        return false
      }
    }

    return true
  }

  async connectGrantedDevice(): Promise<EscPosConnectionAttemptResult> {
    if (!navigator.bluetooth?.getDevices) {
      const detail = 'getDevices 非対応'
      logEscPosDiagnostic('connectGrantedDevice: getDevices 非対応', { result: false })
      return { ok: false, detail }
    }

    const permittedDevices = await navigator.bluetooth.getDevices()
    const lastDevice = getLastPrinterDevice()
    const device =
      (lastDevice
        ? permittedDevices.find((candidate) => candidate.id === lastDevice.id)
        : undefined) ?? permittedDevices[0]

    if (!device) {
      const detail = `許可済みデバイスなし (permittedDeviceCount: ${permittedDevices.length})`
      logEscPosDiagnostic('connectGrantedDevice: 許可済みデバイスなし', {
        permittedDeviceCount: permittedDevices.length,
        result: false,
      })
      return { ok: false, detail }
    }

    try {
      this.onLog(createLogEntry('info', '許可済み BLE プリンターへ再接続します'))
      await this.attachToDevice(device)
      const detail = `再接続成功 (${device.name ?? device.id})`
      logEscPosDiagnostic('connectGrantedDevice: 成功', {
        connectionMethod: 'BLE',
        deviceId: device.id,
        deviceName: device.name ?? '',
        result: true,
      })
      return { ok: true, detail }
    } catch (error) {
      this.writeCharacteristic = null
      this.device = null
      const detail = formatEscPosError(error)
      logEscPosDiagnostic('connectGrantedDevice: 失敗', {
        connectionMethod: 'BLE',
        deviceId: device.id,
        deviceName: device.name ?? '',
        reason: detail,
        result: false,
        error,
      })
      return { ok: false, detail }
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
    if (!this.writeCharacteristic || !this.device?.gatt?.connected) {
      const error = new Error('プリンターが接続されていません')
      logEscPosDiagnostic('printReceipt failed (BLE)', {
        connectionMethod: 'BLE',
        reason: error.message,
      })
      throw error
    }

    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    try {
      await writeEscPosInChunks(async (chunk) => {
        await this.writeCharacteristic!.writeValue(new Uint8Array(chunk))
      }, data)
      this.onLog(createLogEntry('info', '印字データ送信完了'))
    } catch (error) {
      logEscPosDiagnostic('printReceipt failed (BLE)', {
        connectionMethod: 'BLE',
        byteLength: data.byteLength,
        reason: formatEscPosError(error),
        error,
      })
      throw error
    }
  }

  async printTestReceipt(): Promise<void> {
    await this.printReceipt(buildTestReceiptEscPos())
    this.onLog(createLogEntry('info', 'テスト印字データ送信完了'))
  }

  async disconnect(): Promise<void> {
    const device = this.device
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    }

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

  hasWritablePort() {
    return Boolean(this.port?.writable)
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

  async verifyConnectionHealth(): Promise<boolean> {
    const port = this.port
    if (!port?.writable) {
      return false
    }

    try {
      const writer = port.writable.getWriter()
      writer.releaseLock()
      return true
    } catch {
      this.port = null
      return false
    }
  }

  async connectGrantedPort(): Promise<EscPosConnectionAttemptResult> {
    if (!navigator.serial) {
      const detail = 'Web Serial 非対応'
      logEscPosDiagnostic('connectGrantedPort: Web Serial 非対応', { result: false })
      return { ok: false, detail }
    }

    const ports = await navigator.serial.getPorts()
    const port =
      ports.find((candidate) => isBluetoothSppPort(candidate)) ??
      (ports.length === 1 ? ports[0] : undefined)

    if (!port) {
      const detail = `利用可能なポートなし (grantedPortCount: ${ports.length})`
      logEscPosDiagnostic('connectGrantedPort: 利用可能なポートなし', {
        connectionMethod: 'Serial',
        grantedPortCount: ports.length,
        result: false,
      })
      return { ok: false, detail }
    }

    try {
      this.onLog(createLogEntry('info', '許可済みシリアルポートへ再接続します'))
      await this.openPort(port)
      const detail = '許可済みポートへ再接続成功'
      logEscPosDiagnostic('connectGrantedPort: 成功', {
        connectionMethod: 'Serial',
        bluetoothServiceClassId: port.getInfo().bluetoothServiceClassId ?? null,
        result: true,
      })
      return { ok: true, detail }
    } catch (error) {
      this.port = null
      const detail = formatEscPosError(error)
      logEscPosDiagnostic('connectGrantedPort: 失敗', {
        connectionMethod: 'Serial',
        bluetoothServiceClassId: port.getInfo().bluetoothServiceClassId ?? null,
        reason: detail,
        result: false,
        error,
      })
      return { ok: false, detail }
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
      const error = new Error('プリンターが接続されていません')
      logEscPosDiagnostic('printReceipt failed (Serial)', {
        connectionMethod: 'Serial',
        reason: error.message,
      })
      throw error
    }

    this.onLog(createLogEntry('data', `${data.byteLength} バイトを送信します`))

    const writer = this.port.writable.getWriter()

    try {
      await writeEscPosInChunks(async (chunk) => {
        await writer.write(chunk)
      }, data)
      this.onLog(createLogEntry('info', '印字データ送信完了'))
    } catch (error) {
      logEscPosDiagnostic('printReceipt failed (Serial)', {
        connectionMethod: 'Serial',
        byteLength: data.byteLength,
        reason: formatEscPosError(error),
        error,
      })
      throw error
    } finally {
      writer.releaseLock()
    }
  }

  async printTestReceipt(): Promise<void> {
    await this.printReceipt(buildTestReceiptEscPos())
    this.onLog(createLogEntry('info', 'テスト印字データ送信完了'))
  }

  async disconnect(): Promise<void> {
    const port = this.port
    if (port) {
      try {
        await port.close()
      } catch (error) {
        logEscPosDiagnostic('Serial disconnect failed', {
          reason: formatEscPosError(error),
          error,
        })
      }
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
  private lastConnectionDiagnostics: EscPosConnectionStageDiagnostic[] = []

  constructor() {
    this.bleConnection.setDisconnectedHandler(() => {
      this.activeMethod = null
    })
  }

  setLogHandler(handler: EscPosPrinterLogHandler) {
    this.serialConnection.setLogHandler(handler)
    this.bleConnection.setLogHandler(handler)
  }

  getLastConnectionDiagnostics() {
    return this.lastConnectionDiagnostics
  }

  private recordConnectionStage(stage: EscPosConnectionStageDiagnostic) {
    this.lastConnectionDiagnostics.push(stage)
  }

  private resetConnectionDiagnostics() {
    this.lastConnectionDiagnostics = []
  }

  getActiveMethod() {
    return this.activeMethod
  }

  getHealthSnapshot(): PrintConnectionHealthSnapshot {
    return {
      method: this.activeMethod,
      bleConnected: this.bleConnection.isBleGattConnected(),
      hasWriteCharacteristic: this.bleConnection.hasWriteCharacteristic(),
      serialWritable: this.serialConnection.hasWritablePort(),
    }
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

  private async verifyConnectionHealth(): Promise<boolean> {
    if (this.activeMethod === 'serial') {
      return this.serialConnection.verifyConnectionHealth()
    }

    if (this.activeMethod === 'ble') {
      return this.bleConnection.verifyConnectionHealth()
    }

    if (this.bleConnection.isConnected()) {
      return this.bleConnection.verifyConnectionHealth()
    }

    if (this.serialConnection.isConnected()) {
      return this.serialConnection.verifyConnectionHealth()
    }

    return false
  }

  async resetConnection(): Promise<void> {
    try {
      await this.serialConnection.disconnect()
    } catch (error) {
      logEscPosDiagnostic('resetConnection: Serial disconnect failed', {
        reason: formatEscPosError(error),
        error,
      })
    }

    try {
      await this.bleConnection.disconnect()
    } catch (error) {
      logEscPosDiagnostic('resetConnection: BLE disconnect failed', {
        reason: formatEscPosError(error),
        error,
      })
    }

    this.activeMethod = null
  }

  async connectIfNeeded(): Promise<void> {
    if (isReviewDemoRuntimeEnabled()) {
      throw new Error('Review demo mode blocked production write: thermalPrinterService.connectIfNeeded')
    }

    console.log('[PRINT] connectIfNeeded start', {
      activeMethod: this.activeMethod,
      isConnected: this.isConnected(),
    })

    let staleConnectionReset = false
    const previousMethod = this.activeMethod

    if (this.isConnected()) {
      console.log('[PRINT] health check', this.getHealthSnapshot())
      const healthy = await this.verifyConnectionHealth()
      if (healthy) {
        return
      }

      console.log('[PRINT] stale connection detected: reset')
      await this.resetConnection()
      staleConnectionReset = true
    }

    this.resetConnectionDiagnostics()

    if (staleConnectionReset) {
      this.recordConnectionStage({
        stage: 'resetConnection',
        connectionMethod: previousMethod === 'ble' ? 'BLE' : 'Serial',
        status: 'success',
        detail: '古い接続を検出したため接続状態をリセットしました',
      })
    }

    const failures: string[] = []

    if (navigator.serial) {
      const grantedPortResult = await this.serialConnection.connectGrantedPort()
      this.recordConnectionStage({
        stage: 'connectGrantedPort',
        connectionMethod: 'Serial',
        status: grantedPortResult.ok ? 'success' : 'failure',
        detail: grantedPortResult.detail,
      })
      if (grantedPortResult.ok) {
        this.activeMethod = 'serial'
        logEscPosDiagnostic('connectIfNeeded: Serial 再接続で成功', {
          connectionMethod: 'Serial',
        })
        return
      }
      this.activeMethod = null
    } else {
      this.recordConnectionStage({
        stage: 'connectGrantedPort',
        connectionMethod: 'Serial',
        status: 'skipped',
        detail: 'Web Serial 非対応',
      })
      logEscPosDiagnostic('connectIfNeeded: Web Serial 非対応', { connectionMethod: 'Serial' })
    }

    if (navigator.bluetooth?.getDevices) {
      const grantedDeviceResult = await this.bleConnection.connectGrantedDevice()
      this.recordConnectionStage({
        stage: 'connectGrantedDevice',
        connectionMethod: 'BLE',
        status: grantedDeviceResult.ok ? 'success' : 'failure',
        detail: grantedDeviceResult.detail,
      })
      if (grantedDeviceResult.ok) {
        this.activeMethod = 'ble'
        logEscPosDiagnostic('connectIfNeeded: BLE 再接続で成功', {
          connectionMethod: 'BLE',
        })
        return
      }
      this.activeMethod = null
    } else {
      this.recordConnectionStage({
        stage: 'connectGrantedDevice',
        connectionMethod: 'BLE',
        status: 'skipped',
        detail: 'getDevices 非対応',
      })
      logEscPosDiagnostic('connectIfNeeded: getDevices 非対応', { connectionMethod: 'BLE' })
    }

    if (navigator.serial) {
      try {
        await this.serialConnection.connect()
        this.activeMethod = 'serial'
        this.recordConnectionStage({
          stage: 'requestPort',
          connectionMethod: 'Serial',
          status: 'success',
          detail: 'requestPort 成功',
        })
        logEscPosDiagnostic('connectIfNeeded: Serial requestPort で成功', {
          connectionMethod: 'Serial',
        })
        return
      } catch (error) {
        this.activeMethod = null
        const reason = formatEscPosError(error)
        failures.push(`Serial requestPort: ${reason}`)
        this.recordConnectionStage({
          stage: 'requestPort',
          connectionMethod: 'Serial',
          status: 'failure',
          detail: reason,
        })
        logEscPosDiagnostic('requestPort failed', {
          connectionMethod: 'Serial',
          reason,
          error,
        })
      }
    } else {
      this.recordConnectionStage({
        stage: 'requestPort',
        connectionMethod: 'Serial',
        status: 'skipped',
        detail: 'Web Serial 非対応',
      })
    }

    if (navigator.bluetooth) {
      try {
        await this.bleConnection.connect()
        this.activeMethod = 'ble'
        this.recordConnectionStage({
          stage: 'requestDevice',
          connectionMethod: 'BLE',
          status: 'success',
          detail: 'requestDevice 成功',
        })
        logEscPosDiagnostic('connectIfNeeded: BLE requestDevice で成功', {
          connectionMethod: 'BLE',
        })
        return
      } catch (error) {
        this.activeMethod = null
        const reason = formatEscPosError(error)
        failures.push(`BLE requestDevice: ${reason}`)
        this.recordConnectionStage({
          stage: 'requestDevice',
          connectionMethod: 'BLE',
          status: 'failure',
          detail: reason,
        })
        logEscPosDiagnostic('requestDevice failed', {
          connectionMethod: 'BLE',
          reason,
          error,
        })
      }
    } else {
      this.recordConnectionStage({
        stage: 'requestDevice',
        connectionMethod: 'BLE',
        status: 'skipped',
        detail: 'Web Bluetooth 非対応',
      })
    }

    this.activeMethod = null

    if (!navigator.serial && !navigator.bluetooth) {
      const error = new Error('このブラウザはプリンター接続に対応していません')
      logEscPosDiagnostic('connectIfNeeded failed', {
        reason: error.message,
        failures,
      })
      throw error
    }

    const error = new Error(
      failures.length > 0
        ? `プリンター接続に失敗しました。${failures.join(' / ')}`
        : 'プリンター接続に失敗しました。',
    )
    logEscPosDiagnostic('connectIfNeeded failed', {
      reason: error.message,
      failures,
    })
    throw error
  }

  private async printReceiptOnce(data: Uint8Array): Promise<void> {
    if (!this.isConnected()) {
      const error = new Error('プリンターが接続されていません')
      logEscPosDiagnostic('printReceipt failed', {
        connectionMethod: this.activeMethod ?? 'unknown',
        reason: error.message,
      })
      throw error
    }

    await this.getActiveConnection().printReceipt(data)
    logEscPosDiagnostic('printReceipt succeeded', {
      connectionMethod: this.activeMethod ?? 'unknown',
      byteLength: data.byteLength,
    })
  }

  async printReceipt(data: Uint8Array): Promise<void> {
    if (isReviewDemoRuntimeEnabled()) {
      throw new Error('Review demo mode blocked production write: thermalPrinterService.printReceipt')
    }

    try {
      await this.printReceiptOnce(data)
      console.log('[PRINT] success')
    } catch (firstError) {
      console.log('[PRINT] retry after reconnect')
      await this.resetConnection()
      this.resetConnectionDiagnostics()

      try {
        await this.connectIfNeeded()
        await this.printReceiptOnce(data)
        console.log('[PRINT] success')
      } catch (retryError) {
        this.activeMethod = null
        console.error('[PRINT] failed', retryError)
        logEscPosDiagnostic('printReceipt failed after retry', {
          connectionMethod: this.activeMethod ?? 'unknown',
          byteLength: data.byteLength,
          reason: formatEscPosError(retryError),
          firstReason: formatEscPosError(firstError),
          error: retryError,
        })
        throw retryError
      }
    }
  }
}

export const thermalPrinterService = new EscPosPrinterService()
