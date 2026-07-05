import type { StoredCaseRecord } from '../services/caseRecords'
import { defaultMeterSettings } from '../services/meterSettings'
import type { MeterSettings } from '../services/meterSettings'
import type { Company } from '../types/work'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime, createPrimaryFareReceiptLines } from './caseRecords'
import { isReviewDemoCaseRecord, resolveReceiptServiceDateIso } from './reviewDemoFare'
import {
  createPdfFileName,
  drawPdfLine,
  drawPdfText,
  formatPaymentDetails,
  formatTaxiTicketDetails,
} from './pdfDrawing'

export type ReceiptIssueOptions = {
  customerName: string
  isReissue?: boolean
  issuerName: string
  receiptNote: string
  company?: Company | null
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

const receiptFileName = (caseNumber: string) => createPdfFileName('receipt', caseNumber)

const normalizeReceiptTitle = (value: string) =>
  value.trim() || defaultMeterSettings.receipt.receiptDefault

function createReceiptLines(caseRecord: StoredCaseRecord): ReceiptLine[] {
  const serviceDateIso = resolveReceiptServiceDateIso(caseRecord)
  const additionalCareFareYen = Math.max(Math.round(caseRecord.additionalCareFareYen ?? 0), 0)
  const isFixedMeter = caseRecord.meterMode === 'fixed'
  const hasFixedExtras =
    isFixedMeter &&
    (
      Math.max(Math.round(caseRecord.additionalRouteFareYen ?? 0), 0) > 0 ||
      additionalCareFareYen > 0 ||
      (caseRecord.routeChangeLogs?.length ?? 0) > 0
    )
  const settlementCareFareYen = Math.max(caseRecord.careOptionFareYen - additionalCareFareYen, 0)
  const careOptionLines = isReviewDemoCaseRecord(caseRecord)
    ? []
    : isFixedMeter
    ? hasFixedExtras && settlementCareFareYen > 0
      ? [
          {
            label: '介助料金',
            value: `${formatFareYen(settlementCareFareYen)}円`,
          },
        ]
      : caseRecord.assistCharges.map((assistCharge) => ({
          label: `追加介助：${assistCharge.name}`,
          value: `${formatFareYen(assistCharge.amount)}円`,
        }))
    : caseRecord.assistCharges.length > 0
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

  const expenseLines: ReceiptLine[] = [
    { label: '実費', value: `${formatFareYen(caseRecord.expenseFareYen)}円` },
    ...caseRecord.expenseCharges
      .filter((expenseCharge) => expenseCharge.name.trim())
      .map((expenseCharge) => ({
        label: `実費：${expenseCharge.name}`,
        value: `${formatFareYen(expenseCharge.amount)}円`,
      })),
  ]

  if (isFixedMeter) {
    const discountLines: ReceiptLine[] = caseRecord.isDisabilityDiscount
      ? [
          {
            label: caseRecord.discountName || '割引',
            value: `-${formatFareYen(caseRecord.disabilityDiscountAmount)}円`,
          },
        ]
      : []

    const taxiTicketLines: ReceiptLine[] =
      caseRecord.taxiTickets.length > 0 || caseRecord.taxiTicketAmountYen > 0
        ? [
            { label: 'タクシー券', value: formatTaxiTicketDetails(caseRecord) },
            {
              label: 'タクシー券適用額',
              value: `-${formatFareYen(caseRecord.taxiTicketAmountYen)}円`,
            },
          ]
        : []

    return [
      { label: '案件番号', value: caseRecord.caseNumber },
      { label: '宛名', value: caseRecord.receiptName || '未入力' },
      { label: '利用日時', value: formatCaseDateTime(serviceDateIso) },
      { label: '距離', value: `${caseRecord.distanceKm.toFixed(3)} km` },
      ...createPrimaryFareReceiptLines(caseRecord),
      {
        label: '待機/付き添い料金',
        value: `${formatFareYen(caseRecord.waitingFareYen + caseRecord.escortFareYen)}円`,
      },
      ...careOptionLines,
      ...expenseLines,
      ...discountLines,
      ...taxiTicketLines,
      { label: '合計請求額', value: `${formatFareYen(caseRecord.totalFareYen)}円` },
      { label: '支払方法', value: caseRecord.paymentMethod },
      { label: '支払内訳', value: formatPaymentDetails(caseRecord) },
    ]
  }

  return [
    { label: '案件番号', value: caseRecord.caseNumber },
    { label: '宛名', value: caseRecord.receiptName || '未入力' },
    { label: '利用日時', value: formatCaseDateTime(serviceDateIso) },
    { label: '距離', value: `${caseRecord.distanceKm.toFixed(3)} km` },
    ...createPrimaryFareReceiptLines(caseRecord),
    { label: '待機料金', value: `${formatFareYen(caseRecord.waitingFareYen)}円` },
    { label: '付き添い料金', value: `${formatFareYen(caseRecord.escortFareYen)}円` },
    ...careOptionLines,
    ...(caseRecord.customFeeFareYen > 0
      ? [
          ...caseRecord.customFees.map((customFee) => ({
            label: customFee.name,
            value: `${formatFareYen(customFee.amount)}円`,
          })),
          {
            label: 'その他合計',
            value: `${formatFareYen(caseRecord.customFeeFareYen)}円`,
          },
        ]
      : []),
    { label: caseRecord.discountName || '割引', value: caseRecord.isDisabilityDiscount ? `-${formatFareYen(caseRecord.disabilityDiscountAmount)}円` : '未適用' },
    { label: 'タクシー券', value: formatTaxiTicketDetails(caseRecord) },
    { label: 'タクシー券適用額', value: `-${formatFareYen(caseRecord.taxiTicketAmountYen)}円` },
    ...expenseLines,
    { label: '合計金額', value: `${formatFareYen(caseRecord.totalFareYen)}円` },
    { label: '支払方法', value: caseRecord.paymentMethod },
    { label: '支払内訳', value: formatPaymentDetails(caseRecord) },
  ]
}

function drawCompanyInformation({
  context,
  lines,
}: {
  context: CanvasRenderingContext2D
  lines: string[]
}) {
  lines
    .filter((line) => line.trim())
    .forEach((line, index) => {
      drawPdfText(context, line, 1120, 292 + index * 30, {
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

  drawCompanyInformation({ context, lines: companyLines })

  if (customerName) {
    drawPdfText(context, `${customerName} 様`, 130, 325, {
      color: '#0f172a',
      font: 'bold 38px sans-serif',
    })
    drawPdfLine(context, 130, 346, 560, 346, '#94a3b8')
  } else {
    drawPdfLine(context, 130, 346, 520, 346, '#94a3b8')
    drawPdfText(context, '様', 535, 325, {
      color: '#0f172a',
      font: 'bold 34px sans-serif',
    })
  }

  drawPdfText(context, '下記の通り領収いたしました。', 130, 405, {
    color: '#334155',
    font: '30px sans-serif',
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
  const tradeName = settings.company.tradeName.trim() || settings.company.corporateName.trim()
  const corporateName = settings.company.corporateName.trim()
  const address = [settings.company.postalCode ? `〒${settings.company.postalCode}` : '', settings.company.address].filter((line) => line.trim()).join(' ')
  const customerName = issueOptions.customerName.trim()
  const issuerName = issueOptions.issuerName.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim()
  const companyLines = [
    tradeName,
    corporateName && corporateName !== tradeName ? corporateName : '',
    address,
    settings.company.phoneNumber ? `TEL ${settings.company.phoneNumber}` : '',
    invoiceNumber ? `登録番号 ${invoiceNumber}` : '',
  ]

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  drawPdfText(context, issueOptions.isReissue ? `${receiptTitle}（再発行）` : receiptTitle, canvas.width / 2, 150, {
    align: 'center',
    font: 'bold 72px sans-serif',
  })
  drawPdfLine(context, 430, 178, 810, 178, '#0f172a')

  drawPdfText(context, statementTitle, canvas.width / 2, 230, {
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

  drawPdfText(context, '合計金額', 170, 575, {
    color: '#075985',
    font: 'bold 30px sans-serif',
  })
  drawPdfText(context, `${formatFareYen(caseRecord.totalFareYen)}円`, 1070, 625, {
    align: 'right',
    color: '#0f172a',
    font: 'bold 64px sans-serif',
  })

  if (receiptNote) {
    drawPdfText(context, '但し書き', 120, 715, {
      color: '#475569',
      font: 'bold 26px sans-serif',
    })
    drawPdfText(context, receiptNote, 270, 715, {
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
    const isTotal = line.label === '合計金額' || line.label === '合計請求額'

    if (index % 2 === 0) {
      context.fillStyle = '#f8fafc'
      context.fillRect(tableX, rowY, tableWidth, rowHeight)
    }

    drawPdfLine(context, tableX, rowY, tableX + tableWidth, rowY)
    drawPdfLine(context, tableX + labelWidth, rowY, tableX + labelWidth, rowY + rowHeight)
    drawPdfText(context, line.label, tableX + 32, rowY + 38, {
      color: '#475569',
      font: 'bold 22px sans-serif',
    })
    drawPdfText(context, line.value, tableX + tableWidth - 32, rowY + 38, {
      align: 'right',
      font: isTotal ? 'bold 30px sans-serif' : '24px sans-serif',
    })
  })

  const tableBottom = tableTop + lines.length * rowHeight
  drawPdfLine(context, tableX, tableBottom, tableX + tableWidth, tableBottom)
  drawPdfLine(context, tableX, tableTop, tableX, tableBottom)
  drawPdfLine(context, tableX + tableWidth, tableTop, tableX + tableWidth, tableBottom)

  drawPdfText(context, '発行日', 120, 1510, {
    color: '#475569',
    font: '28px sans-serif',
  })
  drawPdfText(context, formatCaseDateTime(new Date().toISOString()), 240, 1510, {
    font: '28px sans-serif',
  })

  if (issuerName) {
    drawPdfText(context, '発行担当者', 120, 1560, {
      color: '#475569',
      font: '28px sans-serif',
    })
    drawPdfText(context, issuerName, 290, 1560, {
      font: '28px sans-serif',
    })
  }

  drawPdfText(context, '※本領収書は保存済み案件データをもとに発行しています。', 120, 1625, {
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
