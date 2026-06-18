import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import { createPdfFileName } from './pdfDrawing'
import {
  createThermalReceiptCanvas,
  thermalReceiptPaper,
  type ThermalReceiptIssueOptions,
} from './thermalReceiptCanvas'

export type { ThermalReceiptIssueOptions } from './thermalReceiptCanvas'

const thermalReceiptFileName = (caseNumber: string) =>
  createPdfFileName('thermal-receipt', caseNumber)

async function createThermalReceiptPdf(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
) {
  const [{ jsPDF }, canvas] = await Promise.all([
    import('jspdf'),
    Promise.resolve(createThermalReceiptCanvas(caseRecord, settings, issueOptions)),
  ])
  const pdf = new jsPDF({
    format: [thermalReceiptPaper.widthMm, thermalReceiptPaper.heightMm],
    orientation: 'portrait',
    unit: 'mm',
  })

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    thermalReceiptPaper.widthMm,
    thermalReceiptPaper.heightMm,
  )

  return pdf
}

export async function downloadThermalReceiptPdf(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
) {
  const pdf = await createThermalReceiptPdf(caseRecord, settings, issueOptions)
  pdf.save(thermalReceiptFileName(caseRecord.caseNumber))
}

export async function openThermalReceiptPdf(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
) {
  const pdf = await createThermalReceiptPdf(caseRecord, settings, issueOptions)
  const pdfBlob = pdf.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  const receiptWindow = window.open(pdfUrl, '_blank', 'noopener,noreferrer')

  if (!receiptWindow) {
    pdf.save(thermalReceiptFileName(caseRecord.caseNumber))
    URL.revokeObjectURL(pdfUrl)
    return
  }

  setTimeout(() => {
    URL.revokeObjectURL(pdfUrl)
  }, 60_000)
}
