const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const textEncoder = new TextEncoder()

export type EscPosAlign = 'left' | 'center' | 'right'

const alignBytes: Record<EscPosAlign, number> = {
  center: 0x01,
  left: 0x00,
  right: 0x02,
}

export function appendEscPosInit(chunks: number[]) {
  chunks.push(ESC, 0x40)
}

export function appendEscPosAlign(chunks: number[], align: EscPosAlign) {
  chunks.push(ESC, 0x61, alignBytes[align])
}

export function appendEscPosBold(chunks: number[], enabled: boolean) {
  chunks.push(ESC, 0x45, enabled ? 0x01 : 0x00)
}

export function appendEscPosText(chunks: number[], text: string) {
  chunks.push(...textEncoder.encode(text))
}

export function appendEscPosLine(chunks: number[], text: string) {
  appendEscPosText(chunks, text)
  chunks.push(LF)
}

export function appendEscPosDivider(chunks: number[], width = 32) {
  appendEscPosLine(chunks, '-'.repeat(width))
}

export function appendEscPosFeedAndCut(chunks: number[], feedLines = 3) {
  for (let index = 0; index < feedLines; index += 1) {
    chunks.push(LF)
  }

  chunks.push(GS, 0x56, 0x00)
}

export function buildEscPosDocument(buildContent: (chunks: number[]) => void): Uint8Array {
  const chunks: number[] = []
  appendEscPosInit(chunks)
  buildContent(chunks)
  appendEscPosFeedAndCut(chunks)
  return Uint8Array.from(chunks)
}

/** テスト印刷用の最小 ESC/POS バイト列（58mm/80mm 共通の基本コマンド） */
export function buildTestReceiptEscPos(options: {
  title?: string
  lines?: string[]
} = {}): Uint8Array {
  const title = options.title ?? '介護タクシー メーター'
  const lines = options.lines ?? [
    'Bluetooth プリンター接続テスト',
    new Date().toLocaleString('ja-JP'),
    '----------------',
    'ESC/POS 印字 OK',
  ]

  return buildEscPosDocument((chunks) => {
    appendEscPosAlign(chunks, 'center')
    appendEscPosLine(chunks, title)
    appendEscPosAlign(chunks, 'left')

    for (const line of lines) {
      appendEscPosLine(chunks, line)
    }
  })
}

/** BLE の MTU 制限を考慮してチャンク分割（512 バイトが一般的な上限） */
export async function writeEscPosInChunks(
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  data: Uint8Array,
  chunkSize = 512,
): Promise<void> {
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length))
    await writeChunk(chunk)
  }
}
