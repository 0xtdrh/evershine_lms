/**
 * GET /api/accountant/reports/expense-ledger
 *
 * Unified ledger of operational expenses and paid salary slips in chronological order.
 * Parameters:
 *   ?startDate&endDate&paymentSource&campusId&export=excel
 */

import { onePlace } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { buildLedgerReport, LedgerEntry } from '@/lib/excel/ledger-report'
import { getExpenseColumnSupport } from '@/lib/accounting/expense-columns'
import { cairoToday } from '@/lib/dates/cairo'

const querySchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  paymentSource: z.string().optional(),
  campusId: z.string().cuid().optional(),
  export: z.enum(['excel']).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()

    if (!checkPermission(session.user.role, 'financial_reports', 'read')) {
      return errors.forbidden('Only finance managers can access the unified ledger')
    }

    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return errors.validation(parsed.error)

    const { startDate, endDate, paymentSource, campusId: queryCampusId, export: exportType } = parsed.data

    // Campus restriction: Accountants must stay in their campus boundary
    // M0: one of the person's places (or the whole company for someone with every place)
    const targetCampusId = onePlace(await requestPlaces(session.user), queryCampusId)

    // Set date bounds
    const dateFilter = startDate && endDate
      ? { gte: new Date(startDate), lte: new Date(endDate) }
      : undefined

    // ─── 1. Query General Operational Expenses ────────────────────────────────

    const supportedExpenseColumns = await getExpenseColumnSupport()
    const expenseWhere: Prisma.ExpenseWhereInput = {
      isDeleted: false,
      ...(targetCampusId ? { campusId: targetCampusId } : {}),
      ...(paymentSource && supportedExpenseColumns.paymentSource ? { paymentSource: { contains: paymentSource } } : {}),
      ...(dateFilter ? { date: dateFilter } : {}),
    }

    const expenses = await prisma.expense.findMany({
      where: expenseWhere,
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        category: true,
        title: true,
        amount: true,
        ...(supportedExpenseColumns.paymentSource ? { paymentSource: true } : {}),
        ...(supportedExpenseColumns.paymentReference ? { paymentReference: true } : {}),
      },
    })

    // ─── 2. Query Paid Salary Slips ───────────────────────────────────────────

    const salaryWhere: Prisma.SalarySlipWhereInput = {
      isDeleted: false,
      status: 'PAID',
      ...(targetCampusId
        ? {
            employee: {
              OR: [
                { teacher: { campusId: targetCampusId } },
                { accountant: { campusId: targetCampusId } },
                { admin: { campusId: targetCampusId } },
              ],
            },
          }
        : {}),
      ...(paymentSource ? { paymentSource: { contains: paymentSource } } : {}),
      ...(dateFilter ? { updatedAt: dateFilter } : {}),
    }

    const salarySlips = await prisma.salarySlip.findMany({
      where: salaryWhere,
      orderBy: { updatedAt: 'asc' },
    })

    // ─── 3. Unify operational expenses and salary slips ────────────────────────

    const unifiedEntries: LedgerEntry[] = []

    // Map general expenses
    for (const exp of expenses) {
      unifiedEntries.push({
        date: exp.date,
        id: exp.id,
        type: 'OPERATIONAL_EXPENSE',
        category: exp.category,
        payee: exp.title,
        method: exp.paymentSource ?? 'Cash',
        reference: exp.paymentReference ?? '',
        amount: Number(exp.amount),
      })
    }

    // Map paid salary slips
    for (const slip of salarySlips) {
      unifiedEntries.push({
        date: slip.updatedAt,
        id: slip.id,
        type: 'SALARY',
        category: 'Salary',
        payee: slip.employeeName,
        method: slip.paymentSource ?? 'Cash',
        reference: slip.accountNumber ?? '',
        amount: Number(slip.netSalary),
      })
    }

    // Sort chronologically (ascending)
    unifiedEntries.sort((a, b) => a.date.getTime() - b.date.getTime())

    // ─── 4. Export or return JSON ─────────────────────────────────────────────

    if (exportType === 'excel') {
      const workbook = await buildLedgerReport(unifiedEntries, {
        start: startDate,
        end: endDate,
        paymentSource,
      })
      const buffer = await workbook.xlsx.writeBuffer()
      const bytes = Buffer.from(buffer)
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="unified_ledger-${cairoToday()}.xlsx"`,
        },
      })
    }

    return successResponse(unifiedEntries)
  } catch (err) {
    console.error('[EXPENSE_LEDGER_GET]', err)
    return errors.internal()
  }
}
