import type { AccountingReceiptOcrResult } from '../utils/accountingExpenseForm'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'

type RunAccountingReceiptOcrInput = {
  downloadUrl: string
  receiptId?: string
  fileName?: string
}

const ocrEndpoint = () => (import.meta.env.VITE_ACCOUNTING_OCR_ENDPOINT ?? '').trim()
const ocrApiKey = () => (import.meta.env.VITE_ACCOUNTING_OCR_API_KEY ?? '').trim()

/**
 * 領収書 OCR（候補抽出）。
 *
 * 実 API 接続時の想定:
 * - VITE_ACCOUNTING_OCR_ENDPOINT: HTTPS エンドポイント（Cloud Functions / 外部 OCR API）
 * - VITE_ACCOUNTING_OCR_API_KEY: 任意（Bearer 認証）
 * - リクエスト: POST JSON { imageUrl, receiptId, fileName }
 * - レスポンス: AccountingReceiptOcrResult 互換 JSON
 *
 * 候補 API 例:
 * - Google Cloud Vision API + 自前パーサー（Cloud Functions 経由推奨）
 * - Azure AI Document Intelligence (Form Recognizer)
 * - OpenAI Vision / Gemini（領収書画像 → 構造化 JSON）
 *
 * フロントから直接 Vision API を呼ぶと API キー露出になるため、
 * Cloud Functions 等のバックエンド経由を推奨します。
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
      },
      suggestedExpenseCategory: '',
    }
  }

  const endpoint = ocrEndpoint()
  if (!endpoint) {
    return {
      status: 'not_configured',
      message:
        'OCR API が未設定です。VITE_ACCOUNTING_OCR_ENDPOINT に Cloud Functions 等の OCR エンドポイントを設定してください。',
      parsed: {},
    }
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const apiKey = ocrApiKey()
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imageUrl: input.downloadUrl,
        receiptId: input.receiptId ?? '',
        fileName: input.fileName ?? '',
      }),
    })

    if (!response.ok) {
      return {
        status: 'error',
        message: `OCR API エラー (${response.status})`,
        parsed: {},
      }
    }

    const data = (await response.json()) as Partial<AccountingReceiptOcrResult>
    return {
      status: data.status === 'error' ? 'error' : 'success',
      message: data.message,
      ocrRawText: data.ocrRawText,
      ocrConfidence: data.ocrConfidence,
      parsed: data.parsed ?? {},
      suggestedExpenseCategory: data.suggestedExpenseCategory ?? '',
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'OCR の実行に失敗しました。',
      parsed: {},
    }
  }
}
