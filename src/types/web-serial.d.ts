interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
  bluetoothServiceClassId?: number | string
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
  allowedBluetoothServiceClassIds?: Array<number | string>
}

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
  bluetoothServiceClassId?: number | string
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  getInfo(): SerialPortInfo
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>
  close(): Promise<void>
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
}

interface Navigator {
  readonly serial?: Serial
}
