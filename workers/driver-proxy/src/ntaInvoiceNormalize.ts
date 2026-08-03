const FULLWIDTH_SPACE = /\u3000/g
const FULLWIDTH_ASCII = /[\uFF01-\uFF5E]/g
const HYPHEN_LIKE = /[-－‐‑‒–—―ー]/g
const SPACES = /[\s\u00A0]+/g

const toHalfWidthAscii = (value: string) =>
  value.replace(FULLWIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))

/**
 * 登録番号を正規化する。
 * 成功時は `T` + 数字13桁。失敗時は空文字。
 */
export const normalizeInvoiceRegistrationNumber = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }

  const cleaned = toHalfWidthAscii(value)
    .replace(FULLWIDTH_SPACE, '')
    .replace(SPACES, '')
    .replace(HYPHEN_LIKE, '')
    .toUpperCase()

  if (!cleaned) {
    return ''
  }

  if (/[^0-9T]/.test(cleaned)) {
    return ''
  }

  if (/^T\d{13}$/.test(cleaned)) {
    return cleaned
  }

  if (/^\d{13}$/.test(cleaned)) {
    return `T${cleaned}`
  }

  return ''
}

export const INVOICE_REGISTRATION_NUMBER_ERROR =
  '登録番号は「T＋数字13桁」で入力してください。'

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number) => {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30
  }
  return 31
}

/**
 * YYYY-MM-DD の実在日のみ許可。未来日は拒否（原則）。
 * `now` 省略時は実行時の UTC 日付ではなくローカル相当のカレンダー日で比較しないよう、
 * 呼び出し側から日本時間の当日を渡す想定。未指定時は Date の UTC 年月日を使う。
 */
export const normalizeBasisDate = (
  value: unknown,
  options?: { todayYmd?: string; allowEmpty?: boolean },
): { ok: true; date: string | null } | { ok: false; message: string } => {
  if (value == null || value === '') {
    if (options?.allowEmpty !== false) {
      return { ok: true, date: null }
    }
    return { ok: false, message: '判定基準日を入力してください。' }
  }

  if (typeof value !== 'string') {
    return { ok: false, message: '判定基準日は YYYY-MM-DD 形式で入力してください。' }
  }

  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) {
    return { ok: false, message: '判定基準日は YYYY-MM-DD 形式で入力してください。' }
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, message: '判定基準日に実在しない日付が指定されています。' }
  }

  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const today =
    options?.todayYmd ??
    (() => {
      const now = new Date()
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    })()

  if (normalized > today) {
    return { ok: false, message: '判定基準日に未来の日付は指定できません。' }
  }

  return { ok: true, date: normalized }
}

export const buildCacheKey = (
  apiType: 'valid' | 'num',
  registrationNumber: string,
  basisDate: string | null,
): string => {
  if (apiType === 'valid' && basisDate) {
    return `valid:${registrationNumber}:${basisDate}`
  }
  return `num:${registrationNumber}:current`
}
