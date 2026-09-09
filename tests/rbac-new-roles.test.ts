import { describe, expect, it } from 'vitest'
import { checkPermission, getAllowedActions, normalizeRole, CAMPUS_SCOPED_ROLES } from '@/lib/rbac'

describe('SECRETARY role permissions', () => {
  it('can register, edit, and mark attendance for students', () => {
    expect(checkPermission('SECRETARY', 'students', 'create')).toBe(true)
    expect(checkPermission('SECRETARY', 'students', 'update')).toBe(true)
    expect(checkPermission('SECRETARY', 'attendance', 'create')).toBe(true)
  })

  it('can record fee payments but not manage financial policy', () => {
    expect(checkPermission('SECRETARY', 'fees', 'create')).toBe(true)
    expect(checkPermission('SECRETARY', 'fees', 'delete')).toBe(false)
    expect(checkPermission('SECRETARY', 'expenses', 'read')).toBe(false)
    expect(checkPermission('SECRETARY', 'fee_penalties', 'create')).toBe(false)
  })

  it('has no user-management or audit access', () => {
    expect(getAllowedActions('SECRETARY', 'users')).toEqual([])
    expect(getAllowedActions('SECRETARY', 'audit_logs')).toEqual([])
  })
})

describe('BRANCH_MANAGER role permissions', () => {
  it('is campus-scoped by convention', () => {
    expect(CAMPUS_SCOPED_ROLES).toContain('BRANCH_MANAGER')
  })

  it('has ADMIN-equivalent operational access', () => {
    expect(checkPermission('BRANCH_MANAGER', 'students', 'delete')).toBe(true)
    expect(checkPermission('BRANCH_MANAGER', 'teachers', 'create')).toBe(true)
    expect(checkPermission('BRANCH_MANAGER', 'admissions', 'approve')).toBe(true)
  })

  it('cannot manage user accounts or edit campus records', () => {
    expect(checkPermission('BRANCH_MANAGER', 'users', 'create')).toBe(false)
    expect(checkPermission('BRANCH_MANAGER', 'users', 'update')).toBe(false)
    expect(checkPermission('BRANCH_MANAGER', 'users', 'delete')).toBe(false)
    expect(checkPermission('BRANCH_MANAGER', 'campuses', 'update')).toBe(false)
    expect(checkPermission('BRANCH_MANAGER', 'campuses', 'create')).toBe(false)
  })
})

describe('MARKETING role permissions', () => {
  it('can manage Leads/Admissions only', () => {
    expect(checkPermission('MARKETING', 'admissions', 'create')).toBe(true)
    expect(checkPermission('MARKETING', 'admissions', 'read')).toBe(true)
    expect(checkPermission('MARKETING', 'admissions', 'update')).toBe(true)
    expect(checkPermission('MARKETING', 'admissions', 'export')).toBe(true)
    expect(checkPermission('MARKETING', 'admissions', 'delete')).toBe(false)
    expect(checkPermission('MARKETING', 'admissions', 'approve')).toBe(false)
  })

  it('has no visibility into finance or enrolled students', () => {
    expect(getAllowedActions('MARKETING', 'students')).toEqual([])
    expect(getAllowedActions('MARKETING', 'fees')).toEqual([])
    expect(getAllowedActions('MARKETING', 'expenses')).toEqual([])
  })
})

describe('normalizeRole handles the new roles', () => {
  it.each([
    ['SECRETARY', 'SECRETARY'],
    ['secretary', 'SECRETARY'],
    ['BRANCH_MANAGER', 'BRANCH_MANAGER'],
    ['Branch Manager', 'BRANCH_MANAGER'],
    ['MARKETING', 'MARKETING'],
    ['marketing', 'MARKETING'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected)
  })
})
