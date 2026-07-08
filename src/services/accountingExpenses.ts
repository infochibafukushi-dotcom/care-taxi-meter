import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
  normalizeExpenseInputForSave,
  normalizeExpensePatchForSave,
  normalizePlTreatment,
} from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { linkAccountingReceiptToExpense } from './accountingReceipts'
import {
  createAccountingTenantConstraints,
  logAccountingQueryFailure,
  resolveAccountingTenantFields,
} from './accountingTenant'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingExpenses'

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
    description: String(data.description ?? ''),
    expenseCategory: (data.expenseCategory as StoredAccountingExpense['expenseCategory']) ?? '',
    taxIncludedAmount: Number(data.taxIncludedAmount ?? 0),
    taxRate: Number(data.taxRate ?? 0),
    consumptionTaxAmount: Number(data.consumptionTaxAmount ?? 0),
    paymentMethod: (data.paymentMethod as StoredAccountingExpense['paymentMethod']) ?? '',
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
    invoiceRegistrant:
      data.invoiceRegistrant && typeof data.invoiceRegistrant === 'object'
        ? (data.invoiceRegistrant as StoredAccountingExpense['invoiceRegistrant'])
        : undefined,
    receiptImageUrl: typeof data.receiptImageUrl === 'string' ? data.receiptImageUrl : '',
    receiptStoragePath: typeof data.receiptStoragePath === 'string' ? data.receiptStoragePath : '',
    receiptId: typeof data.receiptId === 'string' ? data.receiptId : '',
    confirmationStatus: (data.confirmationStatus as ExpenseConfirmationStatus) ?? '未確認',
    memo: typeof data.memo === 'string' ? data.memo : '',
    ocrRawText: typeof data.ocrRawText === 'string' ? data.ocrRawText : '',
    ocrParsedFields:
      data.ocrParsedFields && typeof data.ocrParsedFields === 'object'
        ? (data.ocrParsedFields as StoredAccountingExpense['ocrParsedFields'])
        : undefined,
    ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
    suggestedExpenseCategory:
      (data.suggestedExpenseCategory as StoredAccountingExpense['suggestedExpenseCategory']) ?? '',
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
    description: '',
    expenseCategory: '',
    taxIncludedAmount: 0,
    taxRate: 10,
    consumptionTaxAmount: 0,
    paymentMethod: '',
    invoiceNumber: '',
    invoiceCheckStatus: '未確認',
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
    receiptId: '',
    confirmationStatus: '未確認',
    memo: '',
    ocrRawText: '',
    ocrParsedFields: undefined,
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
