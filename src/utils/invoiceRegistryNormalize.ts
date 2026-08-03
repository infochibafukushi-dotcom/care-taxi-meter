const FULLWIDTH_SPACE = /\u3000/g
const FULLWIDTH_ASCII = /[\uFF01-\uFF5E]/g
const HYPHEN_LIKE = /[-－‐‑‒–—―ー]/g
const SPACES = /[\s\u00A0]+/g

const toHalfWidthAscii = (value: string) =>
  value.replace(FULLWIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))

export const INVOICE_REGISTRATION_NUMBER_ERROR =
  '登録番号は「T＋数字13桁」で入力してください。'

export const normalizeInvoiceRegistrationNumberForUi = (value: unknown): string => {
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

export const normalizeBasisDateForUi = (
  value: unknown,
  todayYmd: string,
): { ok: true; date: string | null } | { ok: false; message: string } => {
  if (value == null || value === '') {
    return { ok: true, date: null }
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
  if (normalized > todayYmd) {
    return { ok: false, message: '判定基準日に未来の日付は指定できません。' }
  }

  return { ok: true, date: normalized }
}

/** Strict string equality for vendor name warning (no corporate-form normalization). */
export const isVendorNameMismatch = (vendorName: string, ntaName: string | null): boolean => {
  const left = vendorName.trim()
  const right = (ntaName ?? '').trim()
  if (!left || !right) {
    return false
  }
  return left !== right
}
