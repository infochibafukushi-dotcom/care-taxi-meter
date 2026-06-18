import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime, createPrimaryFareReceiptLines } from './caseRecords'
import { drawPdfText } from './pdfDrawing'
import type { ExpenseItem } from '../types/case'

export type ThermalReceiptIssueOptions = {
  customerName: string
  isReissue?: boolean
  expenseItems: ExpenseItem[]
  issuerName: string
  receiptNote: string
  company?: import('../types/work').Company | null
}

type ThermalLine = {
  label: string
  value: string
  indent?: boolean
}

export const thermalReceiptPaper = {
  widthMm: 80,
  heightMm: 220,
  widthPx: 640,
  heightPx: 1760,
} as const

/** Canvas 上で日本語を確実に描画するフォントスタック */
export const THERMAL_RECEIPT_FONT_FAMILY =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif'

const drawThermalText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    align?: CanvasTextAlign
    font?: string
  } = {},
) =>
  drawPdfText(context, text, x, y, {
    color: '#111827',
    font: `28px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    ...options,
  })

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
    ...createPrimaryFareReceiptLines(caseRecord).map((line) => ({
      label: line.label,
      value: line.value,
    })),
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

  lines.push({
    label: caseRecord.discountName || '割引',
    value: caseRecord.isDisabilityDiscount
      ? `-${formatFareYen(caseRecord.disabilityDiscountAmount)}円`
      : '未適用',
  })
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

export function createThermalReceiptCanvas(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
) {
  const canvas = document.createElement('canvas')
  canvas.width = thermalReceiptPaper.widthPx
  canvas.height = thermalReceiptPaper.heightPx

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('レシート画像の作成に失敗しました。')
  }

  const companyName = settings.company.tradeName.trim() || settings.company.corporateName.trim()
  const corporateName = settings.company.corporateName.trim()
  const customerName = issueOptions.customerName.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const issuerName = issueOptions.issuerName.trim()
  let y = 58

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  drawThermalText(context, companyName, canvas.width / 2, y, {
    align: 'center',
    font: `bold 30px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 38
  if (corporateName && corporateName !== companyName) {
    drawThermalText(context, corporateName, canvas.width / 2, y, {
      align: 'center',
      font: `28px ${THERMAL_RECEIPT_FONT_FAMILY}`,
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
      drawThermalText(context, line, canvas.width / 2, y, {
        align: 'center',
        font: `22px ${THERMAL_RECEIPT_FONT_FAMILY}`,
      })
      y += 28
    })

  y += 16
  drawDivider(context, y)
  y += 52
  drawThermalText(context, issueOptions.isReissue ? '領収書（再発行）' : '領収書', canvas.width / 2, y, {
    align: 'center',
    font: `bold 48px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 52
  drawThermalText(context, customerName ? `${customerName} 様` : '________________ 様', 48, y, {
    font: `bold 30px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 40
  drawDivider(context, y)
  y += 42

  ;[
    ['発行日', formatCaseDateTime(new Date().toISOString())],
    ['利用日', formatCaseDateTime(caseRecord.closedAt)],
    ['案件番号', caseRecord.caseNumber],
  ].forEach(([label, value]) => {
    drawThermalText(context, label, 48, y, { font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    drawThermalText(context, value, canvas.width - 48, y, {
      align: 'right',
      font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    y += 34
  })

  y += 10
  drawDivider(context, y)
  y += 42
  createThermalReceiptLines(caseRecord, issueOptions.expenseItems).forEach((line) => {
    drawThermalText(context, line.label, line.indent ? 74 : 48, y, {
      font: line.indent ? `22px ${THERMAL_RECEIPT_FONT_FAMILY}` : `24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    drawThermalText(context, line.value, canvas.width - 48, y, {
      align: 'right',
      font: line.indent ? `22px ${THERMAL_RECEIPT_FONT_FAMILY}` : `24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    y += 34
  })

  y += 10
  drawDivider(context, y)
  y += 58
  drawThermalText(context, '合計', 48, y, { font: `bold 34px ${THERMAL_RECEIPT_FONT_FAMILY}` })
  drawThermalText(context, `${formatFareYen(caseRecord.totalFareYen)}円`, canvas.width - 48, y, {
    align: 'right',
    font: `bold 46px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 58
  drawThermalText(context, '支払方法', 48, y, { font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}` })
  drawThermalText(context, caseRecord.paymentMethod || '未設定', canvas.width - 48, y, {
    align: 'right',
    font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 34
  const paymentLines = caseRecord.payments.length > 0
    ? caseRecord.payments
    : [{ amount: caseRecord.totalFareYen, id: 'legacy-payment', type: caseRecord.paymentMethod }]
  paymentLines.forEach((payment) => {
    drawThermalText(context, `支払内訳 ${payment.type}`, 48, y, { font: `22px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    drawThermalText(context, `${formatFareYen(payment.amount)}円`, canvas.width - 48, y, {
      align: 'right',
      font: `22px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    y += 30
  })
  y += 12

  if (receiptNote) {
    drawDivider(context, y)
    y += 38
    drawThermalText(context, '但し書き', 48, y, { font: `bold 24px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    y += 32
    drawThermalText(context, receiptNote, 48, y, { font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    y += 42
  }

  if (invoiceNumber) {
    drawDivider(context, y)
    y += 38
    drawThermalText(context, '登録番号', canvas.width / 2, y, {
      align: 'center',
      font: `bold 24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    y += 32
    drawThermalText(context, invoiceNumber, canvas.width / 2, y, {
      align: 'center',
      font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
    })
    y += 40
  }

  if (issuerName) {
    drawThermalText(context, `発行担当者 ${issuerName}`, 48, y, { font: `24px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    y += 42
  }

  drawThermalText(context, 'ありがとうございました', canvas.width / 2, y + 16, {
    align: 'center',
    font: `bold 28px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })

  canvas.dataset.contentBottom = String(y + 80)
  return canvas
}

const DEFAULT_TEST_RECEIPT_LINES = [
  '基本運賃',
  '待機料金',
  '付き添い料金',
  '介助料金',
  '柏市・千葉県（漢字テスト）',
  'ありがとうございました',
] as const

/** PoC / 接続テスト用レシート Canvas（本番と同じ 80mm 幅・フォント） */
export function createTestReceiptCanvas(options: {
  title?: string
  lines?: string[]
} = {}) {
  const title = options.title ?? '領収書'
  const lines = options.lines ?? [
    ...DEFAULT_TEST_RECEIPT_LINES,
    new Date().toLocaleString('ja-JP'),
    'ラスター印字テスト OK',
  ]

  const canvas = document.createElement('canvas')
  canvas.width = thermalReceiptPaper.widthPx
  canvas.height = 960

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('テストレシート画像の作成に失敗しました。')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  let y = 58
  drawThermalText(context, title, canvas.width / 2, y, {
    align: 'center',
    font: `bold 48px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  })
  y += 56
  drawDivider(context, y)
  y += 48

  lines.forEach((line) => {
    drawThermalText(context, line, 48, y, { font: `26px ${THERMAL_RECEIPT_FONT_FAMILY}` })
    y += 40
  })

  canvas.dataset.contentBottom = String(y + 48)
  return canvas
}
