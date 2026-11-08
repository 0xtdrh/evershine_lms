/**
 * Owner rule (2026-10-24): instructors never see invoices or money. Staff without fees:read get student and group
 * records with the money taken out. Families keep theirs (their own portal rules apply).
 */

import { checkPermission } from '@/lib/rbac'

const PORTAL = ['STUDENT', 'PARENT', 'GUARDIAN']
export const seesFees = (role: string) => PORTAL.includes(role) || checkPermission(role as never, 'fees', 'read')

const FEE_FIELDS = ['totalFeeAmount', 'paidAmount', 'dueAmount', 'feeStatus'] as const
export function withoutFeeFields<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>
  for (const f of FEE_FIELDS) delete out[f]
  return out as T
}

/** These reasons on an enrollment say the student has not paid. */
export const PAYMENT_REASONS = ['PAYMENT_OVERDUE_WARNING', 'UNPAID_AUTO']
