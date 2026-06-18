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
 * - 本文開始位置 textX = marginLeft
 * - 印字幅 contentWidth = widthPx - marginLeft - marginRight
 * - 右寄せは使わず左寄せ一行で印字幅を最大活用
 */
export const THERMAL_RECEIPT_LAYOUT = {
  marginLeft: 0,
  marginRight: 0,
} as const

/** Canvas 上で日本語を確実に描画するフォントスタック */
export const THERMAL_RECEIPT_FONT_FAMILY =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif'

const THERMAL_FONTS = {
  shop: `bold 22px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  corp: `20px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  meta: `18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  title: `bold 28px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  customer: `bold 20px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  body: `18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  bodyBold: `bold 18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  total: `bold 22px ${THERMAL_RECEIPT_FONT_FAMILY}`,
  footer: `bold 18px ${THERMAL_RECEIPT_FONT_FAMILY}`,
} as const

const LINE = {
  shop: 26,
  corp: 24,
  meta: 22,
  title: 34,
  customer: 26,
  body: 22,
  total: 28,
  footer: 24,
  section: 10,
  divider: 14,
} as const

const textX = () => THERMAL_RECEIPT_LAYOUT.marginLeft

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
    font: THERMAL_FONTS.body,
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
  const width = contentWidth(canvas)
  const lines = wrapThermalLines(context, text, width, font)

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
  font: string = THERMAL_FONTS.body,
  lineHeight: number = LINE.body,
): number {
  drawThermalText(context, text, textX(), y, { font })
  return y + lineHeight
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

/** レシート印字用 YYYY/MM/DD HH:mm（省略なし） */
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

function createThermalReceiptLines(
  caseRecord: StoredCaseRecord,
  expenseItems: ExpenseItem[],
): string[] {
  const lines: string[] = [
    ...createPrimaryFareReceiptLines(caseRecord).map((line) => `${line.label} ${line.value}`),
    `待機料金 ${formatThermalYen(caseRecord.waitingFareYen)}`,
    `付き添い料金 ${formatThermalYen(caseRecord.escortFareYen)}`,
    `介助料金 ${formatThermalYen(caseRecord.careOptionFareYen)}`,
  ]

  caseRecord.assistCharges.forEach((assistCharge) => {
    lines.push(`  ${assistCharge.name} ${formatThermalYen(assistCharge.amount)}`)
  })

  lines.push(
    `${caseRecord.discountName || '割引'} ${
      caseRecord.isDisabilityDiscount
        ? `-${formatThermalYen(caseRecord.disabilityDiscountAmount)}`
        : '未適用'
    }`,
  )
  lines.push(`タクシー券 -${formatThermalYen(caseRecord.taxiTicketAmountYen)}`)
  caseRecord.taxiTickets.forEach((ticket) => {
    lines.push(
      `  ${ticket.municipality} ${ticket.ticketNumber || '番号未入力'} ${formatThermalYen(ticket.amount)}`,
    )
  })
  lines.push(`実費 ${formatThermalYen(caseRecord.expenseFareYen)}`)
  expenseItems
    .filter((expenseItem) => expenseItem.name.trim())
    .forEach((expenseItem) => {
      lines.push(`  ${expenseItem.name} ${formatThermalYen(expenseItem.amountYen)}`)
    })

  return lines
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
      y = drawWrappedLines(context, canvas, y, line, THERMAL_FONTS.meta, LINE.meta)
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
  let y = 20

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

  y = drawInlineLine(context, y, `発行日 ${formatThermalReceiptDateTime(new Date().toISOString())}`)
  y = drawInlineLine(context, y, `利用日 ${formatThermalReceiptDateTime(caseRecord.closedAt)}`)
  y = drawInlineLine(context, y, `案件番号 ${caseRecord.caseNumber}`)

  y += LINE.section
  y = drawDivider(context, canvas, y)

  createThermalReceiptLines(caseRecord, issueOptions.expenseItems).forEach((line) => {
    y = drawInlineLine(context, y, line)
  })

  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawInlineLine(context, y, `合計 ${formatThermalYen(caseRecord.totalFareYen)}`, THERMAL_FONTS.total, LINE.total)
  y = drawInlineLine(context, y, `支払 ${caseRecord.paymentMethod || '未設定'}`)

  const paymentLines = caseRecord.payments.length > 0
    ? caseRecord.payments
    : [{ amount: caseRecord.totalFareYen, id: 'legacy-payment', type: caseRecord.paymentMethod }]
  paymentLines.forEach((payment) => {
    y = drawInlineLine(context, y, `内訳 ${payment.type} ${formatThermalYen(payment.amount)}`)
  })

  if (receiptNote) {
    y += LINE.section
    y = drawDivider(context, canvas, y)
    y = drawInlineLine(context, y, '但し書き', THERMAL_FONTS.bodyBold)
    y = drawWrappedLines(context, canvas, y, receiptNote, THERMAL_FONTS.body, LINE.body)
  }

  if (invoiceNumber) {
    y += LINE.section
    y = drawDivider(context, canvas, y)
    y = drawInlineLine(context, y, `登録番号 ${invoiceNumber}`)
  }

  if (issuerName) {
    y = drawInlineLine(context, y, `発行担当者 ${issuerName}`)
  }

  y += LINE.section
  drawThermalText(context, 'ありがとうございました', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.footer,
  })

  canvas.dataset.contentBottom = String(y + LINE.footer)
  return canvas
}

/** PoC 58mm 実機確認用固定データ */
const TEST_RECEIPT_DATA = {
  tradeName: 'ちばケアタクシー',
  corporateName: '株式会社千葉福祉サポート',
  datetime: '2026/06/18 22:30',
  caseNumber: '260618-MAINS-0019',
  totalYen: 2500,
} as const

/** PoC / 接続テスト用レシート（本番と同じ 58mm ラスター経路） */
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

  let y = 20

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

  y = drawInlineLine(context, y, `発行日 ${TEST_RECEIPT_DATA.datetime}`)
  y = drawInlineLine(context, y, `利用日 ${TEST_RECEIPT_DATA.datetime}`)
  y = drawInlineLine(context, y, `案件番号 ${TEST_RECEIPT_DATA.caseNumber}`)
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawInlineLine(context, y, '基本運賃 2,000円')
  y = drawInlineLine(context, y, '待機料金 500円')
  y += LINE.section
  y = drawDivider(context, canvas, y)

  y = drawInlineLine(context, y, `合計 ${formatThermalYen(TEST_RECEIPT_DATA.totalYen)}`, THERMAL_FONTS.total, LINE.total)
  y = drawInlineLine(context, y, '支払 現金')
  y = drawInlineLine(context, y, `内訳 現金 ${formatThermalYen(TEST_RECEIPT_DATA.totalYen)}`)

  y += LINE.section
  drawThermalText(context, 'ラスター印字テスト OK', canvas.width / 2, y, {
    align: 'center',
    font: THERMAL_FONTS.footer,
  })

  canvas.dataset.contentBottom = String(y + LINE.footer)
  return canvas
}
