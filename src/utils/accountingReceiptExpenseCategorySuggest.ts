import type { ExpenseCategory } from '../types/accounting'

type CategoryRule = {
  keywords: readonly string[]
  category: ExpenseCategory
}

/** 商品名・内容テキストから経費科目候補を推定（ルールベース） */
const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    keywords: [
      '文房具',
      '事務用品',
      'ホッチキス',
      'はんこ',
      'スタンプ',
      'ブラシ',
      'マット',
      'ペン',
      'ノート',
      'ファイル',
      '付箋',
      'クリップ',
      'テープ',
      'のり',
      '封筒',
    ],
    category: '事務用品・雑費',
  },
  {
    keywords: ['工具', 'ドライバー', 'レンチ', 'ペンチ', 'ハサミ', 'カッター'],
    category: '消耗品費',
  },
  {
    keywords: ['洗剤', 'ティッシュ', 'ゴミ袋', '掃除', '雑巾', 'スポンジ'],
    category: '消耗品費',
  },
  {
    keywords: ['介護', 'おむつ', 'パッド', '杖', '車いす', '介助用品'],
    category: '介助用品消耗品',
  },
  {
    keywords: ['ガソリン', '軽油', '給油', '燃料'],
    category: '燃料費',
  },
  {
    keywords: ['駐車', '高速', 'ETC', '通行料'],
    category: '高速代・駐車場代',
  },
  {
    keywords: ['電話', '通信', 'SIM', 'インターネット', 'プロバイダ'],
    category: '通信費',
  },
  {
    keywords: ['修繕', '修理', '板金', '塗装'],
    category: '車両修繕費',
  },
  {
    keywords: ['オイル', 'タイヤ'],
    category: 'オイル・タイヤ費',
  },
  {
    keywords: ['車検', '法定点検'],
    category: '車検・法定点検費',
  },
  {
    keywords: ['洗車'],
    category: '洗車費',
  },
]

const normalizeForMatch = (value: string) => value.toLowerCase().replace(/\s+/g, '')

export const suggestExpenseCategoryFromReceiptText = ({
  description,
  vendorName,
}: {
  description?: string
  vendorName?: string
}): ExpenseCategory | '' => {
  const haystack = normalizeForMatch(`${description ?? ''} ${vendorName ?? ''}`)
  if (!haystack) {
    return ''
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(normalizeForMatch(keyword)))) {
      return rule.category
    }
  }

  if (/(セリア|seria|ダイソー|daiso|キャンドゥ|cando)/i.test(haystack) && description) {
    return '消耗品費'
  }

  return ''
}
