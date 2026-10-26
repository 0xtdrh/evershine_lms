/**
 * PATCH /api/accountant/fees/invoices/[invoiceId]
 * Updates invoice status directly (e.g. marking overdue, or cancelled).
 */

import { canSeeInvoice } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { closedMonthMessage } from '@/lib/month-close/guard'
import { updateInvoiceStatusSchema } from '@/lib/validation/accountant-fee'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function PATCH_(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'fee_collection', 'update')) {
    return errors.forbidden()
  }

  const { invoiceId } = await params

  const existing = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, totalAmount: true, studentId: true, classSectionId: true, createdAt: true, student: { select: { campusId: true, dueAmount: true } } },
  })

  if (!existing) return errors.notFound('Invoice not found')

  // M0: invoices of the person's places only
  if (!(await canSeeInvoice(session.user, invoiceId))) {
    return errors.forbidden('Cannot modify an invoice outside your places')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON body' }] } as never)
  }

  const parsed = updateInvoiceStatusSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const data = parsed.data

  // a03: an invoice made in a closed month keeps its status
  if (data.status !== existing.status) {
    const closed = await closedMonthMessage('FeeInvoice', existing)
    if (closed) return errors.monthLocked(closed)
  }

  // State machine enforcement
  if (existing.status === 'PAID') {
    return errors.conflict('INVOICE_ALREADY_PAID: Cannot change status of a fully paid invoice.')
  }

  const updated = await prisma.$transaction(async (tx) => {
    // If cancelling, deduct from the student's due amount without allowing negative dues.
    if (data.status === 'CANCELLED' && existing.status !== 'CANCELLED') {
      const remainingStudentDue = Math.max(0, Number(existing.student.dueAmount) - Number(existing.totalAmount))
      await tx.student.update({
        where: { id: existing.studentId },
        data: { dueAmount: remainingStudentDue },
      })
    }
    // If changing from CANCELLED to ISSUED, re-add
    if (existing.status === 'CANCELLED' && data.status !== 'CANCELLED') {
      await tx.student.update({
        where: { id: existing.studentId },
        data: { dueAmount: { increment: existing.totalAmount } },
      })
    }

    const inv = await tx.feeInvoice.update({
      where: { id: invoiceId },
      data: {
        status: data.status,
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE',
        entityType: 'FeeInvoice',
        entityId: invoiceId,
        changes: data,
      },
    })

    return inv
  })

  return successResponse(updated, `Invoice marked as ${data.status}`)
}

// a03: a write into a closed month answers 409 with the reason
export const PATCH = withMonthLock(PATCH_)
