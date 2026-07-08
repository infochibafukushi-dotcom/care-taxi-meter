import type { Worker } from 'tesseract.js'
import { createWorker } from 'tesseract.js'
import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import { parseAccountingReceiptOcrText } from '../utils/accountingReceiptOcrParse'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'

type RunAccountingReceiptOcrInput = {
  downloadUrl: string
  receiptId?: string
  fileName?: string
}

let workerPromise: Promise<Worker> | null = null

const getOcrWorker = async () => {
  if (!workerPromise) {
    workerPromise = createWorker('jpn+eng', undefined, {
      logger: () => {},
    })
  }

  return workerPromise
}

const loadReceiptImageBlob = async (downloadUrl: string) => {
  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`証憑画像の取得に失敗しました (${response.status})`)
  }

  return response.blob()
}

/**
 * 領収書 OCR（候補抽出）。
 * ブラウザ内 Tesseract.js で文字認識し、自前パーサーで日付・金額等を候補化します。
 */
export async function runAccountingReceiptOcr(
  input: RunAccountingReceiptOcrInput,
): Promise<AccountingReceiptOcrResult> {
  if (!input.downloadUrl) {
    return {
      status: 'error',
      message: '証憑画像がアップロードされていません。',
      parsed: {},
    }
  }

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
    const [worker, imageBlob] = await Promise.all([
      getOcrWorker(),
      loadReceiptImageBlob(input.downloadUrl),
    ])

    const { data } = await worker.recognize(imageBlob)
    const ocrRawText = data.text?.trim() ?? ''
    const ocrConfidence =
      typeof data.confidence === 'number' && data.confidence > 0 ? data.confidence / 100 : undefined

    if (!ocrRawText) {
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
    const hasParsedCandidate = Boolean(
      parsed.receiptDate ||
        parsed.vendorName ||
        parsed.taxIncludedAmount ||
        parsed.consumptionTaxAmount ||
        parsed.invoiceNumber,
    )

    return {
      status: 'success',
      message: hasParsedCandidate
        ? 'OCR候補を反映しました。日付・金額等を確認してください。'
        : 'テキストは読み取れましたが、日付・金額等を自動判定できませんでした。手入力してください。',
      ocrRawText,
      ocrConfidence,
      parsed,
      suggestedExpenseCategory: '',
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'OCR の実行に失敗しました。',
      parsed: {},
    }
  }
}
