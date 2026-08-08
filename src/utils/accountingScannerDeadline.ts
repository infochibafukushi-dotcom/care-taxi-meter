import type { ScannerInputMode } from '../types/accountingReceiptLegal'

/** 標準モード: 速やかに入力（おおむね7営業日以内） */
export const DEFAULT_SCANNER_INPUT_MODE: ScannerInputMode = 'rapid'
export const DEFAULT_RAPID_BUSINESS_DAYS = 7

export type ScannerBusinessCalendar = {
  /** 0=日 ... 6=土。既定は土日休み */
  weekendDays?: number[]
  /** YYYY-MM-DD の休業日 */
  holidays?: string[]
}

export type ScannerDeadlineResult = {
  mode: ScannerInputMode
  receivedDate: string | null
  foundDate?: string
  dueDate: string | null
  remainingBusinessDays: number | null
  isOverdue: boolean
  requiresPaperOriginal: boolean
  reason?: string
}

const toDateOnly = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

const formatDateOnly = (date: Date) => {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const isNonBusinessDay = (date: Date, calendar: ScannerBusinessCalendar) => {
  const weekend = calendar.weekendDays ?? [0, 6]
  if (weekend.includes(date.getUTCDay())) {
    return true
  }
  const holidays = new Set(calendar.holidays ?? [])
  return holidays.has(formatDateOnly(date))
}

/** 受領日の翌営業日から数えて N 営業日後を期限とする（固定カレンダー日加算ではない） */
export function addBusinessDays(
  startDateIso: string,
  businessDays: number,
  calendar: ScannerBusinessCalendar = {},
): string | null {
  const start = toDateOnly(startDateIso)
  if (!start || businessDays <= 0) {
    return null
  }
  const cursor = new Date(start.getTime())
  // 起算は受領日の翌日
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  let remaining = businessDays
  // 安全上限（無限ループ防止）
  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    if (!isNonBusinessDay(cursor, calendar)) {
      remaining -= 1
      if (remaining === 0) {
        return formatDateOnly(cursor)
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return null
}

export function countRemainingBusinessDays(
  fromIso: string,
  dueIso: string,
  calendar: ScannerBusinessCalendar = {},
): number {
  const from = toDateOnly(fromIso)
  const due = toDateOnly(dueIso)
  if (!from || !due) {
    return 0
  }
  if (due.getTime() < from.getTime()) {
    return 0
  }
  const cursor = new Date(from.getTime())
  let count = 0
  for (let guard = 0; guard < 400; guard += 1) {
    if (cursor.getTime() > due.getTime()) {
      break
    }
    if (!isNonBusinessDay(cursor, calendar)) {
      count += 1
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

/**
 * 入力期限を評価する。
 * - rapid: おおむね7営業日（カレンダー設定必須構造）
 * - business_cycle: 規程未作成のため今回は自動適用せず紙原本必須扱い
 * - receivedDate 不明: foundDate を置き換えず紙原本必須
 */
export function evaluateScannerDeadline(input: {
  receivedDate?: string | null
  foundDate?: string
  todayIso?: string
  mode?: ScannerInputMode
  rapidBusinessDays?: number
  calendar?: ScannerBusinessCalendar
}): ScannerDeadlineResult {
  const mode = input.mode ?? DEFAULT_SCANNER_INPUT_MODE
  const today =
    input.todayIso && toDateOnly(input.todayIso)
      ? input.todayIso.slice(0, 10)
      : formatDateOnly(new Date())

  if (!input.receivedDate) {
    return {
      mode,
      receivedDate: null,
      foundDate: input.foundDate,
      dueDate: null,
      remainingBusinessDays: null,
      isOverdue: true,
      requiresPaperOriginal: true,
      reason: 'received_date_unknown',
    }
  }

  if (mode === 'business_cycle') {
    return {
      mode,
      receivedDate: input.receivedDate,
      foundDate: input.foundDate,
      dueDate: null,
      remainingBusinessDays: null,
      isOverdue: false,
      requiresPaperOriginal: true,
      reason: 'business_cycle_policy_undefined',
    }
  }

  const dueDate = addBusinessDays(
    input.receivedDate,
    input.rapidBusinessDays ?? DEFAULT_RAPID_BUSINESS_DAYS,
    input.calendar,
  )
  if (!dueDate) {
    return {
      mode,
      receivedDate: input.receivedDate,
      foundDate: input.foundDate,
      dueDate: null,
      remainingBusinessDays: null,
      isOverdue: false,
      requiresPaperOriginal: true,
      reason: 'deadline_unavailable',
    }
  }

  const todayDate = toDateOnly(today)!
  const due = toDateOnly(dueDate)!
  const isOverdue = todayDate.getTime() > due.getTime()
  const remainingBusinessDays = isOverdue
    ? 0
    : countRemainingBusinessDays(today, dueDate, input.calendar)

  return {
    mode,
    receivedDate: input.receivedDate,
    foundDate: input.foundDate,
    dueDate,
    remainingBusinessDays,
    isOverdue,
    requiresPaperOriginal: isOverdue,
    reason: isOverdue ? 'deadline_overdue' : undefined,
  }
}
