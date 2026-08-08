import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AccountingReceiptLegalStatus,
  ReceiptCornerDetectConfidence,
  ReceiptCorners,
  ReceiptLegalQualityResult,
  ReceiptPaperSizeSelection,
  ReceiptPaperSizeType,
} from '../types/accountingReceiptLegal'
import { detectReceiptCornersFromCanvas } from '../utils/receiptCornerDetect'
import {
  cloneReceiptCorners,
  createFullImageCorners,
} from '../utils/receiptCorners'
import { loadOrientedReceiptImage } from '../utils/receiptImageOrientation'
import {
  evaluateLegalReceiptQuality,
  resolvePaperSelection,
  suggestPaperSizeFromAspect,
} from '../utils/receiptLegalDpi'
import { createLegalReceiptMaster, detectCanvasIsColor } from '../utils/receiptLegalMaster'
import { applyPerspectiveTransform } from '../utils/receiptPerspective'
import { createReceiptThumbnailWebp } from '../utils/receiptThumbnail'
import { normalizeAccountingReceiptImage } from '../utils/accountingReceiptImage'
import { canDiscardReceiptScanSession } from '../utils/receiptLegalStatus'

export type ReceiptScanStep =
  | 'idle'
  | 'corners'
  | 'quality'
  | 'review'
  | 'saving'
  | 'done'

export type ReceiptScanSessionResult = {
  legalMasterBlob: Blob
  thumbnailBlob: Blob
  ocrBlob: Blob
  fileHash: string
  quality: ReceiptLegalQualityResult
  paper: ReceiptPaperSizeSelection
  widthPx: number
  heightPx: number
  capturedAt: string
  transactionDate: string
  receivedDate: string
  correctedPreviewUrl: string
}

type SessionState = {
  step: ReceiptScanStep
  legalStatus: AccountingReceiptLegalStatus
  sourceFile: File | null
  orientedCanvas: HTMLCanvasElement | null
  corners: ReceiptCorners | null
  detectConfidence: ReceiptCornerDetectConfidence
  detectMessage: string
  correctedCanvas: HTMLCanvasElement | null
  correctedPreviewUrl: string
  quality: ReceiptLegalQualityResult | null
  paper: ReceiptPaperSizeSelection | null
  needsPaperConfirm: boolean
  legalMasterBlob: Blob | null
  thumbnailBlob: Blob | null
  ocrBlob: Blob | null
  errorMessage: string
  busy: boolean
  transactionDate: string
  receivedDate: string
  receivedSameAsTransaction: boolean
  capturedAt: string
}

const initialState = (): SessionState => ({
  step: 'idle',
  legalStatus: 'draft',
  sourceFile: null,
  orientedCanvas: null,
  corners: null,
  detectConfidence: 'failed',
  detectMessage: '',
  correctedCanvas: null,
  correctedPreviewUrl: '',
  quality: null,
  paper: null,
  needsPaperConfirm: false,
  legalMasterBlob: null,
  thumbnailBlob: null,
  ocrBlob: null,
  errorMessage: '',
  busy: false,
  transactionDate: '',
  receivedDate: '',
  receivedSameAsTransaction: true,
  capturedAt: '',
})

const revokeUrl = (url: string) => {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

export function useReceiptScanSession() {
  const [state, setState] = useState<SessionState>(initialState)
  const objectUrlsRef = useRef<string[]>([])
  const stateRef = useRef(state)
  stateRef.current = state

  const trackUrl = useCallback((url: string) => {
    objectUrlsRef.current.push(url)
    return url
  }, [])

  const clearTrackedUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      revokeUrl(url)
    }
    objectUrlsRef.current = []
  }, [])

  const resetSession = useCallback(() => {
    clearTrackedUrls()
    setState(initialState())
  }, [clearTrackedUrls])

  useEffect(
    () => () => {
      clearTrackedUrls()
    },
    [clearTrackedUrls],
  )

  const beginWithFile = useCallback(
    async (file: File) => {
      clearTrackedUrls()
      setState({
        ...initialState(),
        busy: true,
        sourceFile: file,
        capturedAt: new Date().toISOString(),
        legalStatus: 'draft',
        step: 'corners',
      })

      try {
        const oriented = await loadOrientedReceiptImage(file)
        const detected = await detectReceiptCornersFromCanvas(oriented.canvas)
        setState((current) => ({
          ...current,
          busy: false,
          orientedCanvas: oriented.canvas,
          corners: detected.corners,
          detectConfidence: detected.confidence,
          detectMessage: detected.message ?? '',
          errorMessage: '',
          step: 'corners',
          legalStatus: 'draft',
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          busy: false,
          errorMessage:
            error instanceof Error ? error.message : '画像の読み込みに失敗しました。',
          step: 'idle',
        }))
      }
    },
    [clearTrackedUrls],
  )

  const setCorners = useCallback((corners: ReceiptCorners) => {
    setState((current) => ({
      ...current,
      corners: cloneReceiptCorners(corners),
    }))
  }, [])

  const redetectCorners = useCallback(async () => {
    const canvas = stateRef.current.orientedCanvas
    if (!canvas) {
      return
    }
    setState((current) => ({ ...current, busy: true, errorMessage: '' }))
    try {
      const detected = await detectReceiptCornersFromCanvas(canvas)
      setState((current) => ({
        ...current,
        busy: false,
        corners: detected.corners,
        detectConfidence: detected.confidence,
        detectMessage: detected.message ?? '',
      }))
    } catch {
      setState((current) => ({
        ...current,
        busy: false,
        corners: createFullImageCorners(canvas.width, canvas.height),
        detectConfidence: 'failed',
        detectMessage: '範囲を確認してください',
      }))
    }
  }, [])

  const useFullImageCorners = useCallback(() => {
    const canvas = stateRef.current.orientedCanvas
    if (!canvas) {
      return
    }
    setState((current) => ({
      ...current,
      corners: createFullImageCorners(canvas.width, canvas.height),
      detectConfidence: 'failed',
      detectMessage: '画像全体を使用します。範囲を確認してください',
    }))
  }, [])

  const applyCornersAndCheckQuality = useCallback(async () => {
    const { orientedCanvas, corners } = stateRef.current
    if (!orientedCanvas || !corners) {
      return
    }
    setState((current) => ({ ...current, busy: true, errorMessage: '' }))
    try {
      const transformed = applyPerspectiveTransform(orientedCanvas, corners)
      const suggestion = suggestPaperSizeFromAspect(transformed.width, transformed.height)
      const needsPaperConfirm = 'needsUserConfirm' in suggestion && suggestion.needsUserConfirm
      let paper: ReceiptPaperSizeSelection | null = null
      let quality: ReceiptLegalQualityResult | null = null

      if (!needsPaperConfirm && !('needsUserConfirm' in suggestion)) {
        paper = suggestion
        quality = evaluateLegalReceiptQuality({
          widthPx: transformed.width,
          heightPx: transformed.height,
          paper,
          isColor: detectCanvasIsColor(transformed.canvas),
        })
      }

      revokeUrl(stateRef.current.correctedPreviewUrl)
      const previewUrl = trackUrl(URL.createObjectURL(
        await new Promise<Blob>((resolve, reject) => {
          transformed.canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('プレビュー生成に失敗しました。'))),
            'image/jpeg',
            0.85,
          )
        }),
      ))

      setState((current) => ({
        ...current,
        busy: false,
        correctedCanvas: transformed.canvas,
        correctedPreviewUrl: previewUrl,
        paper,
        quality,
        needsPaperConfirm,
        step: 'quality',
        legalStatus: 'draft',
        errorMessage: needsPaperConfirm ? '用紙サイズを確認してください' : '',
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        step: 'corners',
        errorMessage:
          error instanceof Error ? error.message : '台形補正に失敗しました。四隅を修正してください。',
      }))
    }
  }, [trackUrl])

  const selectPaper = useCallback(
    (paperSizeType: ReceiptPaperSizeType, custom?: { widthMm: number; heightMm: number }) => {
      const canvas = stateRef.current.correctedCanvas
      if (!canvas) {
        return
      }
      try {
        const paper = resolvePaperSelection({
          paperSizeType,
          paperWidthMm: custom?.widthMm,
          paperHeightMm: custom?.heightMm,
          widthPx: canvas.width,
          heightPx: canvas.height,
          source: 'user',
        })
        const quality = evaluateLegalReceiptQuality({
          widthPx: canvas.width,
          heightPx: canvas.height,
          paper,
          isColor: detectCanvasIsColor(canvas),
        })
        setState((current) => ({
          ...current,
          paper,
          quality,
          needsPaperConfirm: false,
          errorMessage: quality.ok ? '' : quality.reasons[0] ?? '',
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          errorMessage: error instanceof Error ? error.message : '用紙サイズを確認してください',
        }))
      }
    },
    [],
  )

  const prepareMasterAndOcr = useCallback(async () => {
    const { correctedCanvas, paper, quality } = stateRef.current
    if (!correctedCanvas || !paper || !quality?.ok) {
      setState((current) => ({
        ...current,
        errorMessage: current.quality?.reasons[0] || '画質チェックを完了してください',
      }))
      return null
    }

    setState((current) => ({ ...current, busy: true, errorMessage: '' }))
    try {
      const master = await createLegalReceiptMaster({
        correctedCanvas,
        paper,
      })
      const thumb = await createReceiptThumbnailWebp(correctedCanvas)
      const ocrFile = await normalizeAccountingReceiptImage(master.masterBlob)

      setState((current) => ({
        ...current,
        busy: false,
        legalMasterBlob: master.masterBlob,
        thumbnailBlob: thumb.blob,
        ocrBlob: ocrFile,
        quality: {
          ...quality,
          widthPx: master.widthPx,
          heightPx: master.heightPx,
          estimatedDpi: master.estimatedDpi,
        },
        step: 'review',
        legalStatus: 'image_review',
      }))

      return {
        legalMasterBlob: master.masterBlob,
        thumbnailBlob: thumb.blob,
        ocrBlob: ocrFile as Blob,
        widthPx: master.widthPx,
        heightPx: master.heightPx,
        estimatedDpi: master.estimatedDpi,
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        errorMessage:
          error instanceof Error ? error.message : '正式保存候補画像の生成に失敗しました。',
      }))
      return null
    }
  }, [])

  const setDates = useCallback(
    (patch: {
      transactionDate?: string
      receivedDate?: string
      receivedSameAsTransaction?: boolean
    }) => {
      setState((current) => {
        const receivedSameAsTransaction =
          patch.receivedSameAsTransaction ?? current.receivedSameAsTransaction
        const transactionDate = patch.transactionDate ?? current.transactionDate
        const receivedDate = receivedSameAsTransaction
          ? transactionDate
          : (patch.receivedDate ?? current.receivedDate)
        return {
          ...current,
          transactionDate,
          receivedDate,
          receivedSameAsTransaction,
        }
      })
    },
    [],
  )

  const markSaving = useCallback(() => {
    setState((current) => ({ ...current, busy: true, step: 'saving' }))
  }, [])

  const markDone = useCallback(() => {
    setState((current) => ({
      ...current,
      busy: false,
      step: 'done',
      legalStatus: 'legal_pending_timestamp',
    }))
  }, [])

  const markSaveFailed = useCallback((message: string) => {
    setState((current) => ({
      ...current,
      busy: false,
      step: 'review',
      legalStatus: 'image_review',
      errorMessage: message,
    }))
  }, [])

  const backToCorners = useCallback(() => {
    setState((current) => ({
      ...current,
      step: 'corners',
      legalStatus: 'draft',
      errorMessage: '',
    }))
  }, [])

  const canDiscard = canDiscardReceiptScanSession(state.legalStatus)

  return {
    ...state,
    canDiscard,
    beginWithFile,
    resetSession,
    setCorners,
    redetectCorners,
    useFullImageCorners,
    applyCornersAndCheckQuality,
    selectPaper,
    prepareMasterAndOcr,
    setDates,
    markSaving,
    markDone,
    markSaveFailed,
    backToCorners,
  }
}

export type UseReceiptScanSessionReturn = ReturnType<typeof useReceiptScanSession>
