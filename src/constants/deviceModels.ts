export const DEVICE_UNSET_LABEL = '未設定'

const OBD_MODEL_OPTIONS = ['Vgate iCar Pro BLE'] as const
const PRINTER_MODEL_OPTIONS = ['PT-210'] as const

export type ObdModelOption = (typeof OBD_MODEL_OPTIONS)[number]
export type PrinterModelOption = (typeof PRINTER_MODEL_OPTIONS)[number]

export function getObdModelOptions(): readonly ObdModelOption[] {
  return OBD_MODEL_OPTIONS
}

export function getPrinterModelOptions(): readonly PrinterModelOption[] {
  return PRINTER_MODEL_OPTIONS
}

export function formatDeviceModel(value?: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEVICE_UNSET_LABEL
}
