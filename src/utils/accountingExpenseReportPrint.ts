/** レポート印刷用のプレーンテキスト整形（改行保持） */
export const normalizeExpenseReportBodyForPrint = (body: string) =>
  body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

export const EXPENSE_REPORT_PRINT_STYLES = `
@page {
  size: A4 portrait;
  margin: 18mm;
}

.expense-report-print-root {
  color: #111;
  font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  font-size: 11pt;
  line-height: 1.6;
}

.expense-report-print-root h1 {
  font-size: 18pt;
  margin: 0 0 12pt;
  font-weight: 700;
}

.expense-report-print-meta {
  margin: 0 0 16pt;
}

.expense-report-print-meta dt {
  font-weight: 600;
  margin-top: 6pt;
}

.expense-report-print-meta dd {
  margin: 0;
}

.expense-report-print-body {
  white-space: pre-wrap;
  margin: 0 0 18pt;
}

.expense-report-print-photos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12pt;
}

.expense-report-print-photo {
  break-inside: avoid;
  page-break-inside: avoid;
  border: 1px solid #ddd;
  padding: 6pt;
}

.expense-report-print-photo img {
  display: block;
  width: 100%;
  max-height: 90mm;
  object-fit: contain;
  background: #f7f7f7;
}

.expense-report-print-caption {
  margin-top: 4pt;
  font-size: 9pt;
  color: #333;
}

@media print {
  body * {
    visibility: hidden;
  }
  .expense-report-print-root,
  .expense-report-print-root * {
    visibility: visible;
  }
  .expense-report-print-root {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .no-print {
    display: none !important;
  }
}
`

export type ExpenseReportPrintModel = {
  documentTitle: string
  title: string
  periodLabel: string
  relatedCategoryLabel: string
  relatedAmountYen: number
  body: string
  photos: Array<{
    src: string
    caption: string
  }>
}
