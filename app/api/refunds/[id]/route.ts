/**
 * GET   /api/refunds/[id] — one refund (for its printable receipt)
 * PATCH /api/refunds/[id] { action: 'approve' | 'reject', reason? } — refunds:approve
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { approveRefund, canApproveRefunds, rejectRefund } from '@/lib/refunds/engine'
import { getFinanceSettings } from '@/lib/fees/payment-settings'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'refunds', 'read')) return errors.forbidden()
  const { id } = await params
  const r = await prisma.refund.findUnique({ where: { id } })
  if (!r) return errors.notFound('Refund')
  const [student, invoice, approver, settings] = await Promise.all([
    prisma.student.findUnique({ where: { id: r.studentId }, select: { firstName: true, lastName: true, registrationNumber: true } }),
    prisma.feeInvoice.findUnique({ where: { id: r.invoiceId }, select: { challanNumber: true, month: true, totalAmount: true, paidAmount: true, refundedAmount: true } }),
    r.approvedById ? prisma.user.findUnique({ where: { id: r.approvedById }, select: { email: true, displayName: true } }) : null,
    getFinanceSettings(),
  ])
  return successResponse({
    ...r,
    amount: Number(r.amount),
    suggestedAmount: Number(r.suggestedAmount),
    student,
    invoice: invoice && {
      ...invoice,
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      refundedAmount: Number(invoice.refundedAmount),
    },
    approvedBy: approver ? approver.displayName || approver.email : null,
    company: { companyName: settings.companyName, companyPhone: settings.companyPhone, companyAddress: settings.companyAddress, receiptPaper: settings.receiptPaper },
  })
}

const bodySchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional().nullable() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!canApproveRefunds(session.user.role)) return errors.forbidden('Only someone with refund approval can do this')
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = parsed.data.action === 'approve' ? await approveRefund(id, session.user.id) : await rejectRefund(id, session.user.id, parsed.data.reason)
  if ('message' in r) return errorResponse('REFUND_REFUSED', r.message, r.status)
  return successResponse(r)
}
