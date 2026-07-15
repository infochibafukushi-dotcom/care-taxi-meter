const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
const COLLAPSE_UNDERSCORES = /_+/g
const EXE_LIKE_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'scr',
  'js',
  'vbs',
  'ps1',
  'sh',
  'dll',
  'jar',
])

const SAFE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const)

export type SafeSubmissionExtension = 'pdf' | 'jpg' | 'jpeg' | 'png' | 'webp'

export type ResolveSafeSubmissionExtensionResult =
  | { ext: SafeSubmissionExtension }
  | { issue: 'unsupportedFormat' }

const DEFAULT_BASENAME_MAX = 120

const trimTrailingDotsAndSpaces = (value: string) => value.replace(/[.\s]+$/g, '')

/**
 * Sanitize a single filename segment (no path separators).
 * Collapses underscores, strips forbidden/control chars, trims, removes trailing `.`/space.
 */
export const sanitizeFileNameSegment = (input: string, maxLen = DEFAULT_BASENAME_MAX): string => {
  const normalized = String(input ?? '')
    .normalize('NFKC')
    .replace(FORBIDDEN_CHARS, '_')
    .replace(/[\r\n\t]/g, '_')
    .replace(COLLAPSE_UNDERSCORES, '_')
    .trim()

  const withoutEdge = trimTrailingDotsAndSpaces(normalized.replace(/^_+|_+$/g, ''))
  if (!withoutEdge) {
    return 'untitled'
  }

  if (withoutEdge.length <= maxLen) {
    return withoutEdge
  }

  return trimTrailingDotsAndSpaces(withoutEdge.slice(0, maxLen)) || 'untitled'
}

const extensionFromFileName = (fileName?: string): string => {
  if (!fileName) {
    return ''
  }
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot === base.length - 1) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

const extensionFromMime = (mimeType?: string): string => {
  const mime = (mimeType ?? '').trim().toLowerCase()
  switch (mime) {
    case 'application/pdf':
      return 'pdf'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return ''
  }
}

export const resolveSafeSubmissionExtension = (input: {
  mimeType?: string
  originalFileName?: string
}): ResolveSafeSubmissionExtensionResult => {
  const fromMime = extensionFromMime(input.mimeType)
  const fromName = extensionFromFileName(input.originalFileName)
  const candidate = fromMime || fromName

  if (!candidate || EXE_LIKE_EXTENSIONS.has(candidate)) {
    return { issue: 'unsupportedFormat' }
  }

  if (!SAFE_EXTENSIONS.has(candidate as SafeSubmissionExtension)) {
    return { issue: 'unsupportedFormat' }
  }

  return { ext: candidate as SafeSubmissionExtension }
}

const formatAmountYen = (amountYen: number) => String(Math.trunc(Number.isFinite(amountYen) ? amountYen : 0))

/**
 * Linked voucher path under 証憑/.
 * Example: 証憑/EXP-000001_RCP-000001_2026-07-15_店舗名_1200.pdf
 */
export const buildVoucherFileName = (input: {
  expenseNo?: string
  receiptNo: string
  date: string
  vendor: string
  amountYen: number
  ext: SafeSubmissionExtension
}): string => {
  const parts = [
    input.expenseNo ? sanitizeFileNameSegment(input.expenseNo, 32) : '',
    sanitizeFileNameSegment(input.receiptNo, 32),
    sanitizeFileNameSegment(input.date || 'unknown-date', 32),
    sanitizeFileNameSegment(input.vendor || 'unknown-vendor', 40),
    sanitizeFileNameSegment(formatAmountYen(input.amountYen), 16),
  ].filter(Boolean)

  const stem = sanitizeFileNameSegment(parts.join('_'), DEFAULT_BASENAME_MAX)
  return `証憑/${stem}.${input.ext}`
}

/**
 * Unlinked voucher path under 証憑/未紐付け/.
 */
export const buildUnlinkedVoucherFileName = (input: {
  receiptNo: string
  date: string
  vendor: string
  amountYen: number
  ext: SafeSubmissionExtension
}): string => {
  const parts = [
    sanitizeFileNameSegment(input.receiptNo, 32),
    sanitizeFileNameSegment(input.date || 'unknown-date', 32),
    sanitizeFileNameSegment(input.vendor || 'unknown-vendor', 40),
    sanitizeFileNameSegment(formatAmountYen(input.amountYen), 16),
  ]

  const stem = sanitizeFileNameSegment(parts.join('_'), DEFAULT_BASENAME_MAX)
  return `証憑/未紐付け/${stem}.${input.ext}`
}

/**
 * If `candidate` is already taken, append _2, _3, … before the extension.
 */
export const ensureUniqueRelativePath = (occupied: Set<string> | Iterable<string>, candidate: string): string => {
  const taken = occupied instanceof Set ? occupied : new Set(occupied)
  if (!taken.has(candidate)) {
    taken.add(candidate)
    return candidate
  }

  const slash = candidate.lastIndexOf('/')
  const dir = slash >= 0 ? candidate.slice(0, slash + 1) : ''
  const base = slash >= 0 ? candidate.slice(slash + 1) : candidate
  const dot = base.lastIndexOf('.')
  const stem = dot >= 0 ? base.slice(0, dot) : base
  const ext = dot >= 0 ? base.slice(dot) : ''

  let n = 2
  while (n < 10_000) {
    const next = `${dir}${sanitizeFileNameSegment(`${stem}_${n}`, DEFAULT_BASENAME_MAX)}${ext}`
    if (!taken.has(next)) {
      taken.add(next)
      return next
    }
    n += 1
  }

  throw new Error(`Unable to uniquify relative path: ${candidate}`)
}
