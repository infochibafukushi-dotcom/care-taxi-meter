import { createWorker, OEM } from 'tesseract.js'
import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import { normalizeAccountingReceiptImage } from '../utils/accountingReceiptImage'
import { parseAccountingReceiptOcrText } from '../utils/accountingReceiptOcrParse'
import {
  getAccountingTesseractPaths,
  logAccountingTesseractPaths,
  verifyAccountingTesseractAssets,
} from '../utils/accountingTesseractPaths'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { loadAccountingReceiptImageBlob } from './accountingReceipts'

export const OCR_TIMEOUT_MS = 30_000
export const OCR_TIMEOUT_MESSAGE =
  'OCR処理がタイムアウトしました。通信環境を確認して再試行してください。'

export type AccountingReceiptOcrProgressPhase =
  | 'start'
  | 'loading-image'
  | 'normalizing-image'
  | 'preparing-worker'
  | 'recognizing'
  | 'parsing'
  | 'done'

export type AccountingReceiptOcrProgress = {
  phase: AccountingReceiptOcrProgressPhase
  message: string
}

export const ACCOUNTING_OCR_PROGRESS_MESSAGES: Record<AccountingReceiptOcrProgressPhase, string> = {
  start: 'OCR読取を開始しました。',
  'loading-image': '画像を取得しています…',
  'normalizing-image': '画像をOCR向けに変換しています…',
  'preparing-worker': 'OCRエンジンを準備しています…',
  recognizing: '文字を読み取っています…',
  parsing: '読み取り結果を解析しています…',
  done: 'OCR読取が完了しました。',
}

type RunAccountingReceiptOcrInput = {
  downloadUrl?: string
  storagePath?: string
  receiptId?: string
  fileName?: string
  mimeType?: string
  imageBlob?: Blob | File | null
  onProgress?: (progress: AccountingReceiptOcrProgress) => void
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>

let workerPromise: Promise<OcrWorker> | null = null
let activeWorker: OcrWorker | null = null

const logOcrStep = (step: string, detail?: Record<string, unknown>) => {
  console.info(`[Accounting OCR] step:${step}`, detail ?? {})
}

const reportProgress = (
  onProgress: RunAccountingReceiptOcrInput['onProgress'],
  phase: AccountingReceiptOcrProgressPhase,
  message?: string,
) => {
  onProgress?.({
    phase,
    message: message ?? ACCOUNTING_OCR_PROGRESS_MESSAGES[phase],
  })
}

const withOcrTimeout = async <T>(promise: Promise<T>, label: string) => {
  let timeoutId = 0

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(OCR_TIMEOUT_MESSAGE))
    }, OCR_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } catch (error) {
    logOcrStep('timeout', { label, timeoutMs: OCR_TIMEOUT_MS })
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const resetAccountingOcrWorker = async () => {
  logOcrStep('worker-reset')
  workerPromise = null

  if (!activeWorker) {
    return
  }

  try {
    await activeWorker.terminate()
  } catch (error) {
    console.warn('[Accounting OCR] worker terminate failed', error)
  } finally {
    activeWorker = null
  }
}

const getTesseractWorkerOptions = (
  paths: ReturnType<typeof getAccountingTesseractPaths>,
  onProgress?: RunAccountingReceiptOcrInput['onProgress'],
) => ({
  workerPath: paths.workerPath,
  corePath: paths.corePath,
  langPath: paths.langPath,
  workerBlobURL: false,
  gzip: true,
  logger: (message: { status?: string; progress?: number }) => {
    logOcrStep('tesseract-logger', {
      status: message.status ?? '',
      progress: message.progress ?? null,
    })

    if (
      message.status === 'loading tesseract core' ||
      message.status === 'initializing tesseract' ||
      message.status === 'loading language traineddata'
    ) {
      reportProgress(onProgress, 'preparing-worker')
      return
    }

    if (message.status === 'recognizing text') {
      reportProgress(onProgress, 'recognizing')
    }
  },
  errorHandler: (error: unknown) => {
    console.error('[Accounting OCR] worker error', error)
  },
})

const createOcrWorker = async (onProgress?: RunAccountingReceiptOcrInput['onProgress']) => {
  const paths = getAccountingTesseractPaths()
  logAccountingTesseractPaths(paths)

  logOcrStep('asset-verify-start', paths)
  await verifyAccountingTesseractAssets(paths)
  logOcrStep('asset-verify-done')

  logOcrStep('worker-create-start', paths)
  reportProgress(onProgress, 'preparing-worker')

  const worker = await createWorker('jpn+eng', OEM.LSTM_ONLY, getTesseractWorkerOptions(paths, onProgress))
  activeWorker = worker
  logOcrStep('worker-create-done')

  return worker
}

const getOcrWorker = async (onProgress?: RunAccountingReceiptOcrInput['onProgress']) => {
  if (!workerPromise) {
    workerPromise = createOcrWorker(onProgress).catch(async (error) => {
      await resetAccountingOcrWorker()
      throw error
    })
  }

  return workerPromise
}

const hasParsedOcrCandidate = (parsed: AccountingReceiptOcrResult['parsed']) =>
  Boolean(
    parsed.receiptDate ||
      parsed.vendorName ||
      parsed.taxIncludedAmount ||
      parsed.consumptionTaxAmount ||
      parsed.invoiceNumber,
  )

const runOcrPipeline = async (input: RunAccountingReceiptOcrInput): Promise<AccountingReceiptOcrResult> => {
  reportProgress(input.onProgress, 'start')

  logOcrStep('blob-load-start', {
    hasBlob: Boolean(input.imageBlob && input.imageBlob.size > 0),
    hasDownloadUrl: Boolean(input.downloadUrl?.trim()),
    hasStoragePath: Boolean(input.storagePath?.trim()),
  })
  reportProgress(input.onProgress, 'loading-image')

  const imageBlob = await loadAccountingReceiptImageBlob({
    imageBlob: input.imageBlob,
    downloadUrl: input.downloadUrl,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
  })
  logOcrStep('blob-load-done', { size: imageBlob.size, type: imageBlob.type })

  reportProgress(input.onProgress, 'normalizing-image')
  logOcrStep('normalize-start', { size: imageBlob.size, type: imageBlob.type })
  const ocrImage = await normalizeAccountingReceiptImage(imageBlob)
  logOcrStep('normalize-done', {
    size: ocrImage.size,
    type: ocrImage.type,
    sizeKb: Math.round(ocrImage.size / 1024),
  })

  logOcrStep('worker-get-start')
  const worker = await getOcrWorker(input.onProgress)
  logOcrStep('worker-get-done')

  reportProgress(input.onProgress, 'recognizing')
  logOcrStep('recognize-start', { size: ocrImage.size, sizeKb: Math.round(ocrImage.size / 1024) })
  const { data } = await worker.recognize(ocrImage)
  logOcrStep('recognize-done', {
    textLength: data.text?.length ?? 0,
    confidence: data.confidence ?? null,
  })

  const ocrRawText = data.text?.trim() ?? ''
  const ocrConfidence =
    typeof data.confidence === 'number' && data.confidence > 0 ? data.confidence / 100 : undefined

  if (!ocrRawText) {
    reportProgress(input.onProgress, 'done')
    return {
      status: 'success',
      message: '文字を読み取れませんでした。手入力で登録できます。',
      ocrRawText: '',
      ocrConfidence: 0,
      parsed: {},
      suggestedExpenseCategory: '',
    }
  }

  reportProgress(input.onProgress, 'parsing')
  logOcrStep('parse-start', { textLength: ocrRawText.length })
  const parsed = parseAccountingReceiptOcrText(ocrRawText)
  logOcrStep('parse-done', parsed)

  reportProgress(input.onProgress, 'done')

  return {
    status: 'success',
    message: hasParsedOcrCandidate(parsed)
      ? 'OCR候補を反映しました。日付・金額等を確認してください。'
      : 'テキストは読み取れましたが、日付・金額等を自動判定できませんでした。手入力してください。',
    ocrRawText,
    ocrConfidence,
    parsed,
    suggestedExpenseCategory: '',
  }
}

/**
 * 領収書 OCR（候補抽出）。
 * ブラウザ内 Tesseract.js で文字認識し、自前パーサーで日付・金額等を候補化します。
 */
export async function runAccountingReceiptOcr(
  input: RunAccountingReceiptOcrInput,
): Promise<AccountingReceiptOcrResult> {
  const hasImageSource = Boolean(
    input.imageBlob || input.downloadUrl?.trim() || input.storagePath?.trim(),
  )

  if (!hasImageSource) {
    return {
      status: 'error',
      message: '証憑画像がアップロードされていません。',
      parsed: {},
    }
  }

  logOcrStep('start', {
    receiptId: input.receiptId ?? '',
    hasDownloadUrl: Boolean(input.downloadUrl?.trim()),
    hasStoragePath: Boolean(input.storagePath?.trim()),
    hasBlob: Boolean(input.imageBlob && input.imageBlob.size > 0),
  })

  if (isReviewDemoRuntimeEnabled()) {
    return {
      status: 'success',
      message: 'レビューデモ用の OCR 候補です。',
      ocrRawText: 'デモ領収書 OCR テキスト',
      ocrConfidence: 0.5,
      parsed: {
        receiptDate: '2025-10-10',
        postingDate: '2026-07-06',
        vendorName: 'デモ仕入先',
        taxIncludedAmount: 1100,
        taxRate: 10,
        consumptionTaxAmount: 100,
        invoiceNumber: 'T1234567890123',
        invoiceRegisteredName: 'デモ登録事業者',
      },
      suggestedExpenseCategory: '',
    }
  }

  try {
    return await withOcrTimeout(runOcrPipeline(input), 'ocr-pipeline')
  } catch (error) {
    await resetAccountingOcrWorker()
    console.error('[Accounting OCR] failed', error)
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'OCR の実行に失敗しました。',
      parsed: {},
    }
  }
}
