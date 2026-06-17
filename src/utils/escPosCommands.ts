const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const textEncoder = new TextEncoder()

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

  const chunks: number[] = [
    ESC,
    0x40, // Initialize printer
    ESC,
    0x61,
    0x01, // Center align
    ...textEncoder.encode(`${title}\n`),
    ESC,
    0x61,
    0x00, // Left align
  ]

  for (const line of lines) {
    chunks.push(...textEncoder.encode(`${line}\n`))
  }

  chunks.push(
    LF,
    LF,
    LF,
    GS,
    0x56,
    0x00, // Partial cut (機種により無視される)
  )

  return Uint8Array.from(chunks)
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
