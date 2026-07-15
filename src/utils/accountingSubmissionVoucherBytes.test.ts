import { describe, expect, it } from 'vitest'
import {
  detectSubmissionBinaryKind,
  formatVoucherValidationFailureReason,
  validateSubmissionVoucherBytes,
} from './accountingSubmissionVoucherBytes'

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])
const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])

describe('detectSubmissionBinaryKind', () => {
  it('detects pdf/jpeg/png/webp', () => {
    expect(detectSubmissionBinaryKind(pdfBytes)).toBe('pdf')
    expect(detectSubmissionBinaryKind(jpegBytes)).toBe('jpeg')
    expect(detectSubmissionBinaryKind(pngBytes)).toBe('png')
    expect(detectSubmissionBinaryKind(webpBytes)).toBe('webp')
  })

  it('returns null for empty or unknown', () => {
    expect(detectSubmissionBinaryKind(new Uint8Array())).toBeNull()
    expect(detectSubmissionBinaryKind(exeBytes)).toBeNull()
  })
})

describe('validateSubmissionVoucherBytes', () => {
  it('accepts matching pdf/jpeg', () => {
    expect(
      validateSubmissionVoucherBytes({
        bytes: pdfBytes,
        relativePath: '証憑/RCP-000001.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).toEqual({ ok: true, kind: 'pdf' })
    expect(
      validateSubmissionVoucherBytes({
        bytes: jpegBytes,
        relativePath: '証憑/RCP-000001.jpg',
        declaredMimeType: 'image/jpeg',
      }),
    ).toEqual({ ok: true, kind: 'jpeg' })
  })

  it('rejects MIME pdf when body is unknown / exe-like', () => {
    const result = validateSubmissionVoucherBytes({
      bytes: exeBytes,
      relativePath: '証憑/RCP-000001.pdf',
      declaredMimeType: 'application/pdf',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('unknownBinary')
      expect(formatVoucherValidationFailureReason(result.reasonCode)).not.toMatch(/4d|5a|MZ/i)
    }
  })

  it('rejects extension pdf when body is jpeg', () => {
    const result = validateSubmissionVoucherBytes({
      bytes: jpegBytes,
      relativePath: '証憑/RCP-000001.pdf',
      declaredMimeType: 'application/pdf',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('extensionMismatch')
    }
  })

  it('rejects empty', () => {
    const result = validateSubmissionVoucherBytes({
      bytes: new Uint8Array(),
      relativePath: '証憑/RCP-000001.pdf',
    })
    expect(result).toEqual({ ok: false, reasonCode: 'empty' })
  })
})
