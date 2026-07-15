type PdfTableOptions = {
  fileName: string
  title: string
  headers: string[]
  rows: string[][]
  orientation?: 'portrait' | 'landscape'
}

const truncate = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value

type JsPdfInstance = import('jspdf').jsPDF

const buildTablePdfDocument = async ({
  title,
  headers,
  rows,
  orientation = 'landscape',
}: Omit<PdfTableOptions, 'fileName'>): Promise<JsPdfInstance> => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 10
  const headerHeight = 8
  const rowHeight = 6
  const columnCount = headers.length
  const columnWidth = (pageWidth - margin * 2) / columnCount

  let y = margin

  const addPageHeader = () => {
    pdf.setFontSize(13)
    pdf.text(title, margin, y)
    y += 8
    pdf.setFontSize(8)
    headers.forEach((header, index) => {
      pdf.text(truncate(header, 18), margin + index * columnWidth + 1, y)
    })
    y += headerHeight
  }

  addPageHeader()

  rows.forEach((row) => {
    if (y > pageHeight - margin - rowHeight) {
      pdf.addPage()
      y = margin
      addPageHeader()
    }

    row.forEach((cell, index) => {
      pdf.text(truncate(String(cell), 22), margin + index * columnWidth + 1, y)
    })
    y += rowHeight
  })

  return pdf
}

const buildLinePdfDocument = async (title: string, lines: string[]): Promise<JsPdfInstance> => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = 14

  pdf.setFontSize(14)
  pdf.text(title, 14, y)
  y += 8
  pdf.setFontSize(10)

  lines.forEach((line) => {
    if (y > 280) {
      pdf.addPage()
      y = 14
    }
    pdf.text(line, 14, y)
    y += 6
  })

  return pdf
}

const pdfToBlob = (pdf: JsPdfInstance): Blob => {
  const output = pdf.output('blob')
  return output instanceof Blob ? output : new Blob([output], { type: 'application/pdf' })
}

/** ZIP / programmatic use — returns PDF Blob without triggering download. */
export async function buildAuditTablePdfBlob(
  options: Omit<PdfTableOptions, 'fileName'>,
): Promise<Blob> {
  const pdf = await buildTablePdfDocument(options)
  return pdfToBlob(pdf)
}

/** Standalone download — preserves existing behavior. */
export async function downloadAuditTablePdf(options: PdfTableOptions) {
  const pdf = await buildTablePdfDocument(options)
  pdf.save(options.fileName)
}

export async function buildAuditLinePdfBlob(title: string, lines: string[]): Promise<Blob> {
  const pdf = await buildLinePdfDocument(title, lines)
  return pdfToBlob(pdf)
}

export async function downloadAuditLinePdf(fileName: string, title: string, lines: string[]) {
  const pdf = await buildLinePdfDocument(title, lines)
  pdf.save(fileName)
}
