import Encoding from 'encoding-japanese'
import { createTestReceiptCanvas } from './thermalReceiptCanvas'
import { buildEscPosRasterFromCanvas } from './escPosRaster'

const ESC = 0x1b
const FS = 0x1c
const GS = 0x1d
const LF = 0x0a

export type EscPosAlign = 'left' | 'center' | 'right'

/** ESC @ 後に送る日本語向け初期化コマンド（Shift_JIS + 漢字モード） */
export const ESC_POS_JAPANESE_INIT_BYTES = [
  ESC,
  0x40, // ESC @ 初期化
  FS,
  0x43,
  0x01, // FS C 1  Shift_JIS コード体系
  FS,
  0x26, // FS &    漢字モード ON
] as const

const alignBytes: Record<EscPosAlign, number> = {
  center: 0x01,
  left: 0x00,
  right: 0x02,
}

export function encodeEscPosShiftJis(text: string): number[] {
  const converted = Encoding.convert(text, {
    to: 'SJIS',
    from: 'UNICODE',
    type: 'array',
  })

  if (!Array.isArray(converted)) {
    throw new Error('Shift_JIS への変換に失敗しました。')
  }

  return converted
}

export function appendEscPosInit(chunks: number[]) {
  chunks.push(...ESC_POS_JAPANESE_INIT_BYTES)
}

export function appendEscPosAlign(chunks: number[], align: EscPosAlign) {
  chunks.push(ESC, 0x61, alignBytes[align])
}

export function appendEscPosBold(chunks: number[], enabled: boolean) {
  chunks.push(ESC, 0x45, enabled ? 0x01 : 0x00)
}

export function appendEscPosText(chunks: number[], text: string) {
  chunks.push(...encodeEscPosShiftJis(text))
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

/** テスト印刷用 ESC/POS（本番と同じ Canvas→GS v 0 ラスター経路） */
export function buildTestReceiptEscPos(): Uint8Array {
  const canvas = createTestReceiptCanvas()
  return buildEscPosRasterFromCanvas(canvas)
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
