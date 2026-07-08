/**
 * 管理会計PL用 科目マスタ
 *
 * 入力時は科目名のみ保存し、PL集計時に category で
 * 売上 / 売上原価 / 固定費 / 変動費 へ自動振り分けする。
 * scope（加盟店・店舗・車両・担当者）でも同じ定義を再利用できるよう、
 * マスタと集計ロジックをデータソースから分離している。
 */

export const ACCOUNT_PL_CATEGORIES = [
  'sales',
  'costOfSales',
  'fixedExpense',
  'variableExpense',
] as const

export type AccountPlCategory = (typeof ACCOUNT_PL_CATEGORIES)[number]

export const ACCOUNT_PL_CATEGORY_LABELS: Record<AccountPlCategory, string> = {
  sales: '売上',
  costOfSales: '売上原価',
  fixedExpense: '固定費',
  variableExpense: '変動費',
}

export const SALES_CATEGORIES = [
  '運賃収入',
  '介助料収入',
  '機材利用料収入',
  'ストック',
  'その他売上',
] as const

export type SalesCategory = (typeof SALES_CATEGORIES)[number]

export const COST_OF_SALES_CATEGORIES = [
  '外注費',
  '外部機材レンタル費',
  '販売用消耗品仕入',
] as const

export const FIXED_EXPENSE_CATEGORIES = [
  '役員報酬',
  '給与手当',
  '法定福利費',
  '福利厚生費',
  '生命保険・医療保険料',
  '研修費',
  '車両保険・任意保険',
  '駐車場代（固定契約）',
  '通信費',
  'システム利用料',
  '会計ソフト費',
  '税理士報酬',
  'Web広告固定費・掲載料',
  'ホームページ維持費',
  '地代家賃',
  'リース料',
  '減価償却費',
  '車検・法定点検費',
  '自動車税・重量税',
  '租税公課',
  '支払利息',
  '事務用品・雑費',
  // 繰延資産候補（PL利益計算外。科目選択・互換用）
  '開業前立替金・繰延資産候補',
  '開業費償却',
  '創立費償却',
] as const

export const VARIABLE_EXPENSE_CATEGORIES = [
  '燃料費',
  '高速代・駐車場代',
  '洗車費',
  '車両修繕費',
  'オイル・タイヤ費',
  '決済手数料',
  'LINE・SMS送信費',
  '消耗品費',
  '介助用品消耗品',
  '広告宣伝費',
  '販促品費',
  '紹介手数料',
  '接待交際費',
  '会議費',
  '旅費交通費',
] as const

export const EXPENSE_CATEGORIES = [
  ...COST_OF_SALES_CATEGORIES,
  ...FIXED_EXPENSE_CATEGORIES,
  ...VARIABLE_EXPENSE_CATEGORIES,
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type CostOfSalesCategory = (typeof COST_OF_SALES_CATEGORIES)[number]
export type FixedExpenseCategory = (typeof FIXED_EXPENSE_CATEGORIES)[number]
export type VariableExpenseCategory = (typeof VARIABLE_EXPENSE_CATEGORIES)[number]

type CategoryDefinition = {
  name: string
  category: AccountPlCategory
}

const SALES_DEFINITIONS: readonly CategoryDefinition[] = SALES_CATEGORIES.map((name) => ({
  name,
  category: 'sales' as const,
}))

const COST_OF_SALES_DEFINITIONS: readonly CategoryDefinition[] = COST_OF_SALES_CATEGORIES.map((name) => ({
  name,
  category: 'costOfSales' as const,
}))

const FIXED_EXPENSE_DEFINITIONS: readonly CategoryDefinition[] = FIXED_EXPENSE_CATEGORIES.map((name) => ({
  name,
  category: 'fixedExpense' as const,
}))

const VARIABLE_EXPENSE_DEFINITIONS: readonly CategoryDefinition[] = VARIABLE_EXPENSE_CATEGORIES.map(
  (name) => ({
    name,
    category: 'variableExpense' as const,
  }),
)

/** 全科目マスタ（売上含む）。将来の店舗別・車両別PLでも同じ定義を参照する */
export const ACCOUNT_CATEGORY_MASTER: readonly CategoryDefinition[] = [
  ...SALES_DEFINITIONS,
  ...COST_OF_SALES_DEFINITIONS,
  ...FIXED_EXPENSE_DEFINITIONS,
  ...VARIABLE_EXPENSE_DEFINITIONS,
]

const PL_CATEGORY_BY_NAME = ACCOUNT_CATEGORY_MASTER.reduce(
  (map, definition) => {
    map[definition.name] = definition.category
    return map
  },
  {} as Record<string, AccountPlCategory>,
)

/** 旧科目名 → 現行科目名（Firestore 既存データの互換） */
export const LEGACY_SALES_CATEGORY_MAP: Readonly<Record<string, SalesCategory>> = {
  運賃: '運賃収入',
  介助: '介助料収入',
  機材レンタル: '機材利用料収入',
  その他: 'その他売上',
  ストック: 'ストック',
  運賃収入: '運賃収入',
  介助料収入: '介助料収入',
  機材利用料収入: '機材利用料収入',
  その他売上: 'その他売上',
}

export const LEGACY_EXPENSE_CATEGORY_MAP: Readonly<Record<string, ExpenseCategory>> = {
  // 現行名はそのまま
  ...Object.fromEntries(EXPENSE_CATEGORIES.map((name) => [name, name])) as Record<string, ExpenseCategory>,
  // 旧マスタ互換
  車両費: '車両修繕費',
  '高速・駐車場': '高速代・駐車場代',
  システム費: 'システム利用料',
  保険料: '車両保険・任意保険',
  支払手数料: '決済手数料',
  介護用品費: '介助用品消耗品',
  水道光熱費: '事務用品・雑費',
  その他経費: '事務用品・雑費',
  駐車場代: '駐車場代（固定契約）',
  雑費: '事務用品・雑費',
  システム利用料: 'システム利用料',
}

/** 固定費登録フォーム用（固定費カテゴリのみ。繰延資産候補は除外） */
export const FIXED_COST_CATEGORY_OPTIONS: ReadonlyArray<{ value: ExpenseCategory; label: string }> =
  FIXED_EXPENSE_CATEGORIES.filter(
    (name) =>
      name !== '開業前立替金・繰延資産候補' && name !== '開業費償却' && name !== '創立費償却',
  ).map((name) => ({ value: name, label: name }))

export const normalizeSalesCategory = (value: unknown): SalesCategory | '' => {
  if (typeof value !== 'string' || !value) {
    return ''
  }

  const mapped = LEGACY_SALES_CATEGORY_MAP[value]
  if (mapped) {
    return mapped
  }

  return SALES_CATEGORIES.includes(value as SalesCategory) ? (value as SalesCategory) : ''
}

export const normalizeExpenseCategory = (value: unknown): ExpenseCategory | '' => {
  if (typeof value !== 'string' || !value) {
    return ''
  }

  const mapped = LEGACY_EXPENSE_CATEGORY_MAP[value]
  if (mapped) {
    return mapped
  }

  return EXPENSE_CATEGORIES.includes(value as ExpenseCategory) ? (value as ExpenseCategory) : ''
}

export const getAccountPlCategory = (
  name: string | undefined | null,
): AccountPlCategory | undefined => {
  if (!name) {
    return undefined
  }

  const sales = normalizeSalesCategory(name)
  if (sales) {
    return 'sales'
  }

  const expense = normalizeExpenseCategory(name)
  if (expense) {
    return PL_CATEGORY_BY_NAME[expense]
  }

  return PL_CATEGORY_BY_NAME[name]
}

export const isSalesCategory = (value: unknown): value is SalesCategory =>
  normalizeSalesCategory(value) !== ''

export const isExpenseCategorySelected = (
  category: ExpenseCategory | '' | undefined | string,
): category is ExpenseCategory => normalizeExpenseCategory(category) !== ''

export const getExpenseCategoriesByPlCategory = (plCategory: AccountPlCategory): readonly ExpenseCategory[] => {
  if (plCategory === 'costOfSales') {
    return COST_OF_SALES_CATEGORIES
  }
  if (plCategory === 'fixedExpense') {
    return FIXED_EXPENSE_CATEGORIES
  }
  if (plCategory === 'variableExpense') {
    return VARIABLE_EXPENSE_CATEGORIES
  }
  return []
}
