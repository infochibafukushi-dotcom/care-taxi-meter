export const FIXED_ASSET_CANDIDATE_KEYWORDS = [
  '車両',
  '車',
  'ハイエース',
  '福祉車両',
  'PC',
  'パソコン',
  'タブレット',
  'プリンター',
  '複合機',
  'ストレッチャー',
  '車いす',
  '車椅子',
  'ソフトウェア',
  '看板',
  'リフォーム',
  'エアコン',
] as const

export const NORMAL_EXPENSE_OVERRIDE_AMOUNT_THRESHOLD_YEN = 100_000

export const FIXED_ASSET_OVERRIDE_WARNING =
  'この支出は固定資産または少額資産に該当する可能性があります。通常経費で登録すると、取得価額がそのままPLに計上されます。少額資産または固定資産として登録するか確認してください。'

export const matchesFixedAssetCandidateKeyword = (text: string) => {
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  return FIXED_ASSET_CANDIDATE_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

export const detectFixedAssetRegistrationWarning = ({
  amountYen,
  description = '',
  vendorName = '',
  assetCategory = '',
  suggestedCategory = '',
}: {
  amountYen: number
  description?: string
  vendorName?: string
  assetCategory?: string
  suggestedCategory?: string
}) => {
  const combinedText = [description, vendorName, assetCategory, suggestedCategory].join(' ')
  const keywordMatch = matchesFixedAssetCandidateKeyword(combinedText)
  const amountMatch = amountYen >= NORMAL_EXPENSE_OVERRIDE_AMOUNT_THRESHOLD_YEN

  return {
    shouldWarn: amountMatch || keywordMatch,
    amountMatch,
    keywordMatch,
  }
}
