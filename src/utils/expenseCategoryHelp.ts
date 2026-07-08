export type ExpenseCategoryHelpRow = {
  category: string
  examples: string
  notes: string
  /** 検索用の追加キーワード（科目名・使用例・注意点に含まれない語） */
  keywords?: readonly string[]
}

export type CareTaxiExpenseExample = {
  expenditure: string
  recommendedCategory: string
  keywords?: readonly string[]
}

/** 経費科目ヘルプ：科目一覧と使用例 */
export const EXPENSE_CATEGORY_HELP_ROWS: readonly ExpenseCategoryHelpRow[] = [
  {
    category: '車両費',
    examples: '車両点検費、オイル交換、タイヤ交換、消耗品交換、修理費',
    notes: '車両に直接関係する費用',
    keywords: ['車検', '整備', '修理', 'オイル', 'タイヤ', '点検'],
  },
  {
    category: '燃料費',
    examples: 'ガソリン、軽油、給油代',
    notes: '車両費と分ける',
    keywords: ['ガソリン', '軽油', '給油'],
  },
  {
    category: '消耗品費',
    examples: '文具、コピー用紙、電池、清掃用品、少額備品',
    notes: '高額備品は備品・工具器具備品も検討',
    keywords: ['文具', '清掃', '電池', 'ストレッチャー', '備品'],
  },
  {
    category: '通信費',
    examples: 'スマホ代、Wi-Fi、SIM、電話料金',
    notes: '事業利用分のみ',
    keywords: ['スマホ', 'SIM', 'Wi-Fi', '電話'],
  },
  {
    category: '広告宣伝費',
    examples: 'チラシ、LP制作、名刺、看板、Web広告',
    notes: '採用広告とは分けてもよい',
    keywords: ['チラシ', '名刺', '広告', '看板'],
  },
  {
    category: '支払手数料',
    examples: '振込手数料、証明書発行手数料、決済手数料',
    notes: '税金系は租税公課も確認',
    keywords: ['振込', '手数料', '印鑑証明', '登記', '証明書'],
  },
  {
    category: '租税公課',
    examples: '登録免許税、印紙、重量税、各種証明書手数料',
    notes: '法人税・住民税本税は経費扱い注意',
    keywords: ['車検', '重量税', '印紙', '免許', '税金'],
  },
  {
    category: '保険料',
    examples: '自賠責、任意保険、車両保険',
    notes: '車検時の自賠責はこちら',
    keywords: ['車検', '自賠責', '任意保険', '車両保険'],
  },
  {
    category: '旅費交通費',
    examples: '電車、バス、駐車場、高速代',
    notes: '業務移動に限る',
    keywords: ['電車', 'バス', '高速', '駐車場'],
  },
  {
    category: '接待交際費',
    examples: '取引先との飲食、手土産',
    notes: '私用混在に注意',
    keywords: ['飲食', '手土産', '接待'],
  },
  {
    category: '会議費',
    examples: '打合せ飲食、会議室代',
    notes: '少額・業務目的（アプリでは接待交際費・その他経費等を検討）',
    keywords: ['打合せ', '会議', '会議室'],
  },
  {
    category: '研修費',
    examples: '講習、資格研修、教材',
    notes: '事業関連性が必要',
    keywords: ['講習', '資格', '教材', '研修'],
  },
  {
    category: '雑費',
    examples: '他の科目に当てはまりにくい少額費用',
    notes: '多用しない（アプリでは「その他経費」）',
    keywords: ['雑費', 'その他'],
  },
]

/** 介護タクシーでよく使う科目の目安 */
export const CARE_TAXI_EXPENSE_EXAMPLES: readonly CareTaxiExpenseExample[] = [
  {
    expenditure: '車検整備代',
    recommendedCategory: '車両費',
    keywords: ['車検', '整備'],
  },
  {
    expenditure: '自賠責保険',
    recommendedCategory: '保険料',
    keywords: ['車検', '自賠責'],
  },
  {
    expenditure: '重量税・印紙',
    recommendedCategory: '租税公課',
    keywords: ['車検', '重量税', '印紙'],
  },
  {
    expenditure: 'ガソリン',
    recommendedCategory: '燃料費',
    keywords: ['ガソリン', '給油'],
  },
  {
    expenditure: 'ストレッチャー用品・清掃用品',
    recommendedCategory: '消耗品費',
    keywords: ['ストレッチャー', '清掃'],
  },
  {
    expenditure: '名刺・チラシ',
    recommendedCategory: '広告宣伝費',
    keywords: ['名刺', 'チラシ'],
  },
  {
    expenditure: '印鑑証明・登記事項証明書',
    recommendedCategory: '支払手数料 または 租税公課',
    keywords: ['印鑑', '登記', '証明書'],
  },
  {
    expenditure: 'スマホ・通信SIM',
    recommendedCategory: '通信費',
    keywords: ['スマホ', 'SIM', '通信'],
  },
]

const normalizeSearchText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

const rowMatchesQuery = (texts: readonly (string | undefined)[], query: string) => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return true
  }

  return texts.some((text) => text && normalizeSearchText(text).includes(normalizedQuery))
}

export const filterExpenseCategoryHelpRows = (
  rows: readonly ExpenseCategoryHelpRow[],
  query: string,
): ExpenseCategoryHelpRow[] => {
  if (!normalizeSearchText(query)) {
    return [...rows]
  }

  return rows.filter((row) =>
    rowMatchesQuery([row.category, row.examples, row.notes, ...(row.keywords ?? [])], query),
  )
}

export const filterCareTaxiExpenseExamples = (
  rows: readonly CareTaxiExpenseExample[],
  query: string,
): CareTaxiExpenseExample[] => {
  if (!normalizeSearchText(query)) {
    return [...rows]
  }

  return rows.filter((row) =>
    rowMatchesQuery([row.expenditure, row.recommendedCategory, ...(row.keywords ?? [])], query),
  )
}
