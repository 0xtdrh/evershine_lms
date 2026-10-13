/**
 * GET /api/accountant/fees/pending-proofs
 * Returns all fee invoices with proofStatus === 'PENDING' scoped to accountant's campus.
 * Admins/Super Admins see all campuses.
 */

import { invoiceWhere, requestPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  if (!checkPermission(session.user.role, 'fee_collection', 'read')) {
    return errors.forbidden()
  }

  // M0: proofs of invoices in the person's places
  const places = await requestPlaces(session.user)

  const invoices = await prisma.feeInvoice.findMany({
    where: {
      proofStatus: 'PENDING',
      status: { notIn: ['PAID', 'CANCELLED'] },
      ...invoiceWhere(places),
    },
    select: {
      id: true,
      challanNumber: true,
      month: true,
      academicYear: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      proofUrl: true,
      proofRemarks: true,
      proofUploadedAt: true,
      proofStatus: true,
      dueDate: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          registrationNumber: true,
          fatherName: true,
          campus: { select: { name: true } },
          class: { select: { name: true, grade: true } },
        },
      },
    },
    orderBy: { proofUploadedAt: 'asc' }, // Oldest first — FIFO queue
  })

  return successResponse(invoices)
}
