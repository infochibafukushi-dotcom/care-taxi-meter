interface BluetoothDevice extends EventTarget {
  readonly gatt?: BluetoothRemoteGATTServer
  readonly id: string
  readonly name?: string
  watchAdvertisements(): Promise<void>
  unwatchAdvertisements(): void
  addEventListener(
    type: 'gattserverdisconnected',
    listener: (this: this, ev: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'gattserverdisconnected',
    listener: (this: this, ev: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean
  readonly device: BluetoothDevice
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>
}

interface BluetoothRemoteGATTService extends EventTarget {
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService
  readonly uuid: string
  readonly value?: DataView
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: this, ev: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: this, ev: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void
}

type BluetoothServiceUUID = number | string
type BluetoothCharacteristicUUID = number | string

interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[]
  optionalServices?: BluetoothServiceUUID[]
}

interface BluetoothLEScanFilter {
  services?: BluetoothServiceUUID[]
  name?: string
  namePrefix?: string
}

interface Bluetooth extends EventTarget {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  readonly bluetooth?: Bluetooth
}
