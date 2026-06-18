import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import { formatFareYen } from '../services/fare'
import { createPrimaryFareReceiptLines } from './caseRecords'
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

/** PT-210 / 58mm ロール紙（203dpi 相当） */
export const thermalReceiptPaper = {
  widthMm: 58,
  heightMm: 220,
  widthPx: 384,
  heightPx: 1200,
} as const

/**
 * 58mm レシート専用レイアウト
 * - textX = marginLeft
 * - amountX = widthPx - marginRight（金額は右端寄せで横幅を最大活用）
 */
export const THERMAL_RECEIPT_LAYOUT = {
  marginLeft: 0,
  marginRight: 0,
  /** ラベルと金額の最小間隔 */
  labelAmountGap: 8,
  /** インデント行の字下げ */
  indent: 16,
} as const

export const THERMAL_RECEIPT_FONT_FAMILY =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif'

/** 視認性優先のフォント階層（単純拡大ではなく役割ごとにサイズ差） */
const THERMAL_FONTS = {
  shop: `bold 24px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  corp: `19px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  address: `16px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  title: `bold 30px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  customer: `bold 20px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  meta: `15px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  fare: `20px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  fareSub: `18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  total: `bold 32px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  pay: `18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  legal: `16px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  footer: `bold 17px ${THERMAL_RECEIPT_FONT_FAMILY}`,
} as const

const LINE = {
  shop: 28,
  corp: 23,
  address: 19,
  title: 36,
  customer: 24,
  meta: 18,
  fare: 24,
  fareSub: 22,
  total: 38,
  pay: 22,
  legal: 20,
  footer: 22,
  section: 6,
  divider: 8,
} as const

const textX = () => THERMAL_RECEIPT_LAYOUT.marginLeft

const amountX = (canvas: HTMLCanvasElement) =>
  canvas.width - THERMAL_RECEIPT_LAYOUT.marginRight

const contentWidth = (canvas: HTMLCanvasElement) =>
  canvas.width - THERMAL_RECEIPT_LAYOUT.marginLeft - THERMAL_RECEIPT_LAYOUT.marginRight

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
    font: THERMAL_FONTS.fare,
    ...options,
  })

function wrapThermalLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  if (!text.trim()) {
    return []
  }

  context.save()
  context.font = font

  const lines: string[] = []
  let current = ''

  for (const char of text) {
    const candidate = current + char
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = char
      continue
    }
    current = candidate
  }

  if (current) {
    lines.push(current)
  }

  context.restore()
  return lines
}

function drawWrappedLines(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  y: number,
  text: string,
  font: string,
  lineHeight: number,
  align: CanvasTextAlign = 'left',
): number {
  const lines = wrapThermalLines(context, text, contentWidth(canvas), font)

  lines.forEach((line) => {
    const x = align === 'center' ? canvas.width / 2 : textX()
    drawThermalText(context, line, x, y, { align, font })
    y += lineHeight
  })

  return y
}

function drawInlineLine(
  context: CanvasRenderingContext2D,
  y: number,
  text: string,
  font: string = THERMAL_FONTS.fare,
  lineHeight: number = LINE.fare,
): number {
  drawThermalText(context, text, textX(), y, { font })
  return y + lineHeight
}

type FareRow = {
  label: string
  amount: string
  indent?: boolean
}

/** ラベル左・金額右で 58mm 幅を横いっぱいに使う */
function drawLabelAmountLine(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  y: number,
  label: string,
  amount: string,
  font: string,
  lineHeight: number,
  indent = 0,
): number {
  const labelStartX = textX() + indent
  const rightX = amountX(canvas)

  context.save()
  context.font = font
  const amountWidth = context.measureText(amount).width
  const maxLabelWidth = Math.max(
    contentWidth(canvas) - amountWidth - THERMAL_RECEIPT_LAYOUT.labelAmountGap - indent,
    48,
  )
  context.restore()

  const labelLines = wrapThermalLines(context, label, maxLabelWidth, font)

  labelLines.forEach((line, index) => {
    drawThermalText(context, line, labelStartX, y, { font })
    if (index === labelLines.length - 1) {
      drawThermalText(context, amount, rightX, y, { align: 'right', font })
    }
    y += lineHeight
  })

  return y
}

function drawDivider(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, y: number): number {
  context.save()
  context.strokeStyle = '#111827'
  context.setLineDash([4, 4])
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(textX(), y)
  context.lineTo(canvas.width - THERMAL_RECEIPT_LAYOUT.marginRight, y)
  context.stroke()
  context.restore()
  return y + LINE.divider
}

export function formatThermalReceiptDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '日時未記録'
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

function formatThermalYen(yen: number) {
  return `${formatFareYen(yen)}円`
}

function createThermalReceiptRows(
  caseRecord: StoredCaseRecord,
  expenseItems: ExpenseItem[],
): FareRow[] {
  const rows: FareRow[] = [
    ...createPrimaryFareReceiptLines(caseRecord).map((line) => ({
      label: line.label,
      amount: line.value,
    })),
    { label: '待機料金', amount: formatThermalYen(caseRecord.waitingFareYen) },
    { label: '付き添い料金', amount: formatThermalYen(caseRecord.escortFareYen) },
    { label: '介助料金', amount: formatThermalYen(caseRecord.careOptionFareYen) },
  ]

  caseRecord.assistCharges.forEach((assistCharge) => {
    rows.push({
      indent: true,
      label: assistCharge.name,
      amount: formatThermalYen(assistCharge.amount),
    })
  })

  rows.push({
    label: caseRecord.discountName || '割引',
    amount: caseRecord.isDisabilityDiscount
      ? `-${formatThermalYen(caseRecord.disabilityDiscountAmount)}`
      : '未適用',
  })
  rows.push({ label: 'タクシー券', amount: `-${formatThermalYen(caseRecord.taxiTicketAmountYen)}` })
  caseRecord.taxiTickets.forEach((ticket) => {
    rows.push({
      indent: true,
      label: `${ticket.municipality} ${ticket.ticketNumber || '番号未入力'}`,
      amount: formatThermalYen(ticket.amount),
    })
  })
  rows.push({ label: '実費', amount: formatThermalYen(caseRecord.expenseFareYen) })
  expenseItems
    .filter((expenseItem) => expenseItem.name.trim())
    .forEach((expenseItem) => {
      rows.push({
        indent: true,
        label: expenseItem.name,
        amount: formatThermalYen(expenseItem.amountYen),
      })
    })

  return rows
}

function drawThermalReceiptHeader(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: MeterSettings,
  y: number,
): number {
  const companyName = settings.company.tradeName.trim() || settings.company.corporateName.trim()
  const corporateName = settings.company.corporateName.trim()

  y = drawWrappedLines(context, canvas, y, companyName, THERMAL_FONTS.shop, LINE.shop)
  if (corporateName && corporateName !== companyName) {
    y = drawWrappedLines(context, canvas, y, corporateName, THERMAL_FONTS.corp, LINE.corp)
  }

  ;[
    settings.company.postalCode ? `〒${settings.company.postalCode}` : '',
    settings.company.address,
    settings.company.phoneNumber ? `TEL ${settings.company.phoneNumber}` : '',
  ]
    .filter((line) => line.trim())
    .forEach((line) => {
      y = drawWrappedLines(context, canvas, y, line, THERMAL_FONTS.address, LINE.address)
    })

  return y
}

function drawFareRows(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  y: number,
  rows: FareRow[],
): number {
  rows.forEach((row) => {
    const font = row.indent ? THERMAL_FONTS.fareSub : THERMAL_FONTS.fare
    const lineHeight = row.indent ? LINE.fareSub : LINE.fare
    y = drawLabelAmountLine(
      context,
      canvas,
      y,
      row.label,
      row.amount,
      font,
      lineHeight,
      row.indent ? THERMAL_RECEIPT_LAYOUT.indent : 0,
    )
  })
  return y
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

  const customerName = issueOptions.customerName.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const issuerName = issueOptions.issuerName.trim()
  let y = 12

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  y = drawThermalReceiptHeader(context, canvas, settings, y)
  y += LINE.section
  y = drawDivider(context, canvas, y)

  drawThermalText(context, issueOptions.isReissue ? '領収書（再発行）' : '領収書', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.title,
  })
  y += LINE.title

  y = drawInlineLine(
    context,
    y,
    customerName ? `${customerName} 様` : '________________ 様',
    THERMAL_FONTS.customer,
    LINE.customer,
  )
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawInlineLine(context, y, `発行日 ${formatThermalReceiptDateTime(new Date().toISOString())}`, THERMAL_FONTS.meta, LINE.meta)
  y = drawInlineLine(context, y, `利用日 ${formatThermalReceiptDateTime(caseRecord.closedAt)}`, THERMAL_FONTS.meta, LINE.meta)
  y = drawInlineLine(context, y, `案件番号 ${caseRecord.caseNumber}`, THERMAL_FONTS.meta, LINE.meta)

  y += LINE.section
  y = drawDivider(context, canvas, y)
  y = drawFareRows(context, canvas, y, createThermalReceiptRows(caseRecord, issueOptions.expenseItems))

  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawLabelAmountLine(
    context,
    canvas,
    y,
    '合計',
    formatThermalYen(caseRecord.totalFareYen),
    THERMAL_FONTS.total,
    LINE.total,
  )
  y = drawInlineLine(context, y, `支払 ${caseRecord.paymentMethod || '未設定'}`, THERMAL_FONTS.pay, LINE.pay)

  const paymentLines = caseRecord.payments.length > 0
    ? caseRecord.payments
    : [{ amount: caseRecord.totalFareYen, id: 'legacy-payment', type: caseRecord.paymentMethod }]
  paymentLines.forEach((payment) => {
    y = drawLabelAmountLine(
      context,
      canvas,
      y,
      `内訳 ${payment.type}`,
      formatThermalYen(payment.amount),
      THERMAL_FONTS.pay,
      LINE.pay,
    )
  })

  if (receiptNote) {
    y += LINE.section
    y = drawDivider(context, canvas, y)
    y = drawInlineLine(context, y, '但し書き', THERMAL_FONTS.legal, LINE.legal)
    y = drawWrappedLines(context, canvas, y, receiptNote, THERMAL_FONTS.legal, LINE.legal)
  }

  if (invoiceNumber) {
    y += LINE.section
    y = drawDivider(context, canvas, y)
    y = drawInlineLine(context, y, `登録番号 ${invoiceNumber}`, THERMAL_FONTS.legal, LINE.legal)
  }

  if (issuerName) {
    y = drawInlineLine(context, y, `発行担当者 ${issuerName}`, THERMAL_FONTS.legal, LINE.legal)
  }

  y += LINE.section
  drawThermalText(context, 'ありがとうございました', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.footer,
  })

  canvas.dataset.contentBottom = String(y + LINE.footer)
  return canvas
}

const TEST_RECEIPT_DATA = {
  tradeName: 'ちばケアタクシー',
  corporateName: '株式会社千葉福祉サポート',
  datetime: '2026/06/18 22:30',
  caseNumber: '260618-MAINS-0019',
  totalYen: 2500,
} as const

export function createTestReceiptCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = thermalReceiptPaper.widthPx
  canvas.height = 720

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('テストレシート画像の作成に失敗しました。')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  let y = 12

  y = drawWrappedLines(context, canvas, y, TEST_RECEIPT_DATA.tradeName, THERMAL_FONTS.shop, LINE.shop)
  y = drawWrappedLines(context, canvas, y, TEST_RECEIPT_DATA.corporateName, THERMAL_FONTS.corp, LINE.corp)
  y += LINE.section
  y = drawDivider(context, canvas, y)

  drawThermalText(context, '領収書', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.title,
  })
  y += LINE.title
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawInlineLine(context, y, `発行日 ${TEST_RECEIPT_DATA.datetime}`, THERMAL_FONTS.meta, LINE.meta)
  y = drawInlineLine(context, y, `利用日 ${TEST_RECEIPT_DATA.datetime}`, THERMAL_FONTS.meta, LINE.meta)
  y = drawInlineLine(context, y, `案件番号 ${TEST_RECEIPT_DATA.caseNumber}`, THERMAL_FONTS.meta, LINE.meta)
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawLabelAmountLine(context, canvas, y, '基本運賃', '2,000円', THERMAL_FONTS.fare, LINE.fare)
  y = drawLabelAmountLine(context, canvas, y, '待機料金', '500円', THERMAL_FONTS.fare, LINE.fare)
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawLabelAmountLine(
    context,
    canvas,
    y,
    '合計',
    formatThermalYen(TEST_RECEIPT_DATA.totalYen),
    THERMAL_FONTS.total,
    LINE.total,
  )
  y = drawInlineLine(context, y, '支払 現金', THERMAL_FONTS.pay, LINE.pay)
  y = drawLabelAmountLine(
    context,
    canvas,
    y,
    '内訳 現金',
    formatThermalYen(TEST_RECEIPT_DATA.totalYen),
    THERMAL_FONTS.pay,
    LINE.pay,
  )

  y += LINE.section
  drawThermalText(context, 'ラスター印字テスト OK', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.footer,
  })

  canvas.dataset.contentBottom = String(y + LINE.footer)
  return canvas
}
