import { describe, expect, it } from 'vitest'
import type { YearlyProfitLoss } from '../types/accounting'
import { calculateYearlyProfitLoss } from './accountingPl'
import { buildYearlyPlCsv, buildYearlyPlCsvFileName } from './accountingCsv'
import type { StoredAccountingAdjustment } from '../types/accounting'

describe('buildYearlyPlCsv', () => {
  it('uses fixed headers and matches yearly PL totals', () => {
    const yearly = calculateYearlyProfitLoss({
      caseRecords: [],
      adjustments: [
        {
          id: 'a1',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          adjustmentType: 'sales',
          targetYearMonth: '2026-01',
          salesCategory: '運賃収入',
          amountYen: 100_000,
          description: 'jan',
          confirmationStatus: '確認済み',
          createdBy: 'u1',
          createdByName: 'u',
          updatedBy: 'u1',
          updatedByName: 'u',
        } as StoredAccountingAdjustment,
        {
          id: 'a2',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          adjustmentType: 'sales',
          targetYearMonth: '2026-02',
          salesCategory: '運賃収入',
          amountYen: 120_000,
          description: 'feb',
          confirmationStatus: '確認済み',
          createdBy: 'u1',
          createdByName: 'u',
          updatedBy: 'u1',
          updatedByName: 'u',
        } as StoredAccountingAdjustment,
      ],
      expenses: [],
      fixedCosts: [],
      targetYear: 2026,
    })

    const csv = buildYearlyPlCsv(yearly)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('区分,科目,前々期,前期,1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月,年間合計')
    expect(csv).toContain(`売上,運賃収入,0,0,100000,120000,0,0,0,0,0,0,0,0,0,0,220000`)
    expect(csv).toContain(`売上,売上小計,0,0,100000,120000,0,0,0,0,0,0,0,0,0,0,220000`)
    expect(csv).toContain('粗利益,粗利益,')
    expect(csv).toContain('固定費,固定費小計,')
    expect(csv).toContain('変動費,変動費小計,')
    expect(csv).toContain('利益,営業利益（純利益）,')
    expect(buildYearlyPlCsvFileName(2026)).toBe('management-pl-yearly-2026.csv')

    assertCsvMatchesYearly(csv, yearly)
  })
})

const assertCsvMatchesYearly = (csv: string, yearly: YearlyProfitLoss) => {
  const body = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const fareRow = body.find((line) => line.startsWith('売上,運賃収入,'))
  expect(fareRow).toBeDefined()
  const cells = fareRow!.split(',')
  expect(Number(cells[4])).toBe(yearly.columns.m01.sales['運賃収入'])
  expect(Number(cells[5])).toBe(yearly.columns.m02.sales['運賃収入'])
  expect(Number(cells[16])).toBe(yearly.columns.yearTotal.sales['運賃収入'])
}
