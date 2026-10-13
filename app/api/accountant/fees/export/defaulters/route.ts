/**
 * GET /api/accountant/fees/export/defaulters
 * Streams an Excel export of students with outstanding dues.
 */

import { invoiceWhere, narrow } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { feeExportDefaultersSchema } from '@/lib/validation/accountant-fee'
import { buildDefaulterListReport } from '@/lib/excel/fee-lists'
import { outstandingInvoiceAmount } from '@/lib/fees/reporting'
import type { InvoiceStatus } from '@prisma/client'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  if (!checkPermission(session.user.role, 'fee_collection', 'export')) {
    return errors.forbidden('Only finance staff can export fee reports')
  }


  const { searchParams } = new URL(request.url)
  const parsed = feeExportDefaultersSchema.passthrough().safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return errors.validation(parsed.error)

  const { academicYear, campusId: queryCampusId, classId } = parsed.data

  // M0: invoices of the person's places (the place filter can only narrow)
  const places = narrow(await requestPlaces(session.user), queryCampusId)

  // Include PAID for legacy/inconsistent invoices whose status was advanced
  // before the final payment summary was reconciled. The balance calculation
  // below still excludes rows with no outstanding amount.
  const unpaidStatuses: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID', 'PAID']
  const invoices = await prisma.feeInvoice.findMany({
    where: {
      status: { in: unpaidStatuses },
      ...(academicYear ? { academicYear } : {}),
      ...invoiceWhere(places),
      ...(classId ? { student: { classId } } : {}),
    },
    include: {
      student: {
        include: {
          campus: { select: { name: true } },
          class: true,
        },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const defaultersByStudent = new Map<string, {
    student: (typeof invoices)[number]['student']
    dueAmount: number
    invoices: (typeof invoices)[number][]
  }>()

  for (const invoice of invoices) {
    const dueAmount = outstandingInvoiceAmount(invoice.totalAmount, invoice.paidAmount, invoice.payments)
    if (dueAmount <= 0) continue

    const current = defaultersByStudent.get(invoice.studentId)
    if (current) {
      current.dueAmount += dueAmount
      current.invoices.push(invoice)
    } else {
      defaultersByStudent.set(invoice.studentId, {
        student: invoice.student,
        dueAmount,
        invoices: [invoice],
      })
    }
  }

  const defaulters = Array.from(defaultersByStudent.values())
    .sort((a, b) => b.dueAmount - a.dueAmount)
    .map(({ student, dueAmount, invoices: studentInvoices }) => ({
      ...student,
      dueAmount,
      invoices: studentInvoices,
    }))

  const workbook = await buildDefaulterListReport(defaulters)
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = Buffer.from(buffer)
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="fee-defaulters-${new Date().toISOString().split('T')[0]}.xlsx"`,
    },
  })
}
