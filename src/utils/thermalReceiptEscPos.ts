import type { StoredCaseRecord } from '../services/caseRecords'
import type { MeterSettings } from '../services/meterSettings'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime, createPrimaryFareReceiptLines } from './caseRecords'
import type { ThermalReceiptIssueOptions } from './thermalReceiptPdf'
import type { ExpenseItem } from '../types/case'
import {
  appendEscPosAlign,
  appendEscPosBold,
  appendEscPosDivider,
  appendEscPosLine,
  buildEscPosDocument,
} from './escPosCommands'

type ThermalLine = {
  label: string
  value: string
  indent?: boolean
}

const RECEIPT_LINE_WIDTH = 32

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

function appendLabelValueLine(chunks: number[], label: string, value: string, indent = false) {
  const prefix = indent ? '  ' : ''
  const maxLabelWidth = RECEIPT_LINE_WIDTH - value.length - 1
  const trimmedLabel = `${prefix}${label}`.slice(0, Math.max(maxLabelWidth, 8))
  const padding = Math.max(RECEIPT_LINE_WIDTH - trimmedLabel.length - value.length, 1)
  appendEscPosLine(chunks, `${trimmedLabel}${' '.repeat(padding)}${value}`)
}

export function buildThermalReceiptEscPos(
  caseRecord: StoredCaseRecord,
  settings: MeterSettings,
  issueOptions: ThermalReceiptIssueOptions,
): Uint8Array {
  const companyName = settings.company.tradeName.trim() || settings.company.corporateName.trim()
  const corporateName = settings.company.corporateName.trim()
  const customerName = issueOptions.customerName.trim()
  const invoiceNumber = settings.receipt.invoiceNumber.trim()
  const receiptNote = issueOptions.receiptNote.trim()
  const issuerName = issueOptions.issuerName.trim()
  const paymentLines = caseRecord.payments.length > 0
    ? caseRecord.payments
    : [{ amount: caseRecord.totalFareYen, id: 'legacy-payment', type: caseRecord.paymentMethod }]

  return buildEscPosDocument((chunks) => {
    appendEscPosAlign(chunks, 'center')
    appendEscPosBold(chunks, true)
    appendEscPosLine(chunks, companyName)
    appendEscPosBold(chunks, false)

    if (corporateName && corporateName !== companyName) {
      appendEscPosLine(chunks, corporateName)
    }

    ;[
      settings.company.postalCode ? `〒${settings.company.postalCode}` : '',
      settings.company.address,
      settings.company.phoneNumber ? `TEL ${settings.company.phoneNumber}` : '',
    ]
      .filter((line) => line.trim())
      .forEach((line) => {
        appendEscPosLine(chunks, line)
      })

    appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)
    appendEscPosBold(chunks, true)
    appendEscPosLine(chunks, issueOptions.isReissue ? '領収書（再発行）' : '領収書')
    appendEscPosBold(chunks, false)
    appendEscPosLine(chunks, customerName ? `${customerName} 様` : '________________ 様')
    appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)

    appendEscPosAlign(chunks, 'left')
    appendLabelValueLine(chunks, '発行日', formatCaseDateTime(new Date().toISOString()))
    appendLabelValueLine(chunks, '利用日', formatCaseDateTime(caseRecord.closedAt))
    appendLabelValueLine(chunks, '案件番号', caseRecord.caseNumber)

    appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)
    createThermalReceiptLines(caseRecord, issueOptions.expenseItems).forEach((line) => {
      appendLabelValueLine(chunks, line.label, line.value, line.indent)
    })

    appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)
    appendEscPosBold(chunks, true)
    appendLabelValueLine(chunks, '合計', `${formatFareYen(caseRecord.totalFareYen)}円`)
    appendEscPosBold(chunks, false)
    appendLabelValueLine(chunks, '支払方法', caseRecord.paymentMethod || '未設定')
    paymentLines.forEach((payment) => {
      appendLabelValueLine(chunks, `内訳 ${payment.type}`, `${formatFareYen(payment.amount)}円`, true)
    })

    if (receiptNote) {
      appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)
      appendEscPosBold(chunks, true)
      appendEscPosLine(chunks, '但し書き')
      appendEscPosBold(chunks, false)
      appendEscPosLine(chunks, receiptNote)
    }

    if (invoiceNumber) {
      appendEscPosDivider(chunks, RECEIPT_LINE_WIDTH)
      appendEscPosAlign(chunks, 'center')
      appendEscPosBold(chunks, true)
      appendEscPosLine(chunks, '登録番号')
      appendEscPosBold(chunks, false)
      appendEscPosLine(chunks, invoiceNumber)
      appendEscPosAlign(chunks, 'left')
    }

    if (issuerName) {
      appendEscPosLine(chunks, `発行担当者 ${issuerName}`)
    }

    appendEscPosAlign(chunks, 'center')
    appendEscPosBold(chunks, true)
    appendEscPosLine(chunks, 'ありがとうございました')
    appendEscPosBold(chunks, false)
  })
}
