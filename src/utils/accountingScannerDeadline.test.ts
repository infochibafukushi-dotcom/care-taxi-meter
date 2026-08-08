import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  countRemainingBusinessDays,
  DEFAULT_RAPID_BUSINESS_DAYS,
  evaluateScannerDeadline,
} from './accountingScannerDeadline'

describe('addBusinessDays', () => {
  it('counts 7 business days from the day after receivedDate (not calendar days)', () => {
    // 2026-01-05 Mon → start Jan 6; 7 biz days → Wed Jan 14
    expect(addBusinessDays('2026-01-05', 7)).toBe('2026-01-14')
    expect(addBusinessDays('2026-01-05', DEFAULT_RAPID_BUSINESS_DAYS)).toBe('2026-01-14')
  })

  it('skips weekends when counting business days', () => {
    // Fri Jan 9 → start Sat Jan 10 (skip), Sun skip, Mon Jan 12 is day 1
    expect(addBusinessDays('2026-01-09', 1)).toBe('2026-01-12')
  })

  it('skips configured holidays', () => {
    const calendar = { holidays: ['2026-01-07'] }
    // Without holiday due would be Jan 14; with Jan 7 holiday → Jan 15
    expect(addBusinessDays('2026-01-05', 7, calendar)).toBe('2026-01-15')
  })

  it('respects custom weekend days', () => {
    const calendar = { weekendDays: [0, 5, 6] } // Fri-Sun off
    // Mon Jan 5 → start Tue Jan 6; only Mon-Thu are business → 7th biz day is Jan 16 Fri? 
    // Jan 6 Tue(1),7 Wed(2),8 Thu(3),12 Mon(4),13 Tue(5),14 Wed(6),15 Thu(7)
    expect(addBusinessDays('2026-01-05', 7, calendar)).toBe('2026-01-15')
  })
})

describe('evaluateScannerDeadline rapid mode', () => {
  it('returns dueDate ~7 business days after receivedDate', () => {
    const result = evaluateScannerDeadline({
      receivedDate: '2026-01-05',
      todayIso: '2026-01-10',
    })
    expect(result.mode).toBe('rapid')
    expect(result.dueDate).toBe('2026-01-14')
    expect(result.isOverdue).toBe(false)
    expect(result.requiresPaperOriginal).toBe(false)
    expect(result.remainingBusinessDays).toBeGreaterThan(0)
  })

  it('marks overdue when today is after dueDate → requiresPaperOriginal', () => {
    const result = evaluateScannerDeadline({
      receivedDate: '2026-01-05',
      todayIso: '2026-01-15',
    })
    expect(result.isOverdue).toBe(true)
    expect(result.requiresPaperOriginal).toBe(true)
    expect(result.reason).toBe('deadline_overdue')
    expect(result.remainingBusinessDays).toBe(0)
  })

  it('treats missing receivedDate as overdue with paper original required', () => {
    const result = evaluateScannerDeadline({
      receivedDate: null,
      foundDate: '2026-02-01',
      todayIso: '2026-02-01',
    })
    expect(result.receivedDate).toBeNull()
    expect(result.foundDate).toBe('2026-02-01')
    expect(result.dueDate).toBeNull()
    expect(result.isOverdue).toBe(true)
    expect(result.requiresPaperOriginal).toBe(true)
    expect(result.reason).toBe('received_date_unknown')
  })

  it('does not substitute foundDate for receivedDate in deadline calculation', () => {
    const withFoundOnly = evaluateScannerDeadline({
      foundDate: '2026-01-05',
      todayIso: '2026-01-10',
    })
    expect(withFoundOnly.dueDate).toBeNull()
    expect(withFoundOnly.isOverdue).toBe(true)
  })

  it('uses business calendar holidays in overdue evaluation', () => {
    const calendar = { holidays: ['2026-01-07'] }
    const beforeDue = evaluateScannerDeadline({
      receivedDate: '2026-01-05',
      todayIso: '2026-01-14',
      calendar,
    })
    expect(beforeDue.dueDate).toBe('2026-01-15')
    expect(beforeDue.isOverdue).toBe(false)

    const afterDue = evaluateScannerDeadline({
      receivedDate: '2026-01-05',
      todayIso: '2026-01-16',
      calendar,
    })
    expect(afterDue.isOverdue).toBe(true)
  })

  it('business_cycle mode requires paper original without auto due date', () => {
    const result = evaluateScannerDeadline({
      receivedDate: '2026-01-05',
      mode: 'business_cycle',
      todayIso: '2026-01-10',
    })
    expect(result.dueDate).toBeNull()
    expect(result.isOverdue).toBe(false)
    expect(result.requiresPaperOriginal).toBe(true)
    expect(result.reason).toBe('business_cycle_policy_undefined')
  })
})

describe('countRemainingBusinessDays', () => {
  it('counts inclusive business days between from and due', () => {
    expect(countRemainingBusinessDays('2026-01-10', '2026-01-14')).toBe(3) // Fri, Mon, Tue, Wed = 4? 
    // Jan 10 Fri(1), 11 Sat skip, 12 Sun skip, 13 Mon(2), 14 Tue(3)
    expect(countRemainingBusinessDays('2026-01-10', '2026-01-14')).toBe(3)
  })
})
