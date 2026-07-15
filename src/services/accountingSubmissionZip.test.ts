import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import type { StoredAccountingReceipt } from './accountingReceipts'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from '../utils/accountingFiscalPeriod'
import { summarizeFilingChecks } from '../utils/accountingFilingCheck'
import {
  buildAccountingSubmissionPackage,
  buildMissingVoucherCsv,
  buildSubmissionCatalogCsv,
} from '../utils/accountingSubmissionPackage'
import {
  assembleSubmissionZipBlob,
  buildSubmissionZipFileName,
  generateAccountingSubmissionZip,
  isNonRetryableVoucherFetchError,
  isRetryableVoucherFetchError,
  loadSubmissionVoucherBlobWithPolicy,
  publicVoucherFileName,
  raceVoucherFetchBlob,
  SubmissionVoucherTimeoutError,
} from './accountingSubmissionZip'
import { SubmissionZipCancelledError, SubmissionZipFatalError } from '../types/accountingSubmissionZip'

const fiscalPeriod = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
const readyFiling = summarizeFilingChecks([])

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const tinyJpeg = new Blob([jpegBytes], { type: 'image/jpeg' })
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const tinyPdf = new Blob([pdfBytes], { type: 'application/pdf' })
const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])

const makeExpense = (
  overrides: Partial<StoredAccountingExpense> & { id: string },
): StoredAccountingExpense =>
  ({
    franchiseeId: 'f1',
    storeId: 's1',
    vendorName: 'テスト商店',
    description: '消耗品',
    expenseCategory: '消耗品費',
    taxIncludedAmount: 1100,
    consumptionTaxAmount: 100,
    taxRate: 10,
    taxCategory: 'taxable',
    paymentMethod: '現金',
    confirmationStatus: '確認済み',
    postingDate: '2026-08-15',
    transactionDate: '2026-08-15',
    receiptDate: '2026-08-15',
    createdBy: 'u1',
    createdByName: 'u1',
    updatedBy: 'u1',
    updatedByName: 'u1',
    plTreatment: 'expense',
    ...overrides,
  }) as StoredAccountingExpense

const makeReceipt = (
  overrides: Partial<StoredAccountingReceipt> & { id: string },
): StoredAccountingReceipt =>
  ({
    id: overrides.id,
    franchiseeId: 'f1',
    storeId: 's1',
    storagePath: 'receipts/a.jpg',
    downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/a.jpg',
    originalStoragePath: 'tenants/f1/receipts/secret.jpg',
    originalDownloadUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/a.jpg?token=abc',
    mimeType: 'image/jpeg',
    fileName: 'a.jpg',
    fileSizeBytes: 10,
    status: 'linked',
    receiptDate: '2026-08-15',
    uploadedBy: 'u1',
    uploadedByName: 'u1',
    ...overrides,
  }) as StoredAccountingReceipt

const buildLinkedPackage = () => {
  const expenseId = 'expense-linked-1'
  const receiptId = 'receipt-linked-1'
  return buildAccountingSubmissionPackage({
    fiscalPeriod,
    expenses: [
      makeExpense({
        id: expenseId,
        receiptId,
        vendorName: '公開店',
        taxIncludedAmount: 3000,
      }),
    ],
    receipts: [
      makeReceipt({
        id: receiptId,
        linkedExpenseId: expenseId,
        originalStoragePath: 'tenants/f1/receipts/secret.jpg',
        vendorNameCandidate: '公開店',
        amountTotalCandidate: 3000,
      }),
    ],
    fixedAssets: [],
    filingSummary: readyFiling,
    targetYear: 2026,
    createdAt: '2026-07-15T00:00:00.000Z',
  })
}

const buildTwoVoucherPackage = () => {
  const receiptA = 'receipt-a'
  const receiptB = 'receipt-b'
  return buildAccountingSubmissionPackage({
    fiscalPeriod,
    expenses: [
      makeExpense({ id: 'e1', receiptId: receiptA, postingDate: '2026-08-10' }),
      makeExpense({ id: 'e2', receiptId: receiptB, postingDate: '2026-08-11' }),
    ],
    receipts: [
      makeReceipt({
        id: receiptA,
        linkedExpenseId: 'e1',
        originalStoragePath: 'receipts/a.jpg',
        receiptDate: '2026-08-10',
      }),
      makeReceipt({
        id: receiptB,
        linkedExpenseId: 'e2',
        originalStoragePath: 'receipts/b.jpg',
        receiptDate: '2026-08-11',
      }),
    ],
    fixedAssets: [],
    filingSummary: readyFiling,
    targetYear: 2026,
    createdAt: '2026-07-15T00:00:00.000Z',
  })
}

const baseReports = (pkg: ReturnType<typeof buildLinkedPackage>) => [
  {
    relativePath: '00_資料一覧.csv',
    blob: new Blob([buildSubmissionCatalogCsv(pkg)], { type: 'text/csv' }),
    required: true as const,
  },
  {
    relativePath: '12_不足証憑一覧.csv',
    blob: new Blob([buildMissingVoucherCsv(pkg)], { type: 'text/csv' }),
    required: true as const,
  },
]

const finalizeMissing = (pkg: ReturnType<typeof buildLinkedPackage>) => {
  return (failures: Array<{ relativePath: string; reason: string }>) => {
    const base = buildMissingVoucherCsv(pkg)
    if (failures.length === 0) {
      return base
    }
    const extra = failures.map((row) => `,,,,,"取得失敗: ${row.reason}",,blocking,証憑取得`).join('\r\n')
    return `${base.replace(/\r?\n$/, '')}\r\n${extra}\r\n`
  }
}

const SECRET_PATTERNS = [
  'sourceReceiptId',
  'sourceStoragePath',
  'documentId',
  'firebasestorage.googleapis.com',
  'gs://',
  'token=',
  'firebase',
  '患者名',
  '利用者名',
  '予約ID',
  'tenants/f1/receipts',
  'receipt-linked-1',
  'expense-linked-1',
]

const assertZipPublicSafe = async (blob: Blob) => {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files)
  expect(names.some((name) => /内部manifest|internal.?manifest/i.test(name))).toBe(false)

  const publicTexts: string[] = [names.join('\n')]
  for (const name of names) {
    if (name.endsWith('/')) {
      continue
    }
    if (
      name.endsWith('.csv') ||
      name.endsWith('.json') ||
      name === '公開manifest.json' ||
      name.includes('資料一覧') ||
      name.includes('不足証憑') ||
      name.includes('未紐付け')
    ) {
      publicTexts.push(await zip.file(name)!.async('string'))
    }
  }
  const combined = publicTexts.join('\n')
  for (const pattern of SECRET_PATTERNS) {
    expect(combined.includes(pattern)).toBe(false)
  }
  return zip
}

const storageError = (code: string, message = code) => {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

describe('buildSubmissionZipFileName', () => {
  it('uses 確認用 when not submission ready', () => {
    expect(buildSubmissionZipFileName({ targetYear: 2026, isSubmissionReady: false })).toContain(
      '確認用',
    )
  })

  it('omits 確認用 when submission ready', () => {
    expect(buildSubmissionZipFileName({ targetYear: 2026, isSubmissionReady: true })).toBe(
      '税務確認資料_2026年度.zip',
    )
  })
})

describe('publicVoucherFileName', () => {
  it('returns basename only', () => {
    expect(publicVoucherFileName('証憑/EXP-000001_RCP-000001_店.jpg')).toBe(
      'EXP-000001_RCP-000001_店.jpg',
    )
  })
})

describe('voucher fetch retry classification', () => {
  it('does not retry timeout / object-not-found / unauthorized', () => {
    expect(isNonRetryableVoucherFetchError(new SubmissionVoucherTimeoutError(60_000))).toBe(true)
    expect(isRetryableVoucherFetchError(new SubmissionVoucherTimeoutError(60_000))).toBe(false)
    expect(isNonRetryableVoucherFetchError(storageError('storage/object-not-found'))).toBe(true)
    expect(isRetryableVoucherFetchError(storageError('storage/object-not-found'))).toBe(false)
    expect(isNonRetryableVoucherFetchError(storageError('storage/unauthorized'))).toBe(true)
    expect(isNonRetryableVoucherFetchError(storageError('permission-denied'))).toBe(true)
  })

  it('retries retry-limit-exceeded and network-style rejects once', () => {
    expect(isRetryableVoucherFetchError(storageError('storage/retry-limit-exceeded'))).toBe(true)
    expect(isRetryableVoucherFetchError(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('raceVoucherFetchBlob / loadSubmissionVoucherBlobWithPolicy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('times out hung load without consuming late resolve', async () => {
    vi.useFakeTimers()
    let resolveLate: ((blob: Blob) => void) | undefined
    const pending = new Promise<Blob>((resolve) => {
      resolveLate = resolve
    })
    const raced = raceVoucherFetchBlob(() => pending, { timeoutMs: 1_000 })
    const expectation = expect(raced).rejects.toBeInstanceOf(SubmissionVoucherTimeoutError)
    await vi.advanceTimersByTimeAsync(1_000)
    await expectation
    resolveLate?.(tinyJpeg)
  })

  it('cancels immediately via AbortSignal', async () => {
    const controller = new AbortController()
    const raced = raceVoucherFetchBlob(() => new Promise(() => {}), {
      signal: controller.signal,
      timeoutMs: 60_000,
    })
    controller.abort()
    await expect(raced).rejects.toBeInstanceOf(SubmissionZipCancelledError)
  })

  it('retries once on retry-limit-exceeded then succeeds', async () => {
    let calls = 0
    const blob = await loadSubmissionVoucherBlobWithPolicy(
      async () => {
        calls += 1
        if (calls === 1) {
          throw storageError('storage/retry-limit-exceeded')
        }
        return tinyJpeg
      },
      { timeoutMs: 5_000 },
    )
    expect(calls).toBe(2)
    expect(blob).toBe(tinyJpeg)
  })

  it('does not retry object-not-found', async () => {
    let calls = 0
    await expect(
      loadSubmissionVoucherBlobWithPolicy(
        async () => {
          calls += 1
          throw storageError('storage/object-not-found')
        },
        { timeoutMs: 5_000 },
      ),
    ).rejects.toMatchObject({ code: 'storage/object-not-found' })
    expect(calls).toBe(1)
  })

  it('does not retry timeout', async () => {
    vi.useFakeTimers()
    let calls = 0
    const promise = loadSubmissionVoucherBlobWithPolicy(
      async () => {
        calls += 1
        return new Promise(() => {})
      },
      { timeoutMs: 2_000 },
    )
    const expectation = expect(promise).rejects.toBeInstanceOf(SubmissionVoucherTimeoutError)
    await vi.advanceTimersByTimeAsync(2_000)
    await expectation
    expect(calls).toBe(1)
  })
})

describe('assembleSubmissionZipBlob', () => {
  it('builds non-empty zip', async () => {
    const files = new Map<string, Blob>([
      ['00_資料一覧.csv', new Blob(['a'], { type: 'text/csv' })],
      ['証憑/RCP-000001.jpg', tinyJpeg],
    ])
    const blob = await assembleSubmissionZipBlob(files)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('rejects empty zip', async () => {
    await expect(assembleSubmissionZipBlob(new Map())).rejects.toBeInstanceOf(SubmissionZipFatalError)
  })
})

describe('generateAccountingSubmissionZip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rebuilds missing CSV and forces confirmation after fetch failure with prior missing 0', async () => {
    const pkg = buildLinkedPackage()
    expect(pkg.summary.missingVoucherCount).toBe(0)
    expect(pkg.summary.isSubmissionReady).toBe(true)

    const result = await generateAccountingSubmissionZip({
      packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true } },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        throw new Error('404')
      },
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })

    expect(result.fileCount).toBe(1)
    expect(result.archiveEntryCount).toBeGreaterThan(1)
    expect(result.isConfirmationZip).toBe(true)
    expect(result.isSubmissionReady).toBe(false)
    expect(result.fileName).toContain('確認用')
    expect(result.fetchFailureCount).toBe(1)
    expect(result.warnings.length).toBe(1)

    const zip = await assertZipPublicSafe(result.blob)
    const missing = await zip.file('12_不足証憑一覧.csv')!.async('string')
    expect(missing).toContain('取得失敗')
    const manifest = JSON.parse(await zip.file('公開manifest.json')!.async('string')) as {
      isConfirmationZip: boolean
      items: Array<{ relativePath: string; available: boolean }>
    }
    expect(manifest.isConfirmationZip).toBe(true)
    const voucherItem = manifest.items.find((item) => item.relativePath.startsWith('証憑/'))
    expect(voucherItem?.available).toBe(false)
  })

  it('includes reports, voucher once, public manifest; omits secrets', async () => {
    const pkg = buildLinkedPackage()
    const voucherPath = pkg.items.find((item) => item.type === 'voucher')?.relativePath
    expect(voucherPath).toBeTruthy()

    const loader = vi.fn(async () => tinyJpeg)
    const result = await generateAccountingSubmissionZip({
      packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true } },
      reportFiles: baseReports(pkg),
      receiptLoader: loader,
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })

    expect(loader).toHaveBeenCalledTimes(1)
    expect(result.fileCount).toBe(1)
    expect(result.isSubmissionReady).toBe(true)
    expect(result.fileName).not.toContain('確認用')

    const zip = await assertZipPublicSafe(result.blob)
    const names = Object.keys(zip.files)
    expect(names).toContain('00_資料一覧.csv')
    expect(names).toContain('12_不足証憑一覧.csv')
    expect(names).toContain('公開manifest.json')
    expect(names).toContain(voucherPath!)
  })

  it('accepts real pdf bytes and rejects disguise', async () => {
    const pkg = buildLinkedPackage()
    const voucher = pkg.items.find((item) => item.type === 'voucher')!
    const reports = baseReports(pkg)
    const pdfPkg = {
      ...pkg,
      summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true },
      items: pkg.items.map((item) =>
        item.id === voucher.id
          ? { ...item, relativePath: item.relativePath.replace(/\.[^.]+$/, '.pdf') }
          : item,
      ),
    }

    const ok = await generateAccountingSubmissionZip({
      packageData: pdfPkg,
      reportFiles: reports,
      receiptLoader: async () => tinyPdf,
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(ok.fetchFailureCount).toBe(0)

    const bad = await generateAccountingSubmissionZip({
      packageData: pdfPkg,
      reportFiles: reports,
      receiptLoader: async () => new Blob([exeBytes], { type: 'application/pdf' }),
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(bad.fetchFailureCount).toBe(1)
    expect(bad.isConfirmationZip).toBe(true)
    expect(bad.warnings.join(' ')).not.toMatch(/4d|5a|MZ/i)
  })

  it('dedupes shared receipt fetch', async () => {
    const receiptId = 'receipt-shared'
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({ id: 'e1', receiptId, postingDate: '2026-08-10', taxIncludedAmount: 1000 }),
        makeExpense({ id: 'e2', receiptId, postingDate: '2026-08-11', taxIncludedAmount: 2000 }),
      ],
      receipts: [
        makeReceipt({
          id: receiptId,
          linkedExpenseId: 'e1',
          originalStoragePath: 'receipts/shared.jpg',
          vendorNameCandidate: '共有',
          amountTotalCandidate: 1500,
        }),
      ],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    const loader = vi.fn(async () => tinyJpeg)
    const result = await generateAccountingSubmissionZip({
      packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true } },
      reportFiles: baseReports(pkg),
      receiptLoader: loader,
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(loader).toHaveBeenCalledTimes(1)
    const zip = await assertZipPublicSafe(result.blob)
    const voucherFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('証憑/') && !name.endsWith('/'),
    )
    expect(voucherFiles).toHaveLength(1)
  })

  it('cancels before start without download payload', async () => {
    const pkg = buildLinkedPackage()
    const controller = new AbortController()
    controller.abort()
    await expect(
      generateAccountingSubmissionZip({
        packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true } },
        reportFiles: baseReports(pkg),
        receiptLoader: async () => tinyJpeg,
        signal: controller.signal,
        finalizeMissingVoucherCsv: finalizeMissing(pkg),
      }),
    ).rejects.toBeInstanceOf(SubmissionZipCancelledError)
  })

  it('cancels between vouchers and does not compress', async () => {
    const pkg = buildTwoVoucherPackage()
    const controller = new AbortController()
    let calls = 0
    await expect(
      generateAccountingSubmissionZip({
        packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true } },
        reportFiles: baseReports(pkg),
        receiptLoader: async () => {
          calls += 1
          if (calls === 1) {
            controller.abort()
            return tinyJpeg
          }
          throw new Error('should not fetch second')
        },
        signal: controller.signal,
        finalizeMissingVoucherCsv: finalizeMissing(pkg),
      }),
    ).rejects.toBeInstanceOf(SubmissionZipCancelledError)
    expect(calls).toBe(1)
  })

  it('cancels hung first voucher without waiting for timeout', async () => {
    const pkg = buildLinkedPackage()
    const controller = new AbortController()
    let fetchStarted: (() => void) | undefined
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    const promise = generateAccountingSubmissionZip({
      packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true } },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        fetchStarted?.()
        return new Promise(() => {})
      },
      signal: controller.signal,
      voucherFetchTimeoutMs: 60_000,
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    await fetchStartedPromise
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(SubmissionZipCancelledError)
  })

  it('times out hung first voucher then continues to second and builds confirmation zip', async () => {
    const pkg = buildTwoVoucherPackage()
    let calls = 0
    const progressMessages: string[] = []
    const result = await generateAccountingSubmissionZip({
      packageData: {
        ...pkg,
        summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true },
      },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        calls += 1
        if (calls === 1) {
          return new Promise(() => {})
        }
        return tinyJpeg
      },
      voucherFetchTimeoutMs: 40,
      onProgress: (progress) => {
        progressMessages.push(progress.message)
        if (progress.currentVoucherFileName) {
          expect(progress.currentVoucherFileName).not.toMatch(/receipts\/|receipt-|tenants\//)
        }
      },
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })

    expect(calls).toBe(2)
    expect(result.fetchFailureCount).toBe(1)
    expect(result.isConfirmationZip).toBe(true)
    expect(result.fileName).toContain('確認用')
    expect(progressMessages.some((message) => /証憑 1\/2を取得中/.test(message))).toBe(true)
    expect(progressMessages.some((message) => /証憑 2\/2を取得中/.test(message))).toBe(true)

    const zip = await assertZipPublicSafe(result.blob)
    const missing = await zip.file('12_不足証憑一覧.csv')!.async('string')
    expect(missing).toContain('タイムアウト')
  }, 10_000)

  it('records object-not-found without retry and continues', async () => {
    const pkg = buildTwoVoucherPackage()
    let calls = 0
    const result = await generateAccountingSubmissionZip({
      packageData: {
        ...pkg,
        summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true },
      },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        calls += 1
        if (calls === 1) {
          throw storageError('storage/object-not-found')
        }
        return tinyJpeg
      },
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(calls).toBe(2)
    expect(result.fetchFailureCount).toBe(1)
    expect(result.isConfirmationZip).toBe(true)
  })

  it('records unauthorized without retry', async () => {
    const pkg = buildLinkedPackage()
    let calls = 0
    const result = await generateAccountingSubmissionZip({
      packageData: {
        ...pkg,
        summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true },
      },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        calls += 1
        throw storageError('storage/unauthorized')
      },
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(calls).toBe(1)
    expect(result.fetchFailureCount).toBe(1)
    expect(result.isConfirmationZip).toBe(true)
  })

  it('retries transient network failure once then succeeds as submission-ready', async () => {
    const pkg = buildLinkedPackage()
    let calls = 0
    const result = await generateAccountingSubmissionZip({
      packageData: {
        ...pkg,
        summary: { ...pkg.summary, canGenerateZip: true, isSubmissionReady: true },
      },
      reportFiles: baseReports(pkg),
      receiptLoader: async () => {
        calls += 1
        if (calls === 1) {
          throw new TypeError('Failed to fetch')
        }
        return tinyJpeg
      },
      finalizeMissingVoucherCsv: finalizeMissing(pkg),
    })
    expect(calls).toBe(2)
    expect(result.fetchFailureCount).toBe(0)
    expect(result.isSubmissionReady).toBe(true)
    expect(result.fileName).not.toContain('確認用')
  })

  it('fails fatally when fiscal period missing', async () => {
    const pkg = buildLinkedPackage()
    await expect(
      generateAccountingSubmissionZip({
        packageData: {
          ...pkg,
          fiscalPeriod: null,
          summary: { ...pkg.summary, canGenerateZip: false },
        },
        reportFiles: [],
        receiptLoader: async () => tinyJpeg,
        finalizeMissingVoucherCsv: () => '\uFEFF\r\n',
      }),
    ).rejects.toBeInstanceOf(SubmissionZipFatalError)
  })

  it('stops when total bytes exceed provisional client limit during fetch', async () => {
    const pkg = buildLinkedPackage()
    const big = new Blob([new Uint8Array([0xff, 0xd8, 0xff, ...new Array(200).fill(1)])], {
      type: 'image/jpeg',
    })
    await expect(
      generateAccountingSubmissionZip({
        packageData: { ...pkg, summary: { ...pkg.summary, canGenerateZip: true } },
        reportFiles: [
          {
            relativePath: '00_資料一覧.csv',
            blob: new Blob(['x'], { type: 'text/csv' }),
            required: true,
          },
        ],
        receiptLoader: async () => big,
        limits: {
          maxFiles: 100,
          maxTotalEstimatedBytes: 50,
          maxSingleFileBytes: 10_000,
        },
        finalizeMissingVoucherCsv: finalizeMissing(pkg),
      }),
    ).rejects.toBeInstanceOf(SubmissionZipFatalError)
  })
})
