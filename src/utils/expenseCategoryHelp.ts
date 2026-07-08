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

/** 経費科目ヘルプ：科目一覧と使用例（管理会計科目に整合） */
export const EXPENSE_CATEGORY_HELP_ROWS: readonly ExpenseCategoryHelpRow[] = [
  {
    category: '燃料費',
    examples: 'ガソリン、軽油、給油代',
    notes: '車両修繕費と分ける',
    keywords: ['ガソリン', '軽油', '給油'],
  },
  {
    category: '高速代・駐車場代',
    examples: '高速料金、一時駐車場、ETC',
    notes: '固定契約の月極駐車場は「駐車場代（固定契約）」',
    keywords: ['高速', 'ETC', '駐車場'],
  },
  {
    category: '洗車費',
    examples: '洗車、コーティング（少額）',
    notes: '車両修繕費と分ける',
    keywords: ['洗車'],
  },
  {
    category: '車両修繕費',
    examples: '修理費、板金、整備不良による修理',
    notes: 'オイル・タイヤ・車検は別科目',
    keywords: ['修理', '板金', '整備'],
  },
  {
    category: 'オイル・タイヤ費',
    examples: 'エンジンオイル、タイヤ交換',
    notes: '車両修繕費と分ける',
    keywords: ['オイル', 'タイヤ'],
  },
  {
    category: '車検・法定点検費',
    examples: '車検整備代、法定点検',
    notes: '自賠責・重量税は保険料・租税公課へ',
    keywords: ['車検', '法定点検'],
  },
  {
    category: '車両保険・任意保険',
    examples: '自賠責、任意保険、車両保険',
    notes: '車検時の自賠責はこちら',
    keywords: ['車検', '自賠責', '任意保険', '車両保険'],
  },
  {
    category: '消耗品費',
    examples: '清掃用品、少額備品、電池',
    notes: '事務文具は事務用品・雑費も検討',
    keywords: ['清掃', '電池', '備品'],
  },
  {
    category: '介助用品消耗品',
    examples: 'シーツ、手袋、消毒液、ストレッチャー用品',
    notes: '販売用仕入は売上原価へ',
    keywords: ['ストレッチャー', '介助', '介護'],
  },
  {
    category: '通信費',
    examples: 'スマホ代、Wi-Fi、SIM、電話料金',
    notes: '事業利用分のみ',
    keywords: ['スマホ', 'SIM', 'Wi-Fi', '電話'],
  },
  {
    category: 'システム利用料',
    examples: '配車アプリ、クラウド料金、SaaS月額',
    notes: '会計ソフトは「会計ソフト費」',
    keywords: ['システム', 'SaaS', 'クラウド'],
  },
  {
    category: '広告宣伝費',
    examples: 'チラシ、LP、名刺、看板、変動的なWeb広告',
    notes: '固定掲載料は「Web広告固定費・掲載料」',
    keywords: ['チラシ', '名刺', '広告', '看板'],
  },
  {
    category: '決済手数料',
    examples: 'カード決済手数料、振込手数料',
    notes: '紹介手数料は別科目',
    keywords: ['振込', '決済', '手数料'],
  },
  {
    category: '租税公課',
    examples: '印紙、各種証明書、事業税以外の公課',
    notes: '自動車税・重量税は専用科目',
    keywords: ['印紙', '免許', '税金'],
  },
  {
    category: '自動車税・重量税',
    examples: '自動車税、重量税',
    notes: '車検時の重量税はこちら',
    keywords: ['車検', '重量税', '自動車税'],
  },
  {
    category: '旅費交通費',
    examples: '電車、バス、業務移動の交通費',
    notes: '高速・駐車場は高速代・駐車場代',
    keywords: ['電車', 'バス'],
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
    notes: '少額・業務目的',
    keywords: ['打合せ', '会議', '会議室'],
  },
  {
    category: '研修費',
    examples: '講習、資格研修、教材',
    notes: '事業関連性が必要',
    keywords: ['講習', '資格', '教材', '研修'],
  },
  {
    category: '事務用品・雑費',
    examples: '文具、コピー用紙、他科目に当てはめにくい少額費用',
    notes: '多用しない',
    keywords: ['文具', '雑費', 'その他'],
  },
  {
    category: '外注費',
    examples: '運行委託、業務委託',
    notes: '売上原価',
    keywords: ['外注', '委託'],
  },
  {
    category: '外部機材レンタル費',
    examples: '車いす・ストレッチャーレンタル',
    notes: '売上原価',
    keywords: ['レンタル', '機材'],
  },
]

/** 介護タクシーでよく使う科目の目安 */
export const CARE_TAXI_EXPENSE_EXAMPLES: readonly CareTaxiExpenseExample[] = [
  {
    expenditure: '車検整備代',
    recommendedCategory: '車検・法定点検費',
    keywords: ['車検', '整備'],
  },
  {
    expenditure: '自賠責保険',
    recommendedCategory: '車両保険・任意保険',
    keywords: ['車検', '自賠責'],
  },
  {
    expenditure: '重量税・印紙',
    recommendedCategory: '自動車税・重量税 または 租税公課',
    keywords: ['車検', '重量税', '印紙'],
  },
  {
    expenditure: 'ガソリン',
    recommendedCategory: '燃料費',
    keywords: ['ガソリン', '給油'],
  },
  {
    expenditure: 'ストレッチャー用品・清掃用品',
    recommendedCategory: '介助用品消耗品 または 消耗品費',
    keywords: ['ストレッチャー', '清掃'],
  },
  {
    expenditure: '名刺・チラシ',
    recommendedCategory: '広告宣伝費',
    keywords: ['名刺', 'チラシ'],
  },
  {
    expenditure: '印鑑証明・登記事項証明書',
    recommendedCategory: '決済手数料 または 租税公課',
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
