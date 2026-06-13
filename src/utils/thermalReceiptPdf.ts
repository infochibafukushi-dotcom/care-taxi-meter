import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import type { Company } from '../types/work'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from './caseRecords'
import type { ExpenseItem } from '../types/case'

export type ThermalReceiptIssueOptions = {
  customerName: string
  isReissue?: boolean
  expenseItems: ExpenseItem[]
  issuerName: string
  receiptNote: string
  company?: Company | null
}

type ThermalLine = {
  label: string
  value: string
  indent?: boolean
}

const thermalReceiptPaper = {
  widthMm: 80,
  heightMm: 220,
  widthPx: 640,
  heightPx: 1760,
}

const thermalReceiptFileName = (caseNumber: string) =>
  `thermal-receipt-${caseNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')}.pdf`

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    align?: CanvasTextAlign
    font?: string
  } = {},
) {
  context.save()
  context.fillStyle = '#111827'
  context.font = options.font ?? '28px sans-serif'
  context.textAlign = options.align ?? 'left'
  context.textBaseline = 'alphabetic'
  context.fillText(text, x, y)
  context.restore()
}

function drawDivider(context: CanvasRenderingContext2D, y: number) {
  context.save()
  context.strokeStyle = '#111827'
  context.setLineDash([8, 8])
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(48, y)
  context.lineTo(thermalReceiptPaper.widthPx - 48, y)
  context.stroke()
  context.restore()
}

function createThermalReceiptLines(
  caseRecord: StoredCaseRecord,
  expenseItems: ExpenseItem[],
): ThermalLine[] {
  const lines: ThermalLine[] = [
    { label: '基本運賃（時間距離併用含む）', value: `${formatFareYen(caseRecord.basicFareYen + caseRecord.meterTimeFareYen)}円` },
    { label: '待機料金', value: `${formatFareYen(caseRecord.waitingFareYen)}円` },
    { label: '付き添い料金', value: `${formatFareYen(caseRecord.escortFareYen)}円` },
    { label: '介助料金', value: `${formatFareYen(caseRecord.careOptionFareYen)}円` },
  ]

  caseRecord.assistCharges.forEach((assistCharge) => {
    lines.push({
      indent: true,
      label: assistCharge.name,
      value: `${formatFareYen(assistCharge.amount)}円`,
    })
  })

  lines.push({ label: '障害者割引', value: caseRecord.isDisabilityDiscount ? `-${formatFareYen(caseRecord.disabilityDiscountAmount)}円` : '未適用' })
  lines.push({ label: 'タクシー券', value: `-${formatFareYen(caseRecord.taxiTicketAmountYen)}円` })
  caseRecord.taxiTickets.forEach((ticket) => {
    lines.push({
      indent: true,
      label: `${ticket.municipality} ${ticket.ticketNumber || '番号未入力'}`,
      value: `${formatFareYen(ticket.amount)}円`,
    })
  })
  lines.push({ label: '実費', value: `${formatFareYen(caseRecord.expenseFareYen)}円` })
  expenseItems
    .filter((expenseItem) => expenseItem.name.trim())
    .forEach((expenseItem) => {
      lines.push({
        indent: true,
        label: expenseItem.name,
        value: `${formatFareYen(expenseItem.amountYen)}円`,
      })
    })

  return lines
}

function createThermalReceiptCanvas(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
) {
  const canvas = document.createElement('canvas')
  canvas.width = thermalReceiptPaper.widthPx
  canvas.height = thermalReceiptPaper.heightPx

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('レシートPDFの作成に失敗しました。')
  }

  const companyName = settings.company.tradeName.trim() || settings.company.companyName.trim() || 'ちばケアタクシー'
  const corporateName = settings.company.corporateName.trim() || settings.company.companyName.trim()
  const customerName = issueOptions.customerName.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const issuerName = issueOptions.issuerName.trim()
  let y = 58

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  drawText(context, companyName, canvas.width / 2, y, {
    align: 'center',
    font: 'bold 30px sans-serif',
  })
  y += 38
  if (corporateName && corporateName !== companyName) {
    drawText(context, corporateName, canvas.width / 2, y, {
      align: 'center',
      font: '28px sans-serif',
    })
    y += 34
  }

  ;[
    settings.company.postalCode ? `〒${settings.company.postalCode}` : '',
    settings.company.address,
    settings.company.phoneNumber ? `TEL ${settings.company.phoneNumber}` : '',
  ]
    .filter((line) => line.trim())
    .forEach((line) => {
      drawText(context, line, canvas.width / 2, y, {
        align: 'center',
        font: '22px sans-serif',
      })
      y += 28
    })

  y += 16
  drawDivider(context, y)
  y += 52
  drawText(context, issueOptions.isReissue ? '領収書（再発行）' : '領収書', canvas.width / 2, y, {
    align: 'center',
    font: 'bold 48px sans-serif',
  })
  y += 52
  drawText(context, customerName ? `${customerName} 様` : '________________ 様', 48, y, {
    font: 'bold 30px sans-serif',
  })
  y += 40
  drawDivider(context, y)
  y += 42

  ;[
    ['発行日', formatCaseDateTime(new Date().toISOString())],
    ['利用日', formatCaseDateTime(caseRecord.closedAt)],
    ['案件番号', caseRecord.caseNumber],
  ].forEach(([label, value]) => {
    drawText(context, label, 48, y, { font: '24px sans-serif' })
    drawText(context, value, canvas.width - 48, y, {
      align: 'right',
      font: '24px sans-serif',
    })
    y += 34
  })

  y += 10
  drawDivider(context, y)
  y += 42
  createThermalReceiptLines(caseRecord, issueOptions.expenseItems).forEach((line) => {
    drawText(context, line.label, line.indent ? 74 : 48, y, {
      font: line.indent ? '22px sans-serif' : '24px sans-serif',
    })
    drawText(context, line.value, canvas.width - 48, y, {
      align: 'right',
      font: line.indent ? '22px sans-serif' : '24px sans-serif',
    })
    y += 34
  })

  y += 10
  drawDivider(context, y)
  y += 58
  drawText(context, '合計', 48, y, { font: 'bold 34px sans-serif' })
  drawText(context, `${formatFareYen(caseRecord.totalFareYen)}円`, canvas.width - 48, y, {
    align: 'right',
    font: 'bold 46px sans-serif',
  })
  y += 58
  drawText(context, '支払方法', 48, y, { font: '24px sans-serif' })
  drawText(context, caseRecord.paymentMethod || '未設定', canvas.width - 48, y, {
    align: 'right',
    font: '24px sans-serif',
  })
  y += 34
  const paymentLines = caseRecord.payments.length > 0
    ? caseRecord.payments
    : [{ amount: caseRecord.totalFareYen, id: 'legacy-payment', type: caseRecord.paymentMethod }]
  paymentLines.forEach((payment) => {
    drawText(context, `支払内訳 ${payment.type}`, 48, y, { font: '22px sans-serif' })
    drawText(context, `${formatFareYen(payment.amount)}円`, canvas.width - 48, y, {
      align: 'right',
      font: '22px sans-serif',
    })
    y += 30
  })
  y += 12

  if (receiptNote) {
    drawDivider(context, y)
    y += 38
    drawText(context, '但し書き', 48, y, { font: 'bold 24px sans-serif' })
    y += 32
    drawText(context, receiptNote, 48, y, { font: '24px sans-serif' })
    y += 42
  }

  if (invoiceNumber) {
    drawDivider(context, y)
    y += 38
    drawText(context, '登録番号', canvas.width / 2, y, {
      align: 'center',
      font: 'bold 24px sans-serif',
    })
    y += 32
    drawText(context, invoiceNumber, canvas.width / 2, y, {
      align: 'center',
      font: '24px sans-serif',
    })
    y += 40
  }

  if (issuerName) {
    drawText(context, `発行担当者 ${issuerName}`, 48, y, { font: '24px sans-serif' })
    y += 42
  }

  drawText(context, 'ありがとうございました', canvas.width / 2, y + 16, {
    align: 'center',
    font: 'bold 28px sans-serif',
  })

  return canvas
}

export async function openThermalReceiptPdf(
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
