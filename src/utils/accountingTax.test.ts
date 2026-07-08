import { describe, expect, it } from 'vitest'
import {
  calculateConsumptionTaxFromIncluded,
  calculateTaxExcludedAmount,
  deriveTaxFields,
  normalizeTaxRate,
} from './accountingTax'

describe('normalizeTaxRate', () => {
  it('treats missing/empty as null', () => {
    expect(normalizeTaxRate(undefined)).toBeNull()
    expect(normalizeTaxRate(null)).toBeNull()
    expect(normalizeTaxRate('')).toBeNull()
  })

  it('accepts preset and custom rates', () => {
    expect(normalizeTaxRate(0)).toBe(0)
    expect(normalizeTaxRate(8)).toBe(8)
    expect(normalizeTaxRate(10)).toBe(10)
    expect(normalizeTaxRate(5)).toBe(5)
    expect(normalizeTaxRate('7%')).toBe(7)
  })
})

describe('calculateConsumptionTaxFromIncluded', () => {
  it('calculates from included amount and rate', () => {
    expect(calculateConsumptionTaxFromIncluded(11_000, 10)).toBe(1_000)
    expect(calculateConsumptionTaxFromIncluded(10_800, 8)).toBe(800)
  })

  it('returns 0 when rate unset or zero', () => {
    expect(calculateConsumptionTaxFromIncluded(11_000, null)).toBe(0)
    expect(calculateConsumptionTaxFromIncluded(11_000, 0)).toBe(0)
  })
})

describe('calculateTaxExcludedAmount', () => {
  it('subtracts tax amount from included', () => {
    expect(calculateTaxExcludedAmount(11_000, 1_000)).toBe(10_000)
  })
})

describe('deriveTaxFields', () => {
  it('auto mode derives tax and excluded amounts', () => {
    expect(
      deriveTaxFields({
        taxIncludedAmount: 11_000,
        taxRate: 10,
        taxCalculationMode: 'auto',
      }),
    ).toEqual({
      taxRate: 10,
      taxAmount: 1_000,
      consumptionTaxAmount: 1_000,
      taxExcludedAmount: 10_000,
      taxCalculationMode: 'auto',
    })
  })

  it('manual mode keeps hand-entered tax amount even if mismatched', () => {
    expect(
      deriveTaxFields({
        taxIncludedAmount: 11_000,
        taxRate: 10,
        taxAmount: 900,
        taxCalculationMode: 'manual',
      }),
    ).toMatchObject({
      taxAmount: 900,
      consumptionTaxAmount: 900,
      taxExcludedAmount: 10_100,
      taxCalculationMode: 'manual',
    })
  })
})
