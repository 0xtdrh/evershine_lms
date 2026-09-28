/**
 * Phase 2 of the Permissions work moved hardcoded role lists into the RBAC
 * matrix. These tests pin the defaults to the role lists the routes used
 * before, so moving a route never changes who can use it (only a saved
 * override on the Permissions page may).
 */
import { describe, expect, it } from 'vitest'
import { checkPermission, DEFAULT_PERMISSION_MATRIX, type AcademicResource, type Action } from '@/lib/rbac'

const ROLES = Object.keys(DEFAULT_PERMISSION_MATRIX)

function allowedRoles(resource: AcademicResource, action: Action) {
  return ROLES.filter((role) => checkPermission(role, resource, action)).sort()
}

const FINANCE = ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN']
const ADMINS = ['ADMIN', 'SUPER_ADMIN']

const EXPECTED: Array<[AcademicResource, Action, string[], string]> = [
  ['expenses', 'read', FINANCE, 'accountant/expenses GET, columns, [id] GET'],
  ['expenses', 'create', FINANCE, 'accountant/expenses POST'],
  ['expenses', 'update', FINANCE, 'accountant/expenses/[id] PATCH'],
  ['expenses', 'delete', FINANCE, 'accountant/expenses/[id] DELETE'],
  ['expenses', 'export', FINANCE, 'accountant/expenses/export'],
  ['fee_collection', 'read', FINANCE, 'accountant/fees/pending-proofs'],
  ['fee_collection', 'create', FINANCE, 'accountant/fees/invoices POST, payments POST'],
  ['fee_collection', 'update', FINANCE, 'accountant/fees/invoices/[id] PATCH, proof PATCH'],
  ['fee_collection', 'export', FINANCE, 'accountant/fees/export/*'],
  ['profit_loss', 'read', ['ACCOUNTANT', 'ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'], 'accountant/profit-loss GET'],
  ['profit_loss', 'create', ['ACCOUNTANT', 'ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'], 'accountant/profit-loss POST'],
  ['profit_loss', 'update', FINANCE, 'accountant/profit-loss/[id]/regenerate'],
  ['profit_loss', 'delete', FINANCE, 'accountant/profit-loss/[id] DELETE'],
  ['financial_reports', 'read', FINANCE, 'accountant/reports/expense-ledger'],
  ['salaries', 'read', FINANCE, 'accountant/salary-slips GET (all slips), [id] GET'],
  ['salaries', 'create', FINANCE, 'accountant/salary-slips POST'],
  ['salaries', 'update', FINANCE, 'accountant/salary-slips/[id] PATCH'],
  ['salaries', 'delete', FINANCE, 'accountant/salary-slips/[id] DELETE'],
  ['salaries', 'approve', ADMINS, 'salaries GET all/getStaff, POST, [id] PUT/DELETE, authorize'],
]

describe('Phase 2 defaults match the previously hardcoded role lists', () => {
  it.each(EXPECTED)('%s:%s -> %j (%s)', (resource, action, roles) => {
    expect(allowedRoles(resource, action)).toEqual([...roles].sort())
  })
})
