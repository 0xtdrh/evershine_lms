import { afterEach, describe, expect, it } from 'vitest'
import { checkPermission, getAllowedActions, setPermissionOverrides } from '@/lib/rbac'

afterEach(() => setPermissionOverrides([]))

describe('RBAC overrides from the Permissions page', () => {
  it('uses the static matrix when there are no overrides', () => {
    expect(checkPermission('SECRETARY', 'expenses', 'read')).toBe(false)
    expect(checkPermission('ADMIN', 'students', 'delete')).toBe(true)
  })

  it('an enabled override grants access', () => {
    setPermissionOverrides([{ role: 'SECRETARY', resource: 'expenses', action: 'read', isEnabled: true }])
    expect(checkPermission('SECRETARY', 'expenses', 'read')).toBe(true)
    expect(getAllowedActions('SECRETARY', 'expenses')).toContain('read')
  })

  it('a disabled override revokes access', () => {
    setPermissionOverrides([{ role: 'ADMIN', resource: 'students', action: 'delete', isEnabled: false }])
    expect(checkPermission('ADMIN', 'students', 'delete')).toBe(false)
    expect(checkPermission('ADMIN', 'students', 'read')).toBe(true)
    expect(getAllowedActions('ADMIN', 'students')).not.toContain('delete')
  })

  it('never restricts SUPER_ADMIN', () => {
    setPermissionOverrides([{ role: 'SUPER_ADMIN', resource: 'users', action: 'read', isEnabled: false }])
    expect(checkPermission('SUPER_ADMIN', 'users', 'read')).toBe(true)
  })

  it('an override for one role does not leak to another', () => {
    const branchManagerBefore = checkPermission('BRANCH_MANAGER', 'students', 'delete')
    setPermissionOverrides([{ role: 'ADMIN', resource: 'students', action: 'delete', isEnabled: false }])
    expect(checkPermission('BRANCH_MANAGER', 'students', 'delete')).toBe(branchManagerBefore)
    expect(checkPermission('SUPER_ADMIN', 'students', 'delete')).toBe(true)
  })

  it('normalises display role labels before applying overrides', () => {
    setPermissionOverrides([{ role: 'BRANCH_MANAGER', resource: 'students', action: 'read', isEnabled: false }])
    expect(checkPermission('Branch Manager', 'students', 'read')).toBe(false)
  })
})
