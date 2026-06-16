import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'

export function drawPdfText(
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

export function drawPdfLine(
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

export function formatPaymentDetails(caseRecord: StoredCaseRecord) {
  return caseRecord.payments.length > 0
    ? caseRecord.payments
        .map((payment) => `${payment.type} ${formatFareYen(payment.amount)}円`)
        .join(' / ')
    : caseRecord.paymentMethod
}

export function formatTaxiTicketDetails(caseRecord: StoredCaseRecord) {
  return caseRecord.taxiTickets.length > 0
    ? caseRecord.taxiTickets
        .map(
          (ticket) =>
            `${ticket.municipality} ${ticket.ticketNumber || '番号未入力'} ${formatFareYen(ticket.amount)}円`,
        )
        .join(' / ')
    : '未使用'
}

export function createPdfFileName(prefix: string, caseNumber: string) {
  return `${prefix}-${caseNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')}.pdf`
}
