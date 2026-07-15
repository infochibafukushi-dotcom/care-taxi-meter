import {
  SUBMISSION_ZIP_CLIENT_LIMITS,
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

const assertNotAborted = (signal?: AbortSignal, cancelRequested?: boolean) => {
  if (signal?.aborted || cancelRequested) {
    throw new SubmissionZipCancelledError()
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
 * Storage getBytes is cooperative-cancel only (cannot abort mid-download).
 */
export async function generateAccountingSubmissionZip(
  input: GenerateAccountingSubmissionZipInput,
): Promise<SubmissionZipResult> {
  const limits = input.limits ?? SUBMISSION_ZIP_CLIENT_LIMITS
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

  emit(input.onProgress, {
    stage: 'fetchingVouchers',
    message: '証憑原本を取得しています',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone: 0,
    vouchersTotal: receiptFetchPlan.size,
  })

  for (const [receiptId, plan] of receiptFetchPlan) {
    // Cooperative cancel: do not start the next fetch
    if (signal?.aborted) {
      emit(input.onProgress, {
        stage: 'fetchingVouchers',
        message: 'キャンセル処理中です。現在のファイル取得が完了すると停止します。',
        reportsDone: reportTotal,
        reportsTotal: reportTotal,
        vouchersDone,
        vouchersTotal: receiptFetchPlan.size,
        cancelRequested: true,
      })
      throw new SubmissionZipCancelledError()
    }

    try {
      if (!plan.sourceStoragePath?.trim()) {
        throw new Error('原本Storageパスがありません')
      }

      // getBytes cannot be aborted mid-flight — wait, then stop before using the result
      const blob = await input.receiptLoader({
        sourceReceiptId: receiptId,
        sourceStoragePath: plan.sourceStoragePath,
        sourceMimeType: plan.sourceMimeType,
        signal,
      })

      if (signal?.aborted) {
        emit(input.onProgress, {
          stage: 'cancelled',
          message: 'キャンセル処理中です。現在のファイル取得が完了すると停止します。',
          reportsDone: reportTotal,
          reportsTotal: reportTotal,
          vouchersDone,
          vouchersTotal: receiptFetchPlan.size,
          cancelRequested: true,
        })
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
        vouchersDone += 1
        continue
      }
      if (occupied.has(plan.relativePath)) {
        throw new SubmissionZipFatalError(
          'path.collision',
          `相対パスが重複しています: ${plan.relativePath}`,
        )
      }

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
    } catch (error) {
      if (error instanceof SubmissionZipFatalError || error instanceof SubmissionZipCancelledError) {
        throw error
      }
      const reason = error instanceof Error ? error.message : '証憑取得に失敗しました'
      failedVouchers.push({ relativePath: plan.relativePath, reason })
      warnings.push(`${plan.relativePath}: ${reason}`)
    }

    vouchersDone += 1
    emit(input.onProgress, {
      stage: 'fetchingVouchers',
      message: signal?.aborted
        ? 'キャンセル処理中です。現在のファイル取得が完了すると停止します。'
        : '証憑原本を取得しています',
      reportsDone: reportTotal,
      reportsTotal: reportTotal,
      vouchersDone,
      vouchersTotal: receiptFetchPlan.size,
      cancelRequested: Boolean(signal?.aborted),
    })
  }

  assertNotAborted(signal)

  // --- Final rebuild after fetch results are settled ---
  const missingCsv = input.finalizeMissingVoucherCsv(failedVouchers)
  assertNoSecretsInPublicText(missingCsv, MISSING_LIST_PATH)
  files.set(MISSING_LIST_PATH, new Blob([missingCsv], { type: 'text/csv;charset=utf-8' }))
  occupied.add(MISSING_LIST_PATH)

  const isSubmissionReady = pkg.summary.isSubmissionReady && failedVouchers.length === 0
  const isConfirmationZip = !isSubmissionReady
  const fileName = buildSubmissionZipFileName({
    targetYear: pkg.targetYear,
    isSubmissionReady,
  })

  emit(input.onProgress, {
    stage: 'hashing',
    message: 'ハッシュを計算しています',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone,
    vouchersTotal: receiptFetchPlan.size,
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
    purpose: isConfirmationZip ? 'confirmation' : 'submission',
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
    vouchersTotal: receiptFetchPlan.size,
  })

  const zipBlob = await assembleSubmissionZipBlob(files, signal)
  const zipHash = await safeHash(zipBlob, warnings, 'ZIP')

  emit(input.onProgress, {
    stage: 'downloading',
    message: 'ダウンロードを開始します',
    reportsDone: reportTotal,
    reportsTotal: reportTotal,
    vouchersDone,
    vouchersTotal: receiptFetchPlan.size,
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
  const sourceBlob =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob
      : new Blob([blob], { type: 'application/zip' })
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
 * Default Storage loader. AbortSignal cannot interrupt Firebase getBytes mid-transfer;
 * cooperative cancel is enforced by the generate loop between files.
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
