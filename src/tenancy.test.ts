import { describe, expect, it } from 'vitest'
import { createTenantQueryConstraints, mergeTenantAccessScopes, normalizeTenantRole } from './services/tenancy'

describe('normalizeTenantRole', () => {
  it('maps legacy Firestore role names to app roles', () => {
    expect(normalizeTenantRole('franchisee_owner')).toBe('owner')
    expect(normalizeTenantRole('store_manager')).toBe('manager')
    expect(normalizeTenantRole('superAdmin')).toBe('hq_admin')
  })
})

describe('createTenantQueryConstraints', () => {
  it('adds storeId for store managers', () => {
    const constraints = createTenantQueryConstraints({
      franchiseeId: 'franchisee-a',
      storeId: 'store-a',
      role: 'manager',
    })

    expect(constraints).toHaveLength(2)
  })

  it('merges auth and work session tenant fields', () => {
    const scope = mergeTenantAccessScopes(
      { role: 'owner', staffId: 'staff-1' },
      { franchiseeId: 'franchisee-a', storeId: 'store-a', role: 'owner' },
    )

    expect(scope).toEqual({
      franchiseeId: 'franchisee-a',
      storeId: 'store-a',
      role: 'owner',
      staffId: 'staff-1',
    })
  })

  it('requires franchiseeId for non-hq roles', () => {
    expect(() =>
      createTenantQueryConstraints({
        role: 'owner',
      }),
    ).toThrow(/テナント情報/)
  })
})

