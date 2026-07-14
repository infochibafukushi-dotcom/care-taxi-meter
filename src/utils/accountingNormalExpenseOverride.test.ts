import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildEmptyExpenseAssetDraft } from '../types/accountingFixedAssets'
import {
  ACCOUNTING_EXPENSE_LIST_SECTION_ID,
  buildAssetDraftForExpenseEdit,
  buildExpenseEditSummary,
  buildNormalExpenseOverrideJudgmentKey,
  buildNormalExpenseOverridePersistFields,
  focusNormalExpenseOverrideField,
  hasUnsavedExpenseEditChanges,
  NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID,
  NORMAL_EXPENSE_OVERRIDE_CREATE_ERROR,
  NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID,
  NORMAL_EXPENSE_OVERRIDE_SECTION_ID,
  NORMAL_EXPENSE_OVERRIDE_UPDATE_ERROR,
  resolveStoredNormalExpenseOverride,
  shouldClearNormalExpenseOverrideConfirmation,
  validateNormalExpenseOverrideForSave,
} from './accountingNormalExpenseOverride'

describe('resolveStoredNormalExpenseOverride', () => {
  it('restores confirmed state and reason for saved normal-expense override', () => {
    expect(
      resolveStoredNormalExpenseOverride({
        normalExpenseOverrideConfirmed: true,
        normalExpenseOverrideReason: '消耗品として一括処理',
      }),
    ).toEqual({
      confirmed: true,
      reason: '消耗品として一括処理',
    })
  })

  it('treats legacy reason-only rows as confirmed', () => {
    expect(
      resolveStoredNormalExpenseOverride({
        normalExpenseOverrideReason: '少額かつ短期使用',
      }),
    ).toEqual({
      confirmed: true,
      reason: '少額かつ短期使用',
    })
  })

  it('keeps override unconfirmed when confirmed flag and reason are both undefined', () => {
    expect(resolveStoredNormalExpenseOverride({})).toEqual({
      confirmed: false,
      reason: '',
    })
  })

  it('restores edit draft from reason-only legacy data when confirmed is undefined', () => {
    const draft = buildAssetDraftForExpenseEdit({
      expense: {
        normalExpenseOverrideReason: '短期消耗のため通常経費',
      },
      amountYen: 120_000,
      description: '消耗品',
      vendorName: '店舗A',
    })

    expect(draft.normalExpenseOverrideConfirmed).toBe(true)
    expect(draft.normalExpenseOverrideReason).toBe('短期消耗のため通常経費')
    expect(draft.normalExpenseOverrideJudgmentKey.length).toBeGreaterThan(0)

    expect(
      validateNormalExpenseOverrideForSave({
        registrationType: 'normal',
        confirmed: draft.normalExpenseOverrideConfirmed,
        reason: draft.normalExpenseOverrideReason,
        confirmedJudgmentKey: draft.normalExpenseOverrideJudgmentKey,
        judgment: {
          shouldWarn: true,
          amountMatch: true,
          keywordMatch: false,
        },
        isEditing: true,
      }),
    ).toEqual({ ok: true })
  })

  it('does not restore confirmation without a reason', () => {
    expect(
      resolveStoredNormalExpenseOverride({
        normalExpenseOverrideConfirmed: true,
        normalExpenseOverrideReason: '   ',
      }),
    ).toEqual({
      confirmed: false,
      reason: '',
    })
  })
})

describe('buildAssetDraftForExpenseEdit', () => {
  it('restores override confirmation and reason into the edit draft', () => {
    const draft = buildAssetDraftForExpenseEdit({
      expense: {
        normalExpenseOverrideConfirmed: true,
        normalExpenseOverrideReason: '事務用品のまとめ買い',
      },
      amountYen: 120_000,
      description: '事務用品',
      vendorName: 'オフィス商事',
    })

    expect(draft.registrationType).toBe('normal')
    expect(draft.normalExpenseOverrideConfirmed).toBe(true)
    expect(draft.normalExpenseOverrideReason).toBe('事務用品のまとめ買い')
    expect(draft.normalExpenseOverrideJudgmentKey).toBe(
      buildNormalExpenseOverrideJudgmentKey({
        shouldWarn: true,
        amountMatch: true,
        keywordMatch: false,
      }),
    )
  })

  it('keeps restored confirmation valid when only non-judgment fields would change later', () => {
    const draft = buildAssetDraftForExpenseEdit({
      expense: {
        normalExpenseOverrideConfirmed: true,
        normalExpenseOverrideReason: '短期消耗',
      },
      amountYen: 150_000,
      description: '備品',
      vendorName: 'A商店',
    })

    const validation = validateNormalExpenseOverrideForSave({
      registrationType: 'normal',
      confirmed: draft.normalExpenseOverrideConfirmed,
      reason: draft.normalExpenseOverrideReason,
      confirmedJudgmentKey: draft.normalExpenseOverrideJudgmentKey,
      judgment: {
        shouldWarn: true,
        amountMatch: true,
        keywordMatch: false,
      },
      isEditing: true,
    })

    expect(validation).toEqual({ ok: true })
  })
})

describe('validateNormalExpenseOverrideForSave', () => {
  it('blocks unconfirmed update with a concrete error and checkbox focus', () => {
    const validation = validateNormalExpenseOverrideForSave({
      registrationType: 'normal',
      confirmed: false,
      reason: '',
      confirmedJudgmentKey: '',
      judgment: {
        shouldWarn: true,
        amountMatch: true,
        keywordMatch: false,
      },
      isEditing: true,
    })

    expect(validation).toEqual({
      ok: false,
      message: NORMAL_EXPENSE_OVERRIDE_UPDATE_ERROR,
      focusTarget: 'checkbox',
    })
  })

  it('blocks create without confirmation using create-specific error', () => {
    const validation = validateNormalExpenseOverrideForSave({
      registrationType: 'normal',
      confirmed: false,
      reason: '',
      confirmedJudgmentKey: '',
      judgment: {
        shouldWarn: true,
        amountMatch: false,
        keywordMatch: true,
      },
      isEditing: false,
    })

    expect(validation).toEqual({
      ok: false,
      message: NORMAL_EXPENSE_OVERRIDE_CREATE_ERROR,
      focusTarget: 'checkbox',
    })
  })

  it('requires reconfirmation when judgment changes', () => {
    const originalKey = buildNormalExpenseOverrideJudgmentKey({
      shouldWarn: true,
      amountMatch: true,
      keywordMatch: false,
    })
    const changedJudgment = {
      shouldWarn: true,
      amountMatch: true,
      keywordMatch: true,
    }

    expect(
      shouldClearNormalExpenseOverrideConfirmation({
        confirmed: true,
        confirmedJudgmentKey: originalKey,
        currentJudgment: changedJudgment,
      }),
    ).toBe(true)

    expect(
      validateNormalExpenseOverrideForSave({
        registrationType: 'normal',
        confirmed: true,
        reason: '旧理由',
        confirmedJudgmentKey: originalKey,
        judgment: changedJudgment,
        isEditing: true,
      }),
    ).toEqual({
      ok: false,
      message: NORMAL_EXPENSE_OVERRIDE_UPDATE_ERROR,
      focusTarget: 'checkbox',
    })
  })

  it('does not require override when warning is not needed', () => {
    expect(
      validateNormalExpenseOverrideForSave({
        registrationType: 'normal',
        confirmed: false,
        reason: '',
        confirmedJudgmentKey: '',
        judgment: {
          shouldWarn: false,
          amountMatch: false,
          keywordMatch: false,
        },
        isEditing: false,
      }),
    ).toEqual({ ok: true })
  })

  it('does not affect small/fixed registration validation path', () => {
    expect(
      validateNormalExpenseOverrideForSave({
        registrationType: 'fixed',
        confirmed: false,
        reason: '',
        confirmedJudgmentKey: '',
        judgment: {
          shouldWarn: true,
          amountMatch: true,
          keywordMatch: true,
        },
        isEditing: true,
      }),
    ).toEqual({ ok: true })

    expect(
      validateNormalExpenseOverrideForSave({
        registrationType: 'small',
        confirmed: false,
        reason: '',
        confirmedJudgmentKey: '',
        judgment: {
          shouldWarn: true,
          amountMatch: true,
          keywordMatch: false,
        },
        isEditing: false,
      }),
    ).toEqual({ ok: true })
  })
})

describe('buildNormalExpenseOverridePersistFields', () => {
  it('persists confirmed flag and reason for normal override', () => {
    expect(
      buildNormalExpenseOverridePersistFields({
        registrationType: 'normal',
        confirmed: true,
        reason: '一括消耗',
        judgment: {
          shouldWarn: true,
          amountMatch: true,
          keywordMatch: false,
        },
      }),
    ).toEqual({
      normalExpenseOverrideConfirmed: true,
      normalExpenseOverrideReason: '一括消耗',
    })
  })

  it('clears override fields when not applicable', () => {
    expect(
      buildNormalExpenseOverridePersistFields({
        registrationType: 'normal',
        confirmed: false,
        reason: 'unused',
        judgment: {
          shouldWarn: true,
          amountMatch: true,
          keywordMatch: false,
        },
      }),
    ).toEqual({
      normalExpenseOverrideConfirmed: false,
      normalExpenseOverrideReason: '',
    })
  })
})

describe('expense edit navigation helpers', () => {
  it('builds editing summary for identification', () => {
    expect(
      buildExpenseEditSummary({
        vendorName: '山田商事',
        description: 'パソコン周辺機器',
        taxIncludedAmount: 110_000,
        receiptDate: '2026-07-01',
      }),
    ).toEqual({
      vendorName: '山田商事',
      description: 'パソコン周辺機器',
      taxIncludedAmount: 110_000,
      receiptDate: '2026-07-01',
    })
  })

  it('detects unsaved changes before returning to the list', () => {
    const originalDraft = buildEmptyExpenseAssetDraft()
    const currentDraft = {
      ...originalDraft,
      normalExpenseOverrideConfirmed: true,
      normalExpenseOverrideReason: '理由',
    }

    expect(
      hasUnsavedExpenseEditChanges({
        originalForm: { receiptDate: '2026-07-01' },
        currentForm: { receiptDate: '2026-07-02' },
        originalDraft,
        currentDraft: originalDraft,
      }),
    ).toBe(true)

    expect(
      hasUnsavedExpenseEditChanges({
        originalForm: { receiptDate: '2026-07-01' },
        currentForm: { receiptDate: '2026-07-01' },
        originalDraft,
        currentDraft,
      }),
    ).toBe(true)

    expect(
      hasUnsavedExpenseEditChanges({
        originalForm: { receiptDate: '2026-07-01' },
        currentForm: { receiptDate: '2026-07-01' },
        originalDraft,
        currentDraft: originalDraft,
      }),
    ).toBe(false)
  })

  it('exposes list section id for return-to-list scrolling', () => {
    expect(ACCOUNTING_EXPENSE_LIST_SECTION_ID).toBe('accounting-expense-list')
  })
})

describe('focusNormalExpenseOverrideField', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('scrolls to the confirmation section and focuses the checkbox', () => {
    const scrollIntoView = vi.fn()
    const focus = vi.fn()
    const section = { scrollIntoView }
    const checkbox = { focus }

    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (id === NORMAL_EXPENSE_OVERRIDE_SECTION_ID) {
          return section
        }
        if (id === NORMAL_EXPENSE_OVERRIDE_CONFIRM_CHECKBOX_ID) {
          return checkbox
        }
        return null
      },
    })

    focusNormalExpenseOverrideField('checkbox')

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(focus).toHaveBeenCalled()
  })

  it('focuses the reason field when reason is missing', () => {
    const focus = vi.fn()
    const reason = { focus }

    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (id === NORMAL_EXPENSE_OVERRIDE_SECTION_ID) {
          return { scrollIntoView: vi.fn() }
        }
        if (id === NORMAL_EXPENSE_OVERRIDE_REASON_FIELD_ID) {
          return reason
        }
        return null
      },
    })

    focusNormalExpenseOverrideField('reason')

    expect(focus).toHaveBeenCalled()
  })
})
