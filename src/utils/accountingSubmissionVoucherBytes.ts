export type DetectedSubmissionBinaryKind = 'pdf' | 'jpeg' | 'png' | 'webp'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/**
 * Detect voucher binary kind from leading bytes only.
 * Does not echo file contents in return values (safe for user-facing errors).
 */
export const detectSubmissionBinaryKind = (
  bytes: ArrayBuffer | Uint8Array,
): DetectedSubmissionBinaryKind | null => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.length < 4) {
    return null
  }

  // %PDF
  if (view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46) {
    return 'pdf'
  }

  // JPEG FF D8 FF
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return 'jpeg'
  }

  // PNG
  if (view.length >= 8 && PNG_SIG.every((byte, index) => view[index] === byte)) {
    return 'png'
  }

  // RIFF....WEBP
  if (
    view.length >= 12 &&
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46 &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return 'webp'
  }

  return null
}

const extensionOf = (relativePath: string): string => {
  const base = relativePath.split('/').pop() ?? relativePath
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot === base.length - 1) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

const mimeToKind = (mimeType?: string): DetectedSubmissionBinaryKind | null => {
  const mime = (mimeType ?? '').trim().toLowerCase()
  if (mime === 'application/pdf') {
    return 'pdf'
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return 'jpeg'
  }
  if (mime === 'image/png') {
    return 'png'
  }
  if (mime === 'image/webp') {
    return 'webp'
  }
  return null
}

const extensionToKind = (ext: string): DetectedSubmissionBinaryKind | null => {
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'jpg':
    case 'jpeg':
      return 'jpeg'
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    default:
      return null
  }
}

export type ValidateSubmissionVoucherBytesResult =
  | { ok: true; kind: DetectedSubmissionBinaryKind }
  | { ok: false; reasonCode: string }

/**
 * Require magic bytes to match path extension and (when provided) declared MIME.
 * Mismatches and unknown binaries are rejected without echoing bytes.
 */
export const validateSubmissionVoucherBytes = (input: {
  bytes: ArrayBuffer | Uint8Array
  relativePath: string
  declaredMimeType?: string
}): ValidateSubmissionVoucherBytesResult => {
  const view = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
  if (view.length === 0) {
    return { ok: false, reasonCode: 'empty' }
  }

  const detected = detectSubmissionBinaryKind(view)
  if (!detected) {
    return { ok: false, reasonCode: 'unknownBinary' }
  }

  const extKind = extensionToKind(extensionOf(input.relativePath))
  if (extKind && extKind !== detected) {
    return { ok: false, reasonCode: 'extensionMismatch' }
  }

  const mimeKind = mimeToKind(input.declaredMimeType)
  if (mimeKind && mimeKind !== detected) {
    return { ok: false, reasonCode: 'mimeMismatch' }
  }

  return { ok: true, kind: detected }
}

/** Safe, non-leaking reason label for missing-voucher CSV / warnings */
export const formatVoucherValidationFailureReason = (reasonCode: string): string => {
  switch (reasonCode) {
    case 'empty':
      return '空の証憑ファイル'
    case 'unknownBinary':
      return '原本形式不明（実バイト不一致）'
    case 'extensionMismatch':
      return '拡張子と実ファイル形式が一致しません'
    case 'mimeMismatch':
      return 'MIMEと実ファイル形式が一致しません'
    default:
      return '証憑形式の検証に失敗しました'
  }
}
