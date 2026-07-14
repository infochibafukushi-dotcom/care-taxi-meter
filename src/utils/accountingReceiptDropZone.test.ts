import { describe, expect, it, vi } from 'vitest'
import {
  ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_ACTIVE_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_ARIA_LABEL,
  ACCOUNTING_RECEIPT_DROP_ZONE_HINT,
  ACCOUNTING_RECEIPT_DROP_ZONE_TITLE,
  ACCOUNTING_RECEIPT_MULTI_FILE_MESSAGE,
  ACCOUNTING_RECEIPT_READ_FAILED_MESSAGE,
  ACCOUNTING_RECEIPT_REPLACE_CONFIRM_MESSAGE,
  ACCOUNTING_RECEIPT_UNSUPPORTED_DROP_MESSAGE,
  advanceDropZoneDragDepth,
  formatAccountingReceiptFileSize,
  formatAccountingReceiptFileTypeLabel,
  formatAccountingReceiptSelectionSummary,
  hasExistingAccountingReceiptAttachment,
  isDropZoneDragActive,
  preventBrowserFileNavigation,
  resolveAccountingReceiptAttachmentStatus,
  resolvePendingUnorganizedReceiptIdsToDiscard,
  resolveReplacedUnorganizedReceiptIdToDiscard,
  resolveSelectedAccountingReceiptFiles,
  shouldOpenFilePickerFromDropZoneTarget,
  shouldOpenFilePickerFromKeyboard,
  shouldPromptReceiptReplacement,
} from './accountingReceiptDropZone'
import {
  ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE,
  ACCOUNTING_RECEIPT_SUPPORTED_FORMAT_LABEL,
  isAccountingReceiptFileSizeAllowed,
  MAX_ACCOUNTING_RECEIPT_FILE_BYTES,
  validateAccountingReceiptUploadFile,
} from './accountingReceiptFile'
import { getExpenseListActionStatusLabel } from './accountingExpenseListDisplay'
import type { StoredAccountingExpense } from '../types/accounting'

const makeFile = (name: string, type: string, sizeBytes = 100) => {
  const buffer = new Uint8Array(Math.min(sizeBytes, 16))
  const file = new File([buffer], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

describe('accountingReceiptDropZone / resolveSelectedAccountingReceiptFiles', () => {
  it('PDFをドロップすると既存ファイル処理へ渡せる（ok + documentType pdf）', () => {
    const result = resolveSelectedAccountingReceiptFiles([makeFile('a.pdf', 'application/pdf')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.documentType).toBe('pdf')
      expect(result.file.name).toBe('a.pdf')
    }
  })

  it('MIMEが空でも拡張子.pdfで受け付ける', () => {
    const result = resolveSelectedAccountingReceiptFiles([makeFile('invoice.pdf', '')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.documentType).toBe('pdf')
    }
  })

  it('PNGをドロップできる', () => {
    const result = resolveSelectedAccountingReceiptFiles([makeFile('a.png', 'image/png')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.documentType).toBe('image')
    }
  })

  it('JPG／JPEGをドロップできる', () => {
    expect(resolveSelectedAccountingReceiptFiles([makeFile('a.jpg', 'image/jpeg')]).ok).toBe(true)
    expect(resolveSelectedAccountingReceiptFiles([makeFile('a.jpeg', 'image/jpeg')]).ok).toBe(true)
    expect(resolveSelectedAccountingReceiptFiles([makeFile('a.JPG', '')]).ok).toBe(true)
  })

  it('WebPをドロップできる（案内と一致）', () => {
    const result = resolveSelectedAccountingReceiptFiles([makeFile('a.webp', 'image/webp')])
    expect(result.ok).toBe(true)
    expect(ACCOUNTING_RECEIPT_DROP_ZONE_HINT).toContain('WebP')
    expect(ACCOUNTING_RECEIPT_SUPPORTED_FORMAT_LABEL).toContain('WebP')
  })

  it('HEICはプレビュー不可のため拒否する', () => {
    const heic = resolveSelectedAccountingReceiptFiles([makeFile('a.heic', 'image/heic')])
    expect(heic.ok).toBe(false)
    if (!heic.ok) {
      expect(heic.message).toBe(ACCOUNTING_RECEIPT_UNSUPPORTED_DROP_MESSAGE)
    }
    expect(validateAccountingReceiptUploadFile(makeFile('b.heif', 'image/heif')).ok).toBe(false)
  })

  it('非対応形式は拒否され画面向けメッセージになる', () => {
    const gif = resolveSelectedAccountingReceiptFiles([makeFile('a.gif', 'image/gif')])
    expect(gif.ok).toBe(false)
    if (!gif.ok) {
      expect(gif.message).toBe(ACCOUNTING_RECEIPT_UNSUPPORTED_DROP_MESSAGE)
      expect(gif.message).toContain('WebP')
    }
  })

  it('複数ファイルは拒否する（先頭だけ自動選択しない）', () => {
    const result = resolveSelectedAccountingReceiptFiles([
      makeFile('a.pdf', 'application/pdf'),
      makeFile('b.png', 'image/png'),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(ACCOUNTING_RECEIPT_MULTI_FILE_MESSAGE)
    }
  })

  it('10MB未満は許可し、ちょうど10MB以上は拒否する', () => {
    expect(isAccountingReceiptFileSizeAllowed(MAX_ACCOUNTING_RECEIPT_FILE_BYTES - 1)).toBe(true)
    expect(
      resolveSelectedAccountingReceiptFiles([
        makeFile('ok.pdf', 'application/pdf', MAX_ACCOUNTING_RECEIPT_FILE_BYTES - 1),
      ]).ok,
    ).toBe(true)

    expect(isAccountingReceiptFileSizeAllowed(MAX_ACCOUNTING_RECEIPT_FILE_BYTES)).toBe(false)
    const exact = resolveSelectedAccountingReceiptFiles([
      makeFile('exact.pdf', 'application/pdf', MAX_ACCOUNTING_RECEIPT_FILE_BYTES),
    ])
    expect(exact.ok).toBe(false)
    if (!exact.ok) {
      expect(exact.message).toBe(ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE)
      expect(exact.message).toContain('10MB未満')
    }

    expect(isAccountingReceiptFileSizeAllowed(MAX_ACCOUNTING_RECEIPT_FILE_BYTES + 1)).toBe(false)
  })
})

describe('accountingReceiptDropZone / drag depth UI', () => {
  it('ドラッグ中は深度>0で専用表示へ変わる', () => {
    const depth = advanceDropZoneDragDepth(0, 1)
    expect(isDropZoneDragActive(depth)).toBe(true)
    expect(ACCOUNTING_RECEIPT_DROP_ZONE_ACTIVE_LABEL).toBe('ここにドロップしてアップロード')
  })

  it('ドラッグ終了後は通常表示へ戻る', () => {
    let depth = advanceDropZoneDragDepth(0, 1)
    depth = advanceDropZoneDragDepth(depth, -1)
    expect(isDropZoneDragActive(depth)).toBe(false)
    expect(ACCOUNTING_RECEIPT_DROP_ZONE_TITLE).toContain('ドラッグ＆ドロップ')
  })

  it('子要素上の移動で表示がちらつかない（入れ子 enter/leave）', () => {
    let depth = 0
    depth = advanceDropZoneDragDepth(depth, 1)
    depth = advanceDropZoneDragDepth(depth, 1)
    depth = advanceDropZoneDragDepth(depth, -1)
    expect(isDropZoneDragActive(depth)).toBe(true)
    depth = advanceDropZoneDragDepth(depth, -1)
    expect(isDropZoneDragActive(depth)).toBe(false)
  })
})

describe('accountingReceiptDropZone / browser navigation and clicks', () => {
  it('ドロップしてもブラウザがPDFへ遷移しないよう preventDefault する', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    preventBrowserFileNavigation({ preventDefault, stopPropagation })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('ドロップエリアのクリックでファイル選択を開く判定になる', () => {
    const blank = { closest: () => null }
    expect(shouldOpenFilePickerFromDropZoneTarget(blank, blank)).toBe(true)
  })

  it('内部ボタンのクリックでファイル選択が二重に開かない', () => {
    const button = { closest: (selector: string) => (selector.includes('button') ? button : null) }
    expect(shouldOpenFilePickerFromDropZoneTarget(button, { closest: () => null })).toBe(false)
  })

  it('ファイル選択 label クリックでも二重に開かない', () => {
    const label = { closest: (selector: string) => (selector.includes('label') ? label : null) }
    const input = { closest: (selector: string) => (selector.includes('input') ? input : null) }
    expect(shouldOpenFilePickerFromDropZoneTarget(input, { closest: () => null })).toBe(false)
    expect(shouldOpenFilePickerFromDropZoneTarget(label, { closest: () => null })).toBe(false)
  })

  it('Enter／Spaceでファイル選択を開く', () => {
    expect(shouldOpenFilePickerFromKeyboard('Enter')).toBe(true)
    expect(shouldOpenFilePickerFromKeyboard(' ')).toBe(true)
    expect(shouldOpenFilePickerFromKeyboard('Tab')).toBe(false)
  })

  it('aria-label と案内文言が要件どおり', () => {
    expect(ACCOUNTING_RECEIPT_DROP_ZONE_ARIA_LABEL).toBe('領収書の画像またはPDFを選択')
    expect(ACCOUNTING_RECEIPT_DROP_ZONE_HINT).toBe(`対応形式：${ACCOUNTING_RECEIPT_SUPPORTED_FORMAT_LABEL}`)
  })
})

describe('accountingReceiptDropZone / create-edit and replacement', () => {
  it('新規登録・編集の両方で共通 selection が使える', () => {
    const createSelection = resolveSelectedAccountingReceiptFiles([makeFile('n.pdf', 'application/pdf')])
    const editSelection = resolveSelectedAccountingReceiptFiles([makeFile('e.png', 'image/png')])
    expect(createSelection.ok).toBe(true)
    expect(editSelection.ok).toBe(true)
  })

  it('既存証憑があるとき差し替え確認が必要', () => {
    expect(
      shouldPromptReceiptReplacement(
        hasExistingAccountingReceiptAttachment({
          receiptFileUrl: 'https://example.com/a.pdf',
        }),
      ),
    ).toBe(true)
    expect(ACCOUNTING_RECEIPT_REPLACE_CONFIRM_MESSAGE).toContain('差し替え')
  })

  it('差し替えキャンセル相当：既存証憑判定はフォームURLを消さない限り残る', () => {
    const form = {
      receiptId: 'r1',
      receiptFileUrl: 'https://example.com/a.pdf',
      receiptFileName: 'a.pdf',
    }
    expect(hasExistingAccountingReceiptAttachment(form)).toBe(true)
    expect(form.receiptFileUrl).toBe('https://example.com/a.pdf')
  })

  it('読込失敗メッセージは元証憑を維持する趣旨を含む', () => {
    expect(ACCOUNTING_RECEIPT_READ_FAILED_MESSAGE).toContain('元の証憑は変更されていません')
  })

  it('ファイル名・形式・サイズ・状態ラベルを表示できる', () => {
    const file = makeFile('LANinvoice (1).pdf', 'application/pdf', 82 * 1024)
    expect(formatAccountingReceiptFileTypeLabel(file)).toBe('PDF')
    expect(formatAccountingReceiptFileSize(file.size)).toBe('82KB')
    expect(formatAccountingReceiptSelectionSummary(file)).toBe('PDF・82KB')
    expect(ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL.unsaved).toBe('未保存')
    expect(ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL.saved).toBe('保存済み')
  })

  it('ローカル選択直後は未保存、経費に永続化された証憑のみ保存済み', () => {
    expect(
      resolveAccountingReceiptAttachmentStatus({
        isProcessing: false,
        hasError: false,
        hasLocalSelection: true,
        hasPersistedOnExpense: false,
      }),
    ).toBe('unsaved')

    expect(
      resolveAccountingReceiptAttachmentStatus({
        isProcessing: false,
        hasError: false,
        hasLocalSelection: false,
        hasPersistedOnExpense: true,
      }),
    ).toBe('saved')
  })
})

describe('accountingReceiptDropZone / 未確定アップロードの破棄', () => {
  it('差し替え時は直前の未整理IDを破棄対象にし、保護対象は残す', () => {
    expect(
      resolveReplacedUnorganizedReceiptIdToDiscard({
        previousReceiptId: 'temp-1',
        nextReceiptId: 'temp-2',
        protectedReceiptIds: ['linked-old'],
      }),
    ).toBe('temp-1')

    expect(
      resolveReplacedUnorganizedReceiptIdToDiscard({
        previousReceiptId: 'linked-old',
        nextReceiptId: 'temp-2',
        protectedReceiptIds: ['linked-old'],
      }),
    ).toBeNull()
  })

  it('一覧へ戻る／リセット時は未確定のみ破棄し、保護済み証憑は残す', () => {
    expect(
      resolvePendingUnorganizedReceiptIdsToDiscard({
        pendingReceiptIds: ['temp-a', 'temp-b', 'linked-old'],
        protectedReceiptIds: ['linked-old'],
      }),
    ).toEqual(['temp-a', 'temp-b'])
  })
})

describe('accountingReceiptDropZone / 証憑待ち連動（一覧は保存後の expense のみ）', () => {
  const baseExpense = (
    overrides: Partial<
      Pick<
        StoredAccountingExpense,
        | 'confirmationStatus'
        | 'receiptFileUrl'
        | 'receiptPreviewImageUrl'
        | 'receiptImageUrl'
        | 'receiptFileName'
        | 'receiptFileStoragePath'
        | 'receiptPreviewStoragePath'
        | 'receiptStoragePath'
      >
    > = {},
  ) => ({
    confirmationStatus: '未確認' as const,
    receiptFileUrl: '',
    receiptPreviewImageUrl: '',
    receiptImageUrl: '',
    receiptFileName: '',
    ...overrides,
  })

  it('ドロップ後でも経費更新前は一覧の証憑待ちが消えない', () => {
    const listed = baseExpense({})
    expect(getExpenseListActionStatusLabel(listed)).toBe('証憑待ち')
  })

  it('経費更新後に証憑参照が保存されると証憑待ちが消え、未確認なら確認待ちになる', () => {
    const listed = baseExpense({
      receiptFileUrl: 'https://example.com/a.pdf',
      confirmationStatus: '未確認',
    })
    expect(getExpenseListActionStatusLabel(listed)).toBe('確認待ち')
  })

  it('確認済みへ更新後はバッジが消える', () => {
    const listed = baseExpense({
      receiptFileUrl: 'https://example.com/a.pdf',
      confirmationStatus: '確認済み',
    })
    expect(getExpenseListActionStatusLabel(listed)).toBeNull()
  })
})
