import { createWorker, OEM } from 'tesseract.js'
import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import { parseAccountingReceiptOcrText } from '../utils/accountingReceiptOcrParse'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { loadAccountingReceiptImageBlob } from './accountingReceipts'

const TESSERACT_VERSION = '7.0.0'
const TESSERACT_CORE_VERSION = '5.1.0'
const WORKER_INIT_TIMEOUT_MS = 120_000

export type AccountingReceiptOcrProgressPhase =
  | 'start'
  | 'loading-image'
  | 'preparing-worker'
  | 'recognizing'
  | 'done'

export type AccountingReceiptOcrProgress = {
  phase: AccountingReceiptOcrProgressPhase
  message: string
}

export const ACCOUNTING_OCR_PROGRESS_MESSAGES: Record<AccountingReceiptOcrProgressPhase, string> = {
  start: 'OCR読取を開始しました。',
  'loading-image': '画像を取得しています…',
  'preparing-worker': 'OCRエンジンを準備しています。初回は30秒〜1分ほどかかる場合があります。',
  recognizing: '文字を読み取っています…',
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

const reportProgress = (
  onProgress: RunAccountingReceiptOcrInput['onProgress'],
  phase: AccountingReceiptOcrProgressPhase,
) => {
  onProgress?.({
    phase,
    message: ACCOUNTING_OCR_PROGRESS_MESSAGES[phase],
  })
}

const getTesseractWorkerOptions = (onProgress?: RunAccountingReceiptOcrInput['onProgress']) => ({
  workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_VERSION}/dist/worker.min.js`,
  corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@v${TESSERACT_CORE_VERSION}`,
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data',
  workerBlobURL: false,
  logger: (message: { status?: string; progress?: number }) => {
    if (message.status === 'loading tesseract core' || message.status === 'initializing tesseract') {
      reportProgress(onProgress, 'preparing-worker')
      return
    }

    if (message.status === 'loading language traineddata') {
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
  const worker = await Promise.race([
    createWorker('jpn+eng', OEM.LSTM_ONLY, getTesseractWorkerOptions(onProgress)),
    new Promise<OcrWorker>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('OCRエンジンの準備がタイムアウトしました。通信環境を確認して再試行してください。'))
      }, WORKER_INIT_TIMEOUT_MS)
    }),
  ])

  return worker
}

const getOcrWorker = async (onProgress?: RunAccountingReceiptOcrInput['onProgress']) => {
  if (!workerPromise) {
    reportProgress(onProgress, 'preparing-worker')
    workerPromise = createOcrWorker(onProgress).catch((error) => {
      workerPromise = null
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

  console.info('[Accounting OCR] start', {
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
    reportProgress(input.onProgress, 'start')
    reportProgress(input.onProgress, 'loading-image')

    const imageBlob = await loadAccountingReceiptImageBlob({
      imageBlob: input.imageBlob,
      downloadUrl: input.downloadUrl,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
    })

    console.info('[Accounting OCR] image fetched', {
      size: imageBlob.size,
      type: imageBlob.type,
    })

    const worker = await getOcrWorker(input.onProgress)
    reportProgress(input.onProgress, 'recognizing')

    const { data } = await worker.recognize(imageBlob)
    const ocrRawText = data.text?.trim() ?? ''
    const ocrConfidence =
      typeof data.confidence === 'number' && data.confidence > 0 ? data.confidence / 100 : undefined

    console.info('[Accounting OCR] raw text length', ocrRawText.length)

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

    const parsed = parseAccountingReceiptOcrText(ocrRawText)
    console.info('[Accounting OCR] parsed', parsed)

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
  } catch (error) {
    workerPromise = null
    console.error('[Accounting OCR] failed', error)
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'OCR の実行に失敗しました。',
      parsed: {},
    }
  }
}
