import { parseEngineRpm, parseVehicleSpeed } from '../utils/obdPidParser'

export const OBD_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
export const OBD_NOTIFY = '0000fff1-0000-1000-8000-00805f9b34fb'
export const OBD_WRITE = '0000fff2-0000-1000-8000-00805f9b34fb'

const INIT_COMMANDS = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0', '0100'] as const
const COMMAND_TIMEOUT_MS = 8000

export type ObdLogType = 'info' | 'command' | 'response' | 'error'

export type ObdLogEntry = {
  message: string
  timestamp: number
  type: ObdLogType
}

export type ObdLogHandler = (entry: ObdLogEntry) => void

type PendingCommand = {
  command: string
  reject: (error: Error) => void
  resolve: (response: string) => void
  timeoutId: number
}

const createLogEntry = (type: ObdLogType, message: string): ObdLogEntry => ({
  message,
  timestamp: Date.now(),
  type,
})

const isObdDeviceName = (name: string | undefined) =>
  Boolean(name && (name.startsWith('OBD') || name.startsWith('VEEPEAK')))

export class ObdConnection {
  private device: BluetoothDevice | null = null
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
  private responseBuffer = ''
  private pendingCommands: PendingCommand[] = []
  private activeCommand: PendingCommand | null = null
  private onDisconnected: (() => void) | null = null
  private onLog: ObdLogHandler = () => undefined
  private handleNotify = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null
    const value = target?.value

    if (!value) {
      return
    }

    this.responseBuffer += new TextDecoder().decode(value)
    this.onLog(createLogEntry('response', this.responseBuffer.trim()))

    if (!this.responseBuffer.includes('>')) {
      return
    }

    const response = this.responseBuffer
    this.responseBuffer = ''

    if (!this.activeCommand) {
      return
    }

    window.clearTimeout(this.activeCommand.timeoutId)
    const { resolve } = this.activeCommand
    this.activeCommand = null
    resolve(response)
    void this.processCommandQueue()
  }

  private handleDisconnect = () => {
    this.onLog(createLogEntry('info', 'BLE接続が切断されました'))
    this.clearCommandQueue(new Error('BLE接続が切断されました'))
    this.notifyCharacteristic?.removeEventListener('characteristicvaluechanged', this.handleNotify)
    this.notifyCharacteristic = null
    this.writeCharacteristic = null
    this.device = null
    this.responseBuffer = ''
    this.onDisconnected?.()
  }

  setLogHandler(handler: ObdLogHandler) {
    this.onLog = handler
  }

  setDisconnectedHandler(handler: (() => void) | null) {
    this.onDisconnected = handler
  }

  get connectedDeviceName() {
    return this.device?.name ?? null
  }

  isConnected() {
    return Boolean(this.device?.gatt?.connected)
  }

  async connectPermittedDevice(): Promise<boolean> {
    if (!navigator.bluetooth?.getDevices) {
      return false
    }

    const permittedDevices = await navigator.bluetooth.getDevices()
    const device = permittedDevices.find((candidate) => isObdDeviceName(candidate.name))

    if (!device) {
      return false
    }

    this.onLog(createLogEntry('info', '許可済み OBD デバイスへ再接続します'))
    await this.attachToDevice(device)
    return true
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('このブラウザは Web Bluetooth に対応していません')
    }

    this.onLog(createLogEntry('info', '接続開始'))

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [OBD_SERVICE] },
        { namePrefix: 'OBD' },
        { namePrefix: 'VEEPEAK' },
      ],
      optionalServices: [OBD_SERVICE],
    })

    await this.attachToDevice(device)
  }

  private async attachToDevice(device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', this.handleDisconnect)

    this.onLog(createLogEntry('info', `${device.name ?? 'OBDデバイス'} を選択しました`))

    const server = device.gatt
    if (!server) {
      throw new Error('GATT サーバーが利用できません')
    }

    await server.connect()

    const service = await server.getPrimaryService(OBD_SERVICE)
    const notifyCharacteristic = await service.getCharacteristic(OBD_NOTIFY)
    const writeCharacteristic = await service.getCharacteristic(OBD_WRITE)

    notifyCharacteristic.addEventListener('characteristicvaluechanged', this.handleNotify)
    await notifyCharacteristic.startNotifications()

    this.device = device
    this.notifyCharacteristic = notifyCharacteristic
    this.writeCharacteristic = writeCharacteristic

    this.onLog(createLogEntry('info', '接続成功'))
  }

  async initialize(): Promise<void> {
    for (const command of INIT_COMMANDS) {
      await this.sendCommand(command)
    }

    this.onLog(createLogEntry('info', 'ELM327 初期化完了'))
  }

  async disconnect(): Promise<void> {
    this.onLog(createLogEntry('info', '切断処理を開始します'))

    this.clearCommandQueue(new Error('接続を切断しました'))

    const device = this.device
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    }

    this.notifyCharacteristic?.removeEventListener('characteristicvaluechanged', this.handleNotify)

    if (device?.gatt?.connected) {
      device.gatt.disconnect()
    }

    this.notifyCharacteristic = null
    this.writeCharacteristic = null
    this.device = null
    this.responseBuffer = ''

    this.onLog(createLogEntry('info', '切断完了'))
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.writeCharacteristic) {
      throw new Error('OBD アダプターが接続されていません')
    }

    return new Promise<string>((resolve, reject) => {
      const pendingCommand: PendingCommand = {
        command,
        reject,
        resolve,
        timeoutId: window.setTimeout(() => {
          if (this.activeCommand !== pendingCommand) {
            return
          }

          this.activeCommand = null
          reject(new Error(`コマンドがタイムアウトしました: ${command}`))
          void this.processCommandQueue()
        }, COMMAND_TIMEOUT_MS),
      }

      this.pendingCommands.push(pendingCommand)
      void this.processCommandQueue()
    })
  }

  async readVehicleSpeed(): Promise<number | null> {
    const response = await this.sendCommand('010D')
    return parseVehicleSpeed(response)?.speedKmh ?? null
  }

  async readEngineRpm(): Promise<number | null> {
    const response = await this.sendCommand('010C')
    return parseEngineRpm(response)?.rpm ?? null
  }

  private clearCommandQueue(error: Error) {
    if (this.activeCommand) {
      window.clearTimeout(this.activeCommand.timeoutId)
      this.activeCommand.reject(error)
      this.activeCommand = null
    }

    while (this.pendingCommands.length > 0) {
      const pendingCommand = this.pendingCommands.shift()
      if (!pendingCommand) {
        continue
      }

      window.clearTimeout(pendingCommand.timeoutId)
      pendingCommand.reject(error)
    }
  }

  private async processCommandQueue() {
    if (this.activeCommand || this.pendingCommands.length === 0 || !this.writeCharacteristic) {
      return
    }

    const nextCommand = this.pendingCommands.shift()
    if (!nextCommand) {
      return
    }

    this.activeCommand = nextCommand
    this.responseBuffer = ''
    this.onLog(createLogEntry('command', nextCommand.command))

    const encoder = new TextEncoder()
    await this.writeCharacteristic.writeValue(encoder.encode(`${nextCommand.command}\r`))
  }
}
