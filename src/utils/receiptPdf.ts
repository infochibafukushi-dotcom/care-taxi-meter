import type { StoredCaseRecord } from '../services/caseRecords'
import { defaultMeterSettings } from '../services/meterSettings'
import type { MeterSettings } from '../services/meterSettings'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from './caseRecords'

export type ReceiptIssueOptions = {
  customerName: string
  issuerName: string
  receiptNote: string
}

type ReceiptLine = {
  label: string
  value: string
}

const a4Portrait = {
  widthMm: 210,
  heightMm: 297,
  widthPx: 1240,
  heightPx: 1754,
}

const receiptFileName = (caseNumber: string) =>
  `receipt-${caseNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')}.pdf`

const normalizeReceiptTitle = (value: string) =>
  value.trim() || defaultMeterSettings.receipt.receiptDefault

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    align?: CanvasTextAlign
    color?: string
    font?: string
  } = {},
) {
  context.save()
  context.fillStyle = options.color ?? '#0f172a'
  context.font = options.font ?? '32px sans-serif'
  context.textAlign = options.align ?? 'left'
  context.textBaseline = 'alphabetic'
  context.fillText(text, x, y)
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

function createReceiptLines(caseRecord: StoredCaseRecord): ReceiptLine[] {
  const careOptionLines =
    caseRecord.assistCharges.length > 0
      ? [
          ...caseRecord.assistCharges.map((assistCharge) => ({
            label: `介助料金：${assistCharge.name}`,
            value: `${formatFareYen(assistCharge.amount)}円`,
          })),
          {
            label: '介助料金合計',
            value: `${formatFareYen(caseRecord.careOptionFareYen)}円`,
          },
        ]
      : [
          {
            label: '介助料金',
            value: `${formatFareYen(caseRecord.careOptionFareYen)}円`,
          },
        ]

  return [
    { label: '案件番号', value: caseRecord.caseNumber },
    { label: '利用日時', value: formatCaseDateTime(caseRecord.closedAt) },
    { label: '距離', value: `${caseRecord.distanceKm.toFixed(3)} km` },
    { label: '基本運賃', value: `${formatFareYen(caseRecord.basicFareYen)}円` },
    { label: '待機料金', value: `${formatFareYen(caseRecord.waitingFareYen)}円` },
    { label: '付き添い料金', value: `${formatFareYen(caseRecord.escortFareYen)}円` },
    ...careOptionLines,
    { label: '実費', value: `${formatFareYen(caseRecord.expenseFareYen)}円` },
    { label: '合計金額', value: `${formatFareYen(caseRecord.totalFareYen)}円` },
    { label: '支払方法', value: caseRecord.paymentMethod },
  ]
}

function drawConfiguredTextLines({
  context,
  lines,
  startY,
  x,
}: {
  context: CanvasRenderingContext2D
  lines: string[]
  startY: number
  x: number
}) {
  lines
    .filter((line) => line.trim())
    .forEach((line, index) => {
      drawText(context, line, x, startY + index * 30, {
        align: 'right',
        color: '#475569',
        font: index === 0 ? 'bold 28px sans-serif' : '22px sans-serif',
      })
    })
}

function drawReceiptHeader({
  companyLines,
  context,
  customerName,
}: {
  companyLines: string[]
  context: CanvasRenderingContext2D
  customerName: string
}) {
  context.save()
  context.strokeStyle = '#e2e8f0'
  context.lineWidth = 2
  context.roundRect(100, 270, 1040, 210, 18)
  context.stroke()
  context.restore()

  if (customerName) {
    drawText(context, `${customerName} 様`, 130, 325, {
      color: '#0f172a',
      font: 'bold 38px sans-serif',
    })
    drawLine(context, 130, 346, 560, 346, '#94a3b8')
  } else {
    drawText(context, '________________________________ 様', 130, 325, {
      color: '#0f172a',
      font: 'bold 34px sans-serif',
    })
  }

  drawText(context, '下記の通り領収いたしました。', 130, 405, {
    color: '#334155',
    font: '30px sans-serif',
  })
  drawConfiguredTextLines({
    context,
    lines: companyLines,
    startY: 292,
    x: 1120,
  })
}

function createReceiptCanvas(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ReceiptIssueOptions,
) {
  const canvas = document.createElement('canvas')
  canvas.width = a4Portrait.widthPx
  canvas.height = a4Portrait.heightPx

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('領収書PDFの作成に失敗しました。')
  }

  const receiptTitle = normalizeReceiptTitle(settings.receipt.receiptDefault)
  const statementTitle =
    settings.receipt.statementDefault.trim() ||
    defaultMeterSettings.receipt.statementDefault
  const companyName = settings.company.companyName.trim() || '介護タクシーメーター'
  const customerName = issueOptions.customerName.trim()
  const issuerName = issueOptions.issuerName.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim() || '未登録'
  const companyLines = [
    companyName,
    settings.company.phoneNumber ? `TEL ${settings.company.phoneNumber}` : '',
    settings.company.email ? `MAIL ${settings.company.email}` : '',
    settings.company.address,
    '登録番号',
    invoiceNumber,
  ]

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  drawText(context, receiptTitle, canvas.width / 2, 150, {
    align: 'center',
    font: 'bold 72px sans-serif',
  })
  drawLine(context, 430, 178, 810, 178, '#0f172a')

  drawText(context, statementTitle, canvas.width / 2, 230, {
    align: 'center',
    color: '#0369a1',
    font: 'bold 30px sans-serif',
  })

  drawReceiptHeader({
    companyLines,
    context,
    customerName,
  })

  context.save()
  context.fillStyle = '#f0f9ff'
  context.strokeStyle = '#0284c7'
  context.lineWidth = 3
  context.roundRect(120, 515, 1000, 145, 22)
  context.fill()
  context.stroke()
  context.restore()

  drawText(context, '合計金額', 170, 575, {
    color: '#075985',
    font: 'bold 30px sans-serif',
  })
  drawText(context, `${formatFareYen(caseRecord.totalFareYen)}円`, 1070, 625, {
    align: 'right',
    color: '#0f172a',
    font: 'bold 64px sans-serif',
  })

  if (receiptNote) {
    drawText(context, '但し書き', 120, 715, {
      color: '#475569',
      font: 'bold 26px sans-serif',
    })
    drawText(context, receiptNote, 270, 715, {
      color: '#0f172a',
      font: '28px sans-serif',
    })
  }

  const lines = createReceiptLines(caseRecord)
  const tableX = 120
  const tableTop = receiptNote ? 775 : 710
  const labelWidth = 320
  const rowHeight = 56
  const tableWidth = 1000

  lines.forEach((line, index) => {
    const rowY = tableTop + index * rowHeight
    const isTotal = line.label === '合計金額'

    if (index % 2 === 0) {
      context.fillStyle = '#f8fafc'
      context.fillRect(tableX, rowY, tableWidth, rowHeight)
    }

    drawLine(context, tableX, rowY, tableX + tableWidth, rowY)
    drawLine(context, tableX + labelWidth, rowY, tableX + labelWidth, rowY + rowHeight)
    drawText(context, line.label, tableX + 32, rowY + 38, {
      color: '#475569',
      font: 'bold 22px sans-serif',
    })
    drawText(context, line.value, tableX + tableWidth - 32, rowY + 38, {
      align: 'right',
      font: isTotal ? 'bold 30px sans-serif' : '24px sans-serif',
    })
  })

  const tableBottom = tableTop + lines.length * rowHeight
  drawLine(context, tableX, tableBottom, tableX + tableWidth, tableBottom)
  drawLine(context, tableX, tableTop, tableX, tableBottom)
  drawLine(context, tableX + tableWidth, tableTop, tableX + tableWidth, tableBottom)

  drawText(context, '発行日', 120, 1510, {
    color: '#475569',
    font: '28px sans-serif',
  })
  drawText(context, formatCaseDateTime(new Date().toISOString()), 240, 1510, {
    font: '28px sans-serif',
  })

  if (issuerName) {
    drawText(context, '発行担当者', 120, 1560, {
      color: '#475569',
      font: '28px sans-serif',
    })
    drawText(context, issuerName, 290, 1560, {
      font: '28px sans-serif',
    })
  }

  drawText(context, '※本領収書は保存済み案件データをもとに発行しています。', 120, 1625, {
    color: '#64748b',
    font: '24px sans-serif',
  })

  return canvas
}

export async function downloadReceiptPdf(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ReceiptIssueOptions,
) {
  const [{ jsPDF }, canvas] = await Promise.all([
    import('jspdf'),
    Promise.resolve(createReceiptCanvas(caseRecord, settings, issueOptions)),
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
  pdf.save(receiptFileName(caseRecord.caseNumber))
}
