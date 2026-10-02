/**
 * GET  /api/refunds?status=&studentId= — refunds
 * POST /api/refunds — request a refund { invoiceId, amount, method CASH|WALLET, payoutMethod?, reason?, withdrawStudent? }
 *      refunds:create requests (PENDING); someone with refunds:approve is approved at once.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma, Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errorResponse, errors, successResponse } from '@/lib/api-response'
import { canApproveRefunds, requestRefund } from '@/lib/refunds/engine'
import { isActivePaymentMethod } from '@/lib/fees/payment-settings'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  method: z.enum(['CASH', 'WALLET']),
  payoutMethod: z.string().trim().max(50).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  withdrawStudent: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'refunds', 'read')) return errors.forbidden()
  const sp = new URL(request.url).searchParams
  const where: Prisma.RefundWhereInput = {}
  const status = sp.get('status')
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) where.status = status
  const studentId = sp.get('studentId')
  if (studentId) where.studentId = studentId
  const rows = await prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.approvedById]).filter(Boolean))] as string[]
  const [students, invoices, users] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }),
    prisma.feeInvoice.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.invoiceId))] } }, select: { id: true, challanNumber: true, month: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, displayName: true } }),
  ])
  const S = new Map(students.map((x) => [x.id, x]))
  const I = new Map(invoices.map((x) => [x.id, x]))
  const U = new Map(users.map((x) => [x.id, x.displayName || x.email]))
  return successResponse(
    rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      suggestedAmount: Number(r.suggestedAmount),
      student: S.get(r.studentId) ?? null,
      invoice: I.get(r.invoiceId) ?? null,
      requestedBy: U.get(r.requestedById) ?? null,
      approvedBy: r.approvedById ? U.get(r.approvedById) ?? null : null,
    }))
  )
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'refunds', 'create') && !canApproveRefunds(role)) return errors.forbidden()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  if (d.method === 'CASH' && d.payoutMethod && !(await isActivePaymentMethod(d.payoutMethod))) {
    return errors.badRequest('Unknown payment method. Choose one from the list.')
  }
  const r = await requestRefund({
    invoiceId: d.invoiceId!,
    amount: d.amount!,
    method: d.method!,
    payoutMethod: d.payoutMethod ?? null,
    reason: d.reason ?? null,
    withdrawStudent: !!d.withdrawStudent,
    userId: session.user.id,
    role,
  })
  if ('message' in r) return errorResponse('REFUND_REFUSED', r.message, r.status)
  return createdResponse(r, r.status === 'APPROVED' ? 'Refund approved' : 'Sent for approval')
}
