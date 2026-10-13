/**
 * GET /api/accountant/fees/export/paid
 * Streams an Excel export of PAID invoices.
 */

import { invoiceWhere, narrow } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { feeExportPaidSchema } from '@/lib/validation/accountant-fee'
import { buildPaidListReport } from '@/lib/excel/fee-lists'
import type { InvoiceStatus } from '@prisma/client'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  if (!checkPermission(session.user.role, 'fee_collection', 'export')) {
    return errors.forbidden('Only finance staff can export fee reports')
  }


  const { searchParams } = new URL(request.url)
  const parsed = feeExportPaidSchema.passthrough().safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return errors.validation(parsed.error)

  const { month, academicYear, campusId: queryCampusId, classId } = parsed.data

  // M0: invoices of the person's places (the place filter can only narrow)
  const places = narrow(await requestPlaces(session.user), queryCampusId)
  const collectedStatuses: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE']

  const invoices = await prisma.feeInvoice.findMany({
    where: {
      // Paid reports are based on collected payments, not only the invoice's
      // final status. This includes valid partial payments and legacy invoices
      // whose denormalized status was not updated after payment reconciliation.
      status: { in: collectedStatuses },
      OR: [
        { paidAmount: { gt: 0 } },
        { payments: { some: { status: 'COMPLETED' } } },
      ],
      ...(month ? { month } : {}),
      ...(academicYear ? { academicYear } : {}),
      ...invoiceWhere(places),
      ...(classId ? { student: { classId } } : {}),
    },
    include: {
      student: { include: { class: true, campus: { select: { name: true } } } },
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const workbook = await buildPaidListReport(invoices, month)
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = Buffer.from(buffer)
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="paid-fees-${month?.replace(' ', '-') || 'all'}.xlsx"`,
    },
  })
}
