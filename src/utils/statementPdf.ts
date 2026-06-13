import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import type { MeterSettings } from '../services/meterSettings'
import type { Company } from '../types/work'
import { defaultMeterSettings } from '../services/meterSettings'
import { formatCaseDateTime } from './caseRecords'

export type StatementIssueOptions = {
  customerName: string
  isReissue?: boolean
  issuerName: string
  company?: Company | null
}

type StatementLine = {
  label: string
  value: string
}

const a4Portrait = {
  widthMm: 210,
  heightMm: 297,
  widthPx: 1240,
  heightPx: 1754,
}

const statementFileName = (caseNumber: string) =>
  `statement-${caseNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')}.pdf`

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    align?: CanvasTextAlign
    color?: string
    font?: string
    maxWidth?: number
  } = {},
) {
  context.save()
  context.fillStyle = options.color ?? '#0f172a'
  context.font = options.font ?? '28px sans-serif'
  context.textAlign = options.align ?? 'left'
  context.textBaseline = 'alphabetic'
  if (options.maxWidth) {
    context.fillText(text, x, y, options.maxWidth)
  } else {
    context.fillText(text, x, y)
  }
  context.restore()
}

function drawLine(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color = '#cbd5e1',
) {
  context.save()
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(startX, startY)
  context.lineTo(endX, endY)
  context.stroke()
  context.restore()
}

const formatPaymentDetails = (caseRecord: StoredCaseRecord) =>
  caseRecord.payments.length > 0
    ? caseRecord.payments
        .map((payment) => `${payment.type} ${formatFareYen(payment.amount)}円`)
        .join(' / ')
    : caseRecord.paymentMethod

const formatAssistDetails = (caseRecord: StoredCaseRecord) =>
  caseRecord.assistCharges.length > 0
    ? caseRecord.assistCharges
        .map((assistCharge) => `${assistCharge.name} ${formatFareYen(assistCharge.amount)}円`)
        .join(' / ')
    : `${formatFareYen(caseRecord.careOptionFareYen)}円`

const formatExpenseDetails = (caseRecord: StoredCaseRecord) =>
  caseRecord.expenseCharges.length > 0
    ? caseRecord.expenseCharges
        .map((expenseCharge) => `${expenseCharge.name} ${formatFareYen(expenseCharge.amount)}円`)
        .join(' / ')
    : `${formatFareYen(caseRecord.expenseFareYen)}円`

const formatTaxiTicketDetails = (caseRecord: StoredCaseRecord) =>
  caseRecord.taxiTickets.length > 0
    ? caseRecord.taxiTickets
        .map((ticket) => `${ticket.municipality} ${ticket.ticketNumber || '番号未入力'} ${formatFareYen(ticket.amount)}円`)
        .join(' / ')
    : '未使用'

function createStatementLines(caseRecord: StoredCaseRecord, customerName: string): StatementLine[] {
  return [
    { label: '案件番号', value: caseRecord.caseNumber },
    { label: '利用日', value: formatCaseDateTime(caseRecord.closedAt) },
    { label: '利用者名（宛名）', value: customerName || caseRecord.receiptName || caseRecord.customerName || '未入力' },
    { label: '乗車地', value: caseRecord.pickupAddress || '未取得' },
    { label: '降車地', value: caseRecord.dropoffAddress || '未取得' },
    { label: '基本運賃（時間距離併用含む）', value: `${formatFareYen(caseRecord.basicFareYen + caseRecord.meterTimeFareYen)}円` },
    { label: '待機料金', value: `${formatFareYen(caseRecord.waitingFareYen)}円` },
    { label: '院内付き添い料金', value: `${formatFareYen(caseRecord.escortFareYen)}円` },
    { label: '介助料金', value: formatAssistDetails(caseRecord) },
    { label: '実費', value: formatExpenseDetails(caseRecord) },
    { label: '障害者割引', value: caseRecord.isDisabilityDiscount ? `-${formatFareYen(caseRecord.disabilityDiscountAmount)}円` : '未適用' },
    { label: 'タクシー券', value: formatTaxiTicketDetails(caseRecord) },
    { label: 'タクシー券利用額', value: `-${formatFareYen(caseRecord.taxiTicketAmountYen)}円` },
    { label: '請求額', value: `${formatFareYen(caseRecord.totalFareYen)}円` },
    { label: '支払内訳', value: formatPaymentDetails(caseRecord) },
    { label: '発行日時', value: formatCaseDateTime(new Date().toISOString()) },
  ]
}

function createStatementCanvas(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: StatementIssueOptions,
) {
  const canvas = document.createElement('canvas')
  canvas.width = a4Portrait.widthPx
  canvas.height = a4Portrait.heightPx

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('利用明細書PDFの作成に失敗しました。')
  }

  const receiptCompany = issueOptions.company
  const tradeName = receiptCompany?.name.trim() || settings.company.companyName.trim() || '介護タクシーメーター'
  const corporateName = receiptCompany?.corporateName?.trim() || ''
  const title = settings.receipt.statementDefault.trim() || defaultMeterSettings.receipt.statementDefault || '利用明細書'
  const customerName = issueOptions.customerName.trim()
  const issuerName = issueOptions.issuerName.trim()
  const address = [receiptCompany?.postalCode ? `〒${receiptCompany.postalCode}` : '', receiptCompany?.address || settings.company.address].filter((line) => line.trim()).join(' ')
  const phoneNumber = receiptCompany?.phoneNumber || settings.company.phoneNumber
  const companyLines = [
    tradeName,
    corporateName && corporateName !== tradeName ? corporateName : '',
    address,
    phoneNumber ? `TEL ${phoneNumber}` : '',
    receiptCompany?.invoiceNumber ? `登録番号 ${receiptCompany.invoiceNumber}` : '',
  ].filter((line) => line.trim())

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  drawText(context, issueOptions.isReissue ? `${title}（再発行）` : title, canvas.width / 2, 135, {
    align: 'center',
    font: 'bold 64px sans-serif',
  })
  drawLine(context, 430, 162, 810, 162, '#0f172a')

  companyLines.forEach((line, index) => {
    drawText(context, line, 1120, 225 + index * 32, {
      align: 'right',
      color: index === 0 ? '#0f172a' : '#475569',
      font: index === 0 ? 'bold 28px sans-serif' : '22px sans-serif',
    })
  })

  drawText(context, `${customerName || caseRecord.receiptName || caseRecord.customerName || ''} 様`, 120, 270, {
    font: 'bold 34px sans-serif',
  })
  drawText(context, '下記の通り、介護タクシー利用明細を発行します。', 120, 330, {
    color: '#334155',
    font: '28px sans-serif',
  })

  context.save()
  context.fillStyle = '#f0f9ff'
  context.strokeStyle = '#0284c7'
  context.lineWidth = 3
  context.roundRect(120, 375, 1000, 120, 20)
  context.fill()
  context.stroke()
  context.restore()

  drawText(context, '請求額', 170, 435, {
    color: '#075985',
    font: 'bold 30px sans-serif',
  })
  drawText(context, `${formatFareYen(caseRecord.totalFareYen)}円`, 1070, 465, {
    align: 'right',
    font: 'bold 56px sans-serif',
  })

  const lines = createStatementLines(caseRecord, customerName)
  const tableX = 120
  const tableTop = 555
  const tableWidth = 1000
  const labelWidth = 300
  const rowHeight = 54

  lines.forEach((line, index) => {
    const rowY = tableTop + index * rowHeight
    const isTotal = line.label === '請求額'

    if (index % 2 === 0) {
      context.fillStyle = '#f8fafc'
      context.fillRect(tableX, rowY, tableWidth, rowHeight)
    }

    drawLine(context, tableX, rowY, tableX + tableWidth, rowY)
    drawLine(context, tableX + labelWidth, rowY, tableX + labelWidth, rowY + rowHeight)
    drawText(context, line.label, tableX + 28, rowY + 36, {
      color: '#475569',
      font: 'bold 21px sans-serif',
    })
    drawText(context, line.value, tableX + labelWidth + 26, rowY + 36, {
      font: isTotal ? 'bold 26px sans-serif' : '22px sans-serif',
      maxWidth: tableWidth - labelWidth - 52,
    })
  })

  const tableBottom = tableTop + lines.length * rowHeight
  drawLine(context, tableX, tableBottom, tableX + tableWidth, tableBottom)
  drawLine(context, tableX, tableTop, tableX, tableBottom)
  drawLine(context, tableX + tableWidth, tableTop, tableX + tableWidth, tableBottom)

  if (issuerName) {
    drawText(context, '発行担当者', 120, 1580, {
      color: '#475569',
      font: '26px sans-serif',
    })
    drawText(context, issuerName, 290, 1580, {
      font: '26px sans-serif',
    })
  }

  drawText(context, '※本利用明細書は保存済み案件データをもとに発行しています。', 120, 1640, {
    color: '#64748b',
    font: '23px sans-serif',
  })

  return canvas
}

export async function downloadStatementPdf(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: StatementIssueOptions,
) {
  const [{ jsPDF }, canvas] = await Promise.all([
    import('jspdf'),
    Promise.resolve(createStatementCanvas(caseRecord, settings, issueOptions)),
  ])
  const pdf = new jsPDF({
    format: 'a4',
    orientation: 'portrait',
    unit: 'mm',
  })

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    a4Portrait.widthMm,
    a4Portrait.heightMm,
  )
  pdf.save(statementFileName(caseRecord.caseNumber))
}
