import {
  SUBMISSION_ZIP_CLIENT_LIMITS,
  SUBMISSION_VOUCHER_FETCH_TIMEOUT_MS,
  SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE,
  type SubmissionZipClientLimits,
} from '../constants/accountingSubmissionZipLimits'
import type { AccountingSubmissionPackage } from '../types/accountingSubmissionPackage'
import type {
  SubmissionReceiptBlobLoader,
  SubmissionZipFileEntry,
  SubmissionZipProgress,
  SubmissionZipPublicManifest,
  SubmissionZipPublicManifestItem,
  SubmissionZipResult,
} from '../types/accountingSubmissionZip'
import {
  SubmissionZipCancelledError,
  SubmissionZipFatalError,
} from '../types/accountingSubmissionZip'
import { computeFileSha256 } from '../utils/imageHash'
import { toInternalSubmissionManifest } from '../utils/accountingSubmissionPackage'
import type { SubmissionReportFile } from '../utils/accountingSubmissionZipReports'
import {
  formatVoucherValidationFailureReason,
  validateSubmissionVoucherBytes,
} from '../utils/accountingSubmissionVoucherBytes'

export type GenerateAccountingSubmissionZipInput = {
  packageData: AccountingSubmissionPackage
  reportFiles: SubmissionReportFile[]
  receiptLoader: SubmissionReceiptBlobLoader
  limits?: SubmissionZipClientLimits
  /** Per-voucher getBytes wait (default 60s). Timeout ends the race only — no auto-retry. */
  voucherFetchTimeoutMs?: number
  onProgress?: (progress: SubmissionZipProgress) => void
  signal?: AbortSignal
  /**
   * Always called after voucher fetch settles (success and failure).
   * Must return the final 12_不足証憑一覧.csv text (do not use pre-fetch CSV).
   */
  finalizeMissingVoucherCsv: (
    failures: Array<{ relativePath: string; reason: string }>,
  ) => string
}

const MISSING_LIST_PATH = '12_不足証憑一覧.csv'
const PUBLIC_MANIFEST_PATH = '公開manifest.json'

export class SubmissionVoucherTimeoutError extends Error {
  readonly code = 'voucher.fetch.timeout'

  constructor(timeoutMs: number) {
    super(`証憑取得がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）`)
    this.name = 'SubmissionVoucherTimeoutError'
  }
}

const assertNotAborted = (signal?: AbortSignal, cancelRequested?: boolean) => {
  if (signal?.aborted || cancelRequested) {
    throw new SubmissionZipCancelledError()
  }
}

/** Public ZIP entry basename — safe for UI / CSV (not Storage path / receiptId). */
export const publicVoucherFileName = (relativePath: string): string => {
  const trimmed = relativePath.trim()
  if (!trimmed) {
    return ''
  }
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

export const getVoucherFetchErrorCode = (error: unknown): string | undefined => {
  if (error instanceof SubmissionVoucherTimeoutError) {
    return error.code
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code ?? '').trim()
    return code || undefined
  }
  return undefined
}

/**
 * Hard failures — do not retry.
 * Timeout is never retried (getBytes may still be in flight after race ends).
 */
export const isNonRetryableVoucherFetchError = (error: unknown): boolean => {
  if (error instanceof SubmissionVoucherTimeoutError) {
    return true
  }
  if (error instanceof SubmissionZipCancelledError || error instanceof SubmissionZipFatalError) {
    return true
  }
  const code = getVoucherFetchErrorCode(error)
  if (
    code === 'storage/object-not-found' ||
    code === 'storage/unauthorized' ||
    code === 'permission-denied' ||
    code === 'storage/unauthenticated' ||
    code === 'storage/quota-exceeded' ||
    code === 'storage/invalid-argument' ||
    code === 'storage/invalid-url' ||
    code === 'storage/invalid-root-operation'
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (
    /原本Storageパスがありません|Storageパスがありません|空の証憑|形式|MIME|拡張子|上限/i.test(
      message,
    )
  ) {
    return true
  }
  return false
}

/** Transient Storage / network rejects that may succeed on one retry. */
export const isRetryableVoucherFetchError = (error: unknown): boolean => {
  if (isNonRetryableVoucherFetchError(error)) {
    return false
  }
  const code = getVoucherFetchErrorCode(error)
  if (
    code === 'storage/retry-limit-exceeded' ||
    code === 'storage/server-file-wrong-size'
  ) {
    return true
  }
  if (code?.startsWith('storage/')) {
    // Unknown storage/* — only retry known-transient family above; treat rest as non-retry.
    return false
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (
    /network|Failed to fetch|NetworkError|ERR_NETWORK|ERR_CONNECTION|タイムアウト|timeout|ECONNRESET|ENOTFOUND|fetch failed/i.test(
      message,
    )
  ) {
    return true
  }
  // Explicit reject without Storage hard-code: allow one retry for plain network-ish Errors
  if (error instanceof TypeError && /fetch|network/i.test(message)) {
    return true
  }
  return false
}

/**
 * Race loader against timeout and AbortSignal.
 * Does not cancel the underlying getBytes transfer; abandons the result when race loses.
 */
export function raceVoucherFetchBlob(
  load: () => Promise<Blob>,
  options: {
    signal?: AbortSignal
    timeoutMs: number
  },
): Promise<Blob> {
  const { signal, timeoutMs } = options
  if (signal?.aborted) {
    return Promise.reject(new SubmissionZipCancelledError())
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const settleReject = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const settleResolve = (blob: Blob) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(blob)
    }

    const onAbort = () => {
      settleReject(new SubmissionZipCancelledError())
    }

    signal?.addEventListener('abort', onAbort)
    timer = setTimeout(() => {
      settleReject(new SubmissionVoucherTimeoutError(timeoutMs))
    }, timeoutMs)

    void load().then(settleResolve, settleReject)
  })
}

/**
 * Fetch one voucher with timeout + cancel race, and at most one retry for transient rejects.
 * Timeout never retries.
 */
export async function loadSubmissionVoucherBlobWithPolicy(
  load: () => Promise<Blob>,
  options: {
    signal?: AbortSignal
    timeoutMs: number
    receiptId?: string
    storagePath?: string
  },
): Promise<Blob> {
  const attempt = () =>
    raceVoucherFetchBlob(load, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })

  try {
    return await attempt()
  } catch (error) {
    if (error instanceof SubmissionZipCancelledError || error instanceof SubmissionZipFatalError) {
      throw error
    }
    if (error instanceof SubmissionVoucherTimeoutError || isNonRetryableVoucherFetchError(error)) {
      console.warn('[submission-zip] voucher fetch failed (no retry)', {
        receiptId: options.receiptId,
        storagePath: options.storagePath,
        code: getVoucherFetchErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    if (!isRetryableVoucherFetchError(error)) {
      console.warn('[submission-zip] voucher fetch failed (no retry)', {
        receiptId: options.receiptId,
        storagePath: options.storagePath,
        code: getVoucherFetchErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    console.warn('[submission-zip] voucher fetch transient failure; retrying once', {
      receiptId: options.receiptId,
      storagePath: options.storagePath,
      code: getVoucherFetchErrorCode(error),
      message: error instanceof Error ? error.message : String(error),
    })

    try {
      return await attempt()
    } catch (retryError) {
      console.warn('[submission-zip] voucher fetch failed after retry', {
        receiptId: options.receiptId,
        storagePath: options.storagePath,
        code: getVoucherFetchErrorCode(retryError),
        message: retryError instanceof Error ? retryError.message : String(retryError),
      })
      throw retryError
    }
  }
}

const emit = (
  onProgress: GenerateAccountingSubmissionZipInput['onProgress'],
  progress: SubmissionZipProgress,
) => {
  onProgress?.(progress)
}

export const buildSubmissionZipFileName = (input: {
  targetYear: number
  isSubmissionReady: boolean
}): string => {
  const yearLabel = `${input.targetYear}年度`
  if (input.isSubmissionReady) {
    return `税務確認資料_${yearLabel}.zip`
  }
  return `税務確認資料_${yearLabel}_確認用.zip`
}

/**
 * Single source of truth for ZIP delivery naming + public purpose flags.
 * fileName / isConfirmationZip / purpose must never diverge.
 */
export const resolveSubmissionZipDeliveryNaming = (input: {
  targetYear: number
  packageSubmissionReady: boolean
  fetchFailureCount: number
}): {
  isSubmissionReady: boolean
  isConfirmationZip: boolean
  purpose: 'confirmation' | 'submission'
  fileName: string
} => {
  const isSubmissionReady = input.packageSubmissionReady && input.fetchFailureCount === 0
  const isConfirmationZip = !isSubmissionReady
  const purpose = isConfirmationZip ? 'confirmation' : 'submission'
  const fileName = buildSubmissionZipFileName({
    targetYear: input.targetYear,
    isSubmissionReady,
  })
  const fileNameLooksConfirmation = fileName.includes('確認用')
  if (fileNameLooksConfirmation !== isConfirmationZip || (purpose === 'confirmation') !== isConfirmationZip) {
    throw new SubmissionZipFatalError(
      'naming.mismatch',
      'ZIPファイル名と確認用フラグの整合性が取れていません',
    )
  }
  return { isSubmissionReady, isConfirmationZip, purpose, fileName }
}

/** Prefer result.isConfirmationZip when reconciling a suspicious fileName. */
export const reconcileSubmissionZipDownloadFileName = (input: {
  targetYear: number
  fileName: string
  isConfirmationZip: boolean
}): string => {
  const looksConfirmation = input.fileName.includes('確認用')
  if (looksConfirmation === input.isConfirmationZip) {
    return input.fileName
  }
  return buildSubmissionZipFileName({
    targetYear: input.targetYear,
    isSubmissionReady: !input.isConfirmationZip,
  })
}

export const estimateSubmissionZipFileCount = (pkg: AccountingSubmissionPackage): number => {
  const reportLike = pkg.items.filter(
    (item) =>
      item.type === 'catalog' ||
      item.type === 'report' ||
      item.type === 'missingVoucherList' ||
      item.type === 'unlinkedList',
  ).length
  const vouchers = pkg.items.filter(
    (item) =>
      (item.type === 'voucher' || item.type === 'unlinkedVoucher') &&
      item.availability === 'voucherPendingPhase2B',
  ).length
  return reportLike + vouchers + 1 // + public manifest
}

export const estimateSubmissionZipVoucherCount = (pkg: AccountingSubmissionPackage): number =>
  pkg.items.filter(
    (item) =>
      (item.type === 'voucher' || item.type === 'unlinkedVoucher') &&
      item.availability === 'voucherPendingPhase2B' &&
      Boolean(item.sourceReceiptId),
  ).length

/**
 * Pure ZIP assembly from already-loaded path→Blob map (no Storage I/O).
 */
export async function assembleSubmissionZipBlob(
  files: Map<string, Blob>,
  signal?: AbortSignal,
): Promise<Blob> {
  assertNotAborted(signal)
  if (files.size === 0) {
    throw new SubmissionZipFatalError('empty.zip', 'ZIPに含めるファイルがありません')
  }
  if (files.size > SUBMISSION_ZIP_CLIENT_LIMITS.maxFiles) {
    throw new SubmissionZipFatalError('limits.files', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
  }
  const JSZip = (await import('jszip')).default
  assertNotAborted(signal)
  const zip = new JSZip()
  for (const [relativePath, blob] of files) {
    assertNotAborted(signal)
    if (!relativePath.trim()) {
      throw new SubmissionZipFatalError('path.empty', '相対パスが空のファイルがあります')
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    zip.file(relativePath, bytes)
  }
  try {
    const bytes = await zip.generateAsync({ type: 'uint8array' }, () => {
      if (signal?.aborted) {
        throw new SubmissionZipCancelledError()
      }
    })
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return new Blob([copy.buffer], { type: 'application/zip' })
  } catch (error) {
    if (error instanceof SubmissionZipCancelledError) {
      throw error
    }
    if (signal?.aborted) {
      throw new SubmissionZipCancelledError()
    }
    throw new SubmissionZipFatalError(
      'zip.compress',
      error instanceof Error ? error.message : 'ZIP圧縮に失敗しました',
    )
  }
}

const safeHash = async (blob: Blob, warnings: string[], label: string): Promise<string | undefined> => {
  try {
    return await computeFileSha256(blob)
  } catch {
    warnings.push(`${label}: contentHash の計算に失敗しました`)
    return undefined
  }
}

const assertNoSecretsInPublicText = (text: string, label: string) => {
  if (
    /sourceStoragePath|sourceReceiptId|documentId|firebasestorage\.googleapis\.com|gs:\/\/|token=|\bfirebase\b/i.test(
      text,
    )
  ) {
    throw new SubmissionZipFatalError('manifest.leak', `${label} に内部情報を含められません`)
  }
}

/**
 * Generate confirmation/submission ZIP in the browser.
 * Storage getBytes cannot be aborted mid-download; wait ends via timeout/cancel race.
 */
export async function generateAccountingSubmissionZip(
  input: GenerateAccountingSubmissionZipInput,
): Promise<SubmissionZipResult> {
  const limits = input.limits ?? SUBMISSION_ZIP_CLIENT_LIMITS
  const voucherFetchTimeoutMs = input.voucherFetchTimeoutMs ?? SUBMISSION_VOUCHER_FETCH_TIMEOUT_MS
  const warnings: string[] = []
  const pkg = input.packageData
  const signal = input.signal

  emit(input.onProgress, {
    stage: 'preparing',
    message: '確認用ZIPの準備をしています',
    reportsDone: 0,
    reportsTotal: 0,
    vouchersDone: 0,
    vouchersTotal: 0,
  })

  assertNotAborted(signal)

  if (!pkg.fiscalPeriod) {
    throw new SubmissionZipFatalError('period.unavailable', '会計年度が利用できないためZIPを作成できません')
  }
  if (!pkg.summary.canGenerateZip) {
    throw new SubmissionZipFatalError('package.invalid', 'パッケージ構造が不正なためZIPを作成できません')
  }

  const internal = toInternalSubmissionManifest(pkg)
  const voucherItems = pkg.items.filter(
    (item) =>
      (item.type === 'voucher' || item.type === 'unlinkedVoucher') &&
      item.availability === 'voucherPendingPhase2B' &&
      item.sourceReceiptId &&
      item.relativePath,
  )

  // Drop stale missing-list / public manifest — rebuilt after voucher fetch
  const reportFiles = input.reportFiles.filter(
    (file) => file.relativePath !== MISSING_LIST_PATH && file.relativePath !== PUBLIC_MANIFEST_PATH,
  )

  const estimatedArchiveEntries = reportFiles.length + voucherItems.length + 2 // missing list + manifest
  if (estimatedArchiveEntries > limits.maxFiles) {
    throw new SubmissionZipFatalError('limits.files', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
  }

  const reportBytes = reportFiles.reduce((sum, file) => sum + file.blob.size, 0)
  if (reportBytes > limits.maxTotalEstimatedBytes) {
    throw new SubmissionZipFatalError('limits.total', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
  }

  const files = new Map<string, Blob>()
  const occupied = new Set<string>()
  const reportTotal = reportFiles.length

  emit(input.onProgress, {
    stage: 'generatingReports',
    message: '帳票・CSVを生成しています',
    reportsDone: 0,
    reportsTotal: reportTotal,
    vouchersDone: 0,
    vouchersTotal: voucherItems.length,
  })

  for (let index = 0; index < reportFiles.length; index += 1) {
    assertNotAborted(signal)
    const file = reportFiles[index]
    if (!file.relativePath.trim()) {
      throw new SubmissionZipFatalError('path.empty', '帳票の相対パスが空です')
    }
    if (occupied.has(file.relativePath)) {
      throw new SubmissionZipFatalError('path.collision', `相対パスが重複しています: ${file.relativePath}`)
    }
    if (file.blob.size <= 0 && file.required) {
      throw new SubmissionZipFatalError('report.empty', `必須資料の生成に失敗しました: ${file.relativePath}`)
    }
    if (file.blob.size > limits.maxSingleFileBytes) {
      throw new SubmissionZipFatalError('limits.single', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
    }
    files.set(file.relativePath, file.blob)
    occupied.add(file.relativePath)
    emit(input.onProgress, {
      stage: 'generatingReports',
      message: '帳票・CSVを生成しています',
      reportsDone: index + 1,
      reportsTotal: reportTotal,
      vouchersDone: 0,
      vouchersTotal: voucherItems.length,
    })
  }

  const receiptFetchPlan = new Map<
    string,
    { relativePath: string; sourceStoragePath?: string; sourceMimeType?: string }
  >()
  for (const item of voucherItems) {
    const receiptId = item.sourceReceiptId!
    if (receiptFetchPlan.has(receiptId)) {
      continue
    }
    const internalItem = internal.items.find((row) => row.sourceReceiptId === receiptId)
    receiptFetchPlan.set(receiptId, {
      relativePath: item.relativePath,
      sourceStoragePath: item.sourceStoragePath ?? internalItem?.sourceStoragePath,
      sourceMimeType: item.sourceMimeType ?? internalItem?.sourceMimeType,
    })
  }

  const failedVouchers: Array<{ relativePath: string; reason: string }> = []
  let runningBytes = reportBytes
  let vouchersDone = 0
  const vouchersTotal = receiptFetchPlan.size
  const fetchEntries = [...receiptFetchPlan.entries()]

  emit(input.onProgress, {
    stage: 'fetchingVouchers',
    message:
      vouchersTotal > 0 ? `証憑 1/${vouchersTotal}を取得準備中` : '証憑原本はありません',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone: 0,
    vouchersTotal,
  })

  for (let index = 0; index < fetchEntries.length; index += 1) {
    const [receiptId, plan] = fetchEntries[index]
    const currentVoucherIndex = index + 1
    const currentVoucherFileName = publicVoucherFileName(plan.relativePath)

    // Cancel: do not start the next fetch
    if (signal?.aborted) {
      emit(input.onProgress, {
        stage: 'cancelled',
        message: 'ZIP生成をキャンセルしました',
        reportsDone: reportTotal,
        reportsTotal: reportTotal,
        vouchersDone,
        vouchersTotal,
        currentVoucherIndex,
        currentVoucherFileName,
        cancelRequested: true,
      })
      throw new SubmissionZipCancelledError()
    }

    emit(input.onProgress, {
      stage: 'fetchingVouchers',
      message: `証憑 ${currentVoucherIndex}/${vouchersTotal}を取得中`,
      reportsDone: reportTotal,
      reportsTotal: reportTotal,
      vouchersDone,
      vouchersTotal,
      currentVoucherIndex,
      currentVoucherFileName,
    })

    try {
      if (!plan.sourceStoragePath?.trim()) {
        throw new Error('原本Storageパスがありません')
      }

      const blob = await loadSubmissionVoucherBlobWithPolicy(
        () =>
          input.receiptLoader({
            sourceReceiptId: receiptId,
            sourceStoragePath: plan.sourceStoragePath,
            sourceMimeType: plan.sourceMimeType,
            signal,
          }),
        {
          signal,
          timeoutMs: voucherFetchTimeoutMs,
          receiptId,
          storagePath: plan.sourceStoragePath,
        },
      )

      if (signal?.aborted) {
        throw new SubmissionZipCancelledError()
      }

      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (bytes.byteLength === 0) {
        throw new Error(formatVoucherValidationFailureReason('empty'))
      }
      if (bytes.byteLength > limits.maxSingleFileBytes) {
        throw new SubmissionZipFatalError('limits.single', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
      }
      runningBytes += bytes.byteLength
      if (runningBytes > limits.maxTotalEstimatedBytes) {
        throw new SubmissionZipFatalError('limits.total', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
      }

      const validated = validateSubmissionVoucherBytes({
        bytes,
        relativePath: plan.relativePath,
        declaredMimeType: blob.type || plan.sourceMimeType,
      })
      if (!validated.ok) {
        throw new Error(formatVoucherValidationFailureReason(validated.reasonCode))
      }

      if (files.has(plan.relativePath)) {
        // Same relative path already stored (should be rare after dedupe by receiptId)
      } else if (occupied.has(plan.relativePath)) {
        throw new SubmissionZipFatalError(
          'path.collision',
          `相対パスが重複しています: ${plan.relativePath}`,
        )
      } else {
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        const storeBlob = new Blob([copy.buffer], {
          type:
            validated.kind === 'pdf'
              ? 'application/pdf'
              : validated.kind === 'png'
                ? 'image/png'
                : validated.kind === 'webp'
                  ? 'image/webp'
                  : 'image/jpeg',
        })
        files.set(plan.relativePath, storeBlob)
        occupied.add(plan.relativePath)
      }
    } catch (error) {
      if (error instanceof SubmissionZipFatalError || error instanceof SubmissionZipCancelledError) {
        throw error
      }
      const reason = error instanceof Error ? error.message : '証憑取得に失敗しました'
      failedVouchers.push({ relativePath: plan.relativePath, reason })
      warnings.push(`${publicVoucherFileName(plan.relativePath) || plan.relativePath}: ${reason}`)
    }

    vouchersDone += 1
    emit(input.onProgress, {
      stage: 'fetchingVouchers',
      message:
        vouchersDone < vouchersTotal
          ? `証憑 ${vouchersDone + 1}/${vouchersTotal}を取得準備中`
          : '証憑原本の取得が完了しました',
      reportsDone: reportTotal,
      reportsTotal: reportTotal,
      vouchersDone,
      vouchersTotal,
      cancelRequested: Boolean(signal?.aborted),
    })
  }

  assertNotAborted(signal)

  // --- Final rebuild after fetch results are settled ---
  const missingCsv = input.finalizeMissingVoucherCsv(failedVouchers)
  assertNoSecretsInPublicText(missingCsv, MISSING_LIST_PATH)
  files.set(MISSING_LIST_PATH, new Blob([missingCsv], { type: 'text/csv;charset=utf-8' }))
  occupied.add(MISSING_LIST_PATH)

  const {
    isSubmissionReady,
    isConfirmationZip,
    purpose,
    fileName,
  } = resolveSubmissionZipDeliveryNaming({
    targetYear: pkg.targetYear,
    packageSubmissionReady: Boolean(pkg.summary.isSubmissionReady),
    fetchFailureCount: failedVouchers.length,
  })

  emit(input.onProgress, {
    stage: 'hashing',
    message: 'ハッシュを計算しています',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone,
    vouchersTotal,
  })

  const fileEntries: SubmissionZipFileEntry[] = []
  const failedPathSet = new Set(failedVouchers.map((row) => row.relativePath))

  for (const [relativePath, blob] of files) {
    assertNotAborted(signal)
    const contentHash = await safeHash(blob, warnings, relativePath)
    fileEntries.push({
      relativePath,
      byteSize: blob.size,
      contentHash,
    })
  }

  const manifestItems: SubmissionZipPublicManifestItem[] = []
  for (const item of pkg.items) {
    if (item.type === 'manifest') {
      continue
    }
    const included = files.has(item.relativePath)
    const failed = failedPathSet.has(item.relativePath)
    const entry = fileEntries.find((file) => file.relativePath === item.relativePath)
    const isMissingList = item.relativePath === MISSING_LIST_PATH
    const available = failed ? false : included || isMissingList
    manifestItems.push({
      packageItemId:
        item.expenseTemporaryNo ||
        item.receiptTemporaryNo ||
        (item.temporaryNumbers?.[0] ?? item.id),
      relativePath: item.relativePath,
      format: item.format,
      temporaryNumbers: item.temporaryNumbers,
      availability: failed ? 'failed' : available ? 'included' : item.availability,
      available,
      byteSize: entry?.byteSize,
      contentHash: entry?.contentHash,
    })
  }

  // Ensure voucher failures appear even if item was pending-only
  for (const failure of failedVouchers) {
    if (!manifestItems.some((item) => item.relativePath === failure.relativePath)) {
      manifestItems.push({
        packageItemId: failure.relativePath,
        relativePath: failure.relativePath,
        availability: 'failed',
        available: false,
      })
    } else {
      const row = manifestItems.find((item) => item.relativePath === failure.relativePath)!
      row.available = false
      row.availability = 'failed'
    }
  }

  manifestItems.push({
    packageItemId: 'public-manifest',
    relativePath: PUBLIC_MANIFEST_PATH,
    format: 'json',
    availability: 'included',
    available: true,
  })

  const publicManifest: SubmissionZipPublicManifest = {
    schemaVersion: 'submission.zip.1',
    targetYear: pkg.targetYear,
    fiscalPeriodLabel: pkg.fiscalPeriodLabel,
    createdAt: new Date().toISOString(),
    isConfirmationZip,
    purpose,
    items: manifestItems,
  }

  const manifestJson = JSON.stringify(publicManifest, null, 2)
  assertNoSecretsInPublicText(manifestJson, PUBLIC_MANIFEST_PATH)

  const manifestBlob = new Blob([manifestJson], { type: 'application/json;charset=utf-8' })
  files.set(PUBLIC_MANIFEST_PATH, manifestBlob)
  const manifestHash = await safeHash(manifestBlob, warnings, PUBLIC_MANIFEST_PATH)
  fileEntries.push({
    relativePath: PUBLIC_MANIFEST_PATH,
    byteSize: manifestBlob.size,
    contentHash: manifestHash,
  })
  const manifestSelf = manifestItems.find((item) => item.relativePath === PUBLIC_MANIFEST_PATH)
  if (manifestSelf) {
    manifestSelf.byteSize = manifestBlob.size
  }

  const archiveEntryCount = files.size
  if (archiveEntryCount > limits.maxFiles) {
    throw new SubmissionZipFatalError('limits.files', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
  }
  const totalBytes = [...files.values()].reduce((sum, blob) => sum + blob.size, 0)
  if (totalBytes > limits.maxTotalEstimatedBytes) {
    throw new SubmissionZipFatalError('limits.total', SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
  }

  assertNotAborted(signal)
  emit(input.onProgress, {
    stage: 'compressing',
    message: 'ZIP圧縮を実行しています',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone,
    vouchersTotal,
  })

  const zipBlob = await assembleSubmissionZipBlob(files, signal)
  const zipHash = await safeHash(zipBlob, warnings, 'ZIP')

  emit(input.onProgress, {
    stage: 'downloading',
    message: 'ダウンロードを開始します',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone,
    vouchersTotal,
  })

  return {
    blob: zipBlob,
    fileName,
    fileCount: 1,
    archiveEntryCount,
    byteSize: zipBlob.size,
    contentHash: zipHash,
    files: fileEntries,
    warnings,
    isConfirmationZip,
    isSubmissionReady,
    fetchFailureCount: failedVouchers.length,
  }
}

export function downloadBlobFile(fileName: string, blob: Blob) {
  const typedBlob =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob
      : new Blob([blob], { type: 'application/zip' })
  // Prefer File so browsers that honor File.name align with the intended download name.
  const sourceBlob =
    typeof File !== 'undefined'
      ? new File([typedBlob], fileName, { type: typedBlob.type || 'application/zip' })
      : typedBlob
  const url = URL.createObjectURL(sourceBlob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Default Storage loader. AbortSignal / timeout races are applied by
 * loadSubmissionVoucherBlobWithPolicy in generateAccountingSubmissionZip;
 * getBytes itself cannot be interrupted mid-transfer.
 */
export async function loadSubmissionReceiptBlob(
  input: {
    sourceReceiptId: string
    sourceStoragePath?: string
    sourceMimeType?: string
    signal?: AbortSignal
  },
  deps?: {
    loadBlob?: (args: {
      storagePath?: string
      downloadUrl?: string
      mimeType?: string
    }) => Promise<Blob>
  },
): Promise<Blob> {
  if (input.signal?.aborted) {
    throw new SubmissionZipCancelledError()
  }
  const path = input.sourceStoragePath?.trim()
  if (!path) {
    throw new Error('Storageパスがありません')
  }
  if (deps?.loadBlob) {
    return deps.loadBlob({
      storagePath: path,
      mimeType: input.sourceMimeType,
    })
  }
  const { loadAccountingReceiptImageBlob } = await import('./accountingReceipts')
  return loadAccountingReceiptImageBlob({
    storagePath: path,
    mimeType: input.sourceMimeType,
  })
}
