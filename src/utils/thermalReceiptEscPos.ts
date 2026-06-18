import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import type { ThermalReceiptIssueOptions } from './thermalReceiptCanvas'
import { createThermalReceiptCanvas } from './thermalReceiptCanvas'
import { buildEscPosRasterFromCanvas } from './escPosRaster'

/** 本番領収書を Canvas→ラスター（GS v 0）ESC/POS データに変換 */
export function buildThermalReceiptEscPos(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
): Uint8Array {
  const canvas = createThermalReceiptCanvas(caseRecord, settings, issueOptions)
  return buildEscPosRasterFromCanvas(canvas)
}
