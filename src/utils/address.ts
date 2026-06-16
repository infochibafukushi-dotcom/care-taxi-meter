const japanesePrefectures =
  '北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県'

const japanesePrefecturePattern = new RegExp(`^(${japanesePrefectures})`)

export function extractAreaFromAddress(address: string) {
  const normalizedAddress = address
    .replace(/〒?\d{3}-?\d{4}/g, '')
    .replace(/\s+/g, '')
    .replace(japanesePrefecturePattern, '')
    .trim()
  const townMatch = /^(.+?[市区町村](?:.+?区)?[^0-9０-９一二三四五六七八九十-]+?)(?:[0-9０-９一二三四五六七八九十-]|丁目|番|号|$)/.exec(normalizedAddress)
  return townMatch?.[1]?.replace(/[、,].*$/, '') ?? ''
}

export function extractAreaName(address: string) {
  const normalizedAddress = address
    .replace(/〒?\d{3}-?\d{4}/g, '')
    .replace(/\s+/g, '')
    .trim()

  if (!normalizedAddress) {
    return '住所未設定'
  }

  const withoutPrefecture = normalizedAddress.replace(japanesePrefecturePattern, '')
  const townMatch = /^(.+?[市区町村](?:.+?区)?[^0-9０-９一二三四五六七八九十-]+?)(?:[0-9０-９一二三四五六七八九十-]|丁目|番|号|$)/.exec(withoutPrefecture)

  if (townMatch?.[1]) {
    return townMatch[1].replace(/[、,].*$/, '')
  }

  const municipalityMatch = /^(.+?[市区町村])/.exec(withoutPrefecture)
  return municipalityMatch?.[1] ?? withoutPrefecture.slice(0, 18)
}
