import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingExpenseInput,
  ExpenseConfirmationStatus,
  StoredAccountingExpense,
} from '../types/accounting'
import {
  canConfirmExpense,
  getExpensePostingDate,
  isExpenseCategorySelected,
  normalizeExpenseCategory,
  normalizeExpenseInputForSave,
  normalizeExpensePatchForSave,
  normalizePlTreatment,
} from '../types/accounting'
import {
  normalizeTaxAmount,
  normalizeTaxCalculationMode,
  normalizeTaxRate,
} from '../utils/accountingTax'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { linkAccountingReceiptToExpense } from './accountingReceipts'

const receiptsCollectionName = 'accountingReceipts'
import {
  createAccountingTenantConstraints,
  logAccountingQueryFailure,
  resolveAccountingTenantFields,
} from './accountingTenant'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { computeFileSha256 } from '../utils/imageHash'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingExpenses'

const readTimestampAsIso = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }

  return undefined
}

const toStoredExpense = (snapshot: { id: string; data: () => Record<string, unknown> }): StoredAccountingExpense => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    transactionDate: String(data.transactionDate ?? ''),
    receiptDate: typeof data.receiptDate === 'string' ? data.receiptDate : undefined,
    postingDate: typeof data.postingDate === 'string' ? data.postingDate : undefined,
    plTreatment: normalizePlTreatment(data.plTreatment),
    vendorName: String(data.vendorName ?? ''),
    storeName: typeof data.storeName === 'string' ? data.storeName : '',
    phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : '',
    description: String(data.description ?? ''),
    expenseCategory: normalizeExpenseCategory(data.expenseCategory),
    taxIncludedAmount: Number(data.taxIncludedAmount ?? 0),
    taxRate: Object.prototype.hasOwnProperty.call(data, 'taxRate')
      ? normalizeTaxRate(data.taxRate)
      : null,
    taxAmount:
      normalizeTaxAmount(data.taxAmount) ?? normalizeTaxAmount(data.consumptionTaxAmount),
    consumptionTaxAmount:
      normalizeTaxAmount(data.taxAmount) ?? normalizeTaxAmount(data.consumptionTaxAmount) ?? 0,
    taxExcludedAmount:
      normalizeTaxAmount(data.taxExcludedAmount) ??
      (() => {
        const amount =
          normalizeTaxAmount(data.taxAmount) ?? normalizeTaxAmount(data.consumptionTaxAmount)
        return amount !== null ? Math.max(Number(data.taxIncludedAmount ?? 0) - amount, 0) : null
      })(),
    taxCalculationMode: normalizeTaxCalculationMode(data.taxCalculationMode),
    paymentMethod: (data.paymentMethod as StoredAccountingExpense['paymentMethod']) ?? '',
    lineItems: Array.isArray(data.lineItems)
      ? (data.lineItems as StoredAccountingExpense['lineItems'])
      : [],
    invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : '',
    invoiceCheckStatus:
      typeof data.invoiceCheckStatus === 'string'
        ? (data.invoiceCheckStatus as StoredAccountingExpense['invoiceCheckStatus'])
        : '未確認',
    invoiceRegisteredName: typeof data.invoiceRegisteredName === 'string' ? data.invoiceRegisteredName : '',
    invoiceCheckedAt: typeof data.invoiceCheckedAt === 'string' ? data.invoiceCheckedAt : '',
    invoiceRegisteredNameVerified: data.invoiceRegisteredNameVerified === true,
    invoiceCorporateNumber:
      typeof data.invoiceCorporateNumber === 'string' ? data.invoiceCorporateNumber : '',
    invoiceAddress: typeof data.invoiceAddress === 'string' ? data.invoiceAddress : '',
    invoiceRegistrationStatus:
      typeof data.invoiceRegistrationStatus === 'string' ? data.invoiceRegistrationStatus : '',
    invoiceRegistrationDate:
      typeof data.invoiceRegistrationDate === 'string' ? data.invoiceRegistrationDate : '',
    invoiceTradeName: typeof data.invoiceTradeName === 'string' ? data.invoiceTradeName : '',
    invoiceLookupMethod: typeof data.invoiceLookupMethod === 'string' ? data.invoiceLookupMethod : '',
    taxCategory:
      data.taxCategory === 'non_taxable' || data.taxCategory === 'out_of_scope' || data.taxCategory === 'taxable'
        ? data.taxCategory
        : 'taxable',
    invoiceStatus:
      data.invoiceStatus === 'verified' ||
      data.invoiceStatus === 'none' ||
      data.invoiceStatus === 'not_required' ||
      data.invoiceStatus === 'unknown'
        ? data.invoiceStatus
        : 'unknown',
    invoiceRegistrant:
      data.invoiceRegistrant && typeof data.invoiceRegistrant === 'object'
        ? (data.invoiceRegistrant as StoredAccountingExpense['invoiceRegistrant'])
        : undefined,
    ocrCandidates:
      data.ocrCandidates && typeof data.ocrCandidates === 'object'
        ? (data.ocrCandidates as StoredAccountingExpense['ocrCandidates'])
        : undefined,
    receiptImageUrl: typeof data.receiptImageUrl === 'string' ? data.receiptImageUrl : '',
    receiptStoragePath: typeof data.receiptStoragePath === 'string' ? data.receiptStoragePath : '',
    receiptFileUrl: typeof data.receiptFileUrl === 'string' ? data.receiptFileUrl : '',
    receiptFileStoragePath:
      typeof data.receiptFileStoragePath === 'string' ? data.receiptFileStoragePath : '',
    receiptFileName: typeof data.receiptFileName === 'string' ? data.receiptFileName : '',
    receiptFileMimeType: typeof data.receiptFileMimeType === 'string' ? data.receiptFileMimeType : '',
    receiptPreviewImageUrl:
      typeof data.receiptPreviewImageUrl === 'string' ? data.receiptPreviewImageUrl : '',
    receiptPreviewStoragePath:
      typeof data.receiptPreviewStoragePath === 'string' ? data.receiptPreviewStoragePath : '',
    receiptId: typeof data.receiptId === 'string' ? data.receiptId : '',
    imageHash: typeof data.imageHash === 'string' ? data.imageHash : '',
    confirmationStatus: (data.confirmationStatus as ExpenseConfirmationStatus) ?? '未確認',
    isDeleted: data.isDeleted === true,
    deletedAt: readTimestampAsIso(data.deletedAt),
    deletedBy: typeof data.deletedBy === 'string' ? data.deletedBy : '',
    deleteReason: typeof data.deleteReason === 'string' ? data.deleteReason : '',
    memo: typeof data.memo === 'string' ? data.memo : '',
    ocrRawText: typeof data.ocrRawText === 'string' ? data.ocrRawText : '',
    ocrParsedFields:
      data.ocrParsedFields && typeof data.ocrParsedFields === 'object'
        ? (data.ocrParsedFields as StoredAccountingExpense['ocrParsedFields'])
        : undefined,
    ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
    suggestedExpenseCategory: normalizeExpenseCategory(data.suggestedExpenseCategory),
    normalExpenseOverrideReason:
      typeof data.normalExpenseOverrideReason === 'string'
        ? data.normalExpenseOverrideReason
        : undefined,
    normalExpenseOverrideConfirmed:
      typeof data.normalExpenseOverrideConfirmed === 'boolean'
        ? data.normalExpenseOverrideConfirmed
        : undefined,
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
    updatedByName: String(data.updatedByName ?? ''),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  }
}

export async function fetchAccountingExpenses(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())

  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('transactionDate', 'desc'),
      ),
    )

    return snapshots.docs.map(toStoredExpense).filter((expense) => matchesTenantScope(expense, scope))
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error)
    throw error
  }
}

export async function fetchAccountingExpensesByYearMonth({
  scope,
  targetYearMonth,
}: {
  scope?: TenantAccessScope
  targetYearMonth: string
}) {
  const expenses = await fetchAccountingExpenses(scope)
  return expenses.filter((expense) => getExpensePostingDate(expense).startsWith(targetYearMonth))
}

export async function createAccountingExpense(input: AccountingExpenseInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-expense'
  }

  if (input.confirmationStatus === '確認済み' && !canConfirmExpense(input)) {
    throw new Error('経費科目を選択しないと確認済みにできません。')
  }

  const normalizedInput = normalizeExpenseInputForSave(input)

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(
    collection(db, collectionName),
    removeUndefinedFields({
      ...normalizedInput,
      expenseCategory: isExpenseCategorySelected(normalizedInput.expenseCategory)
        ? normalizedInput.expenseCategory
        : '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  )

  if (normalizedInput.receiptId) {
    await linkAccountingReceiptToExpense({
      receiptId: normalizedInput.receiptId,
      expenseId: document.id,
    })
  }

  return document.id
}

export async function updateAccountingExpense(
  expenseId: string,
  input: Partial<AccountingExpenseInput>,
) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const nextStatus = input.confirmationStatus
  const nextCategory = input.expenseCategory

  if (nextStatus === '確認済み') {
    const category = nextCategory ?? ''
    if (!isExpenseCategorySelected(category)) {
      throw new Error('経費科目を選択しないと確認済みにできません。')
    }
  }

  const normalizedPatch = normalizeExpensePatchForSave(input)

  const db = getFirestore(getFirebaseApp())
  await updateDoc(
    doc(db, collectionName, expenseId),
    removeUndefinedFields({
      ...normalizedPatch,
      updatedAt: serverTimestamp(),
    }),
  )

  if (normalizedPatch.receiptId) {
    await linkAccountingReceiptToExpense({
      receiptId: normalizedPatch.receiptId,
      expenseId,
    })
  }
}

export async function invalidateAccountingExpense({
  expenseId,
  updatedBy,
  updatedByName,
}: {
  expenseId: string
  updatedBy: string
  updatedByName: string
}) {
  await updateAccountingExpense(expenseId, {
    confirmationStatus: '無効',
    updatedBy,
    updatedByName,
  })
}

export async function deleteAccountingExpense(expenseId: string) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await deleteDoc(doc(db, collectionName, expenseId))
}

export async function softDeleteAccountingExpense({
  expenseId,
  deletedBy,
  deletedByName,
  deleteReason,
}: {
  expenseId: string
  deletedBy: string
  deletedByName: string
  deleteReason?: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  const expenseRef = doc(db, collectionName, expenseId)
  const expenseSnap = await getDoc(expenseRef)
  if (!expenseSnap.exists()) {
    return
  }

  const expenseData = expenseSnap.data() as Record<string, unknown>
  const linkedReceiptIds = new Set<string>()
  const receiptId =
    typeof expenseData.receiptId === 'string' ? expenseData.receiptId.trim() : ''
  if (receiptId) {
    linkedReceiptIds.add(receiptId)
  }

  try {
    const linkedReceipts = await getDocs(
      query(collection(db, receiptsCollectionName), where('linkedExpenseId', '==', expenseId)),
    )
    for (const receiptDoc of linkedReceipts.docs) {
      linkedReceiptIds.add(receiptDoc.id)
    }
  } catch {
    // 単一フィールド query が拒否されても expense.receiptId 側は解除する
  }

  const batch = writeBatch(db)
  batch.update(
    expenseRef,
    removeUndefinedFields({
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy,
      deleteReason: deleteReason ?? '',
      receiptId: deleteField(),
      updatedBy: deletedBy,
      updatedByName: deletedByName,
      updatedAt: serverTimestamp(),
    }),
  )

  for (const linkedId of linkedReceiptIds) {
    const receiptRef = doc(db, receiptsCollectionName, linkedId)
    const receiptSnap = await getDoc(receiptRef)
    if (!receiptSnap.exists()) {
      continue
    }
    const receiptData = receiptSnap.data() as Record<string, unknown>
    const hasOcr = Boolean(receiptData.ocrCandidates || receiptData.ocrRawText)
    batch.update(receiptRef, {
      status: 'unorganized',
      receiptStatus: hasOcr ? 'ocr_ready' : 'draft',
      linkedExpenseId: deleteField(),
      updatedAt: serverTimestamp(),
    })
  }

  await batch.commit()
}

export const computeExpenseImageHash = computeFileSha256

export const buildEmptyExpenseInput = ({
  franchiseeId,
  storeId,
  staffId,
  staffName,
}: {
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
}): AccountingExpenseInput => {
  const tenant = resolveAccountingTenantFields({ franchiseeId, storeId })
  const today = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date())

  return {
    ...tenant,
    transactionDate: today,
    receiptDate: today,
    postingDate: today,
    plTreatment: 'expense',
    vendorName: '',
    storeName: '',
    phoneNumber: '',
    description: '',
    expenseCategory: '',
    taxIncludedAmount: 0,
    taxRate: null,
    taxAmount: null,
    consumptionTaxAmount: 0,
    taxExcludedAmount: null,
    taxCalculationMode: 'auto',
    paymentMethod: '',
    invoiceNumber: '',
    invoiceCheckStatus: '未確認',
    invoiceStatus: 'unknown',
    taxCategory: 'taxable',
    invoiceRegisteredName: '',
    invoiceCheckedAt: '',
    invoiceRegisteredNameVerified: false,
    invoiceCorporateNumber: '',
    invoiceAddress: '',
    invoiceRegistrationStatus: '',
    invoiceRegistrationDate: '',
    invoiceTradeName: '',
    invoiceLookupMethod: '',
    invoiceRegistrant: undefined,
    receiptImageUrl: '',
    receiptStoragePath: '',
    receiptFileUrl: '',
    receiptFileStoragePath: '',
    receiptFileName: '',
    receiptFileMimeType: '',
    receiptPreviewImageUrl: '',
    receiptPreviewStoragePath: '',
    receiptId: '',
    lineItems: [],
    confirmationStatus: '未確認',
    memo: '',
    ocrRawText: '',
    ocrParsedFields: undefined,
    ocrCandidates: undefined,
    ocrConfidence: undefined,
    suggestedExpenseCategory: '',
    createdBy: staffId,
    createdByName: staffName,
    updatedBy: staffId,
    updatedByName: staffName,
  }
}

export async function fetchAccountingExpensesForMonthQuery(scope: TenantAccessScope | undefined, targetYearMonth: string) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  const startDate = `${targetYearMonth}-01`
  const endDate = `${targetYearMonth}-99`

  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        where('transactionDate', '>=', startDate),
        where('transactionDate', '<=', endDate),
        orderBy('transactionDate', 'desc'),
      ),
    )

    return snapshots.docs.map(toStoredExpense).filter((expense) => matchesTenantScope(expense, scope))
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error, { targetYearMonth })
    throw error
  }
}
