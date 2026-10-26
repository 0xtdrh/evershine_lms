/**
 * The P&L numbers for a period and one place (null = company) — ONE function for "make a P&L statement", "regenerate"
 * and the monthly financial report (a03, 2026-10-26), so they never disagree again (regenerate used to forget refunds).
 * Income = payments received in the period − refunds approved in the period (cash back and wallet credit alike; wallet
 * money comes back as income when it is spent). Expenses = approved expenses dated in the period + the salary slips OF
 * the period (owner 2026-10-26: a salary belongs to its salary month, not to the day the slip was last edited), not
 * cancelled / rejected / deleted. Server-only.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { expenseCategoryNamer } from '@/lib/treasury/expense-category'

const num = (v: unknown) => Number(v ?? 0)

/** Users who work in a place (any staff role's profile). */
export async function staffUserIdsOf(campusId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { teacher: { campusId } }, { admin: { campusId } }, { accountant: { campusId } },
        { branchManager: { campusId } }, { secretary: { campusId } }, { marketingStaff: { campusId } },
      ],
    },
    select: { id: true },
  })
  return rows.map((u) => u.id)
}

export function salaryWhereFor(start: Date, end: Date): Prisma.SalarySlipWhereInput {
  return { isDeleted: false, status: { not: 'CANCELLED' }, approvalStatus: { not: 'REJECTED' }, salaryPeriodStart: { gte: start, lte: end } }
}

export async function plTotals(start: Date, end: Date, campusId: string | null) {
  const feeWhere: Prisma.FeePaymentWhereInput = {
    status: { equals: 'COMPLETED' },
    paymentDate: { gte: start, lte: end },
    ...(campusId ? { student: { is: { campusId } } } : {}),
  }
  const expenseWhere: Prisma.ExpenseWhereInput = {
    isDeleted: false,
    isApproved: true,
    date: { gte: start, lte: end },
    ...(campusId ? { campusId } : {}),
  }
  let salaryWhere = salaryWhereFor(start, end)
  if (campusId) salaryWhere = { ...salaryWhere, employeeId: { in: await staffUserIdsOf(campusId) } }
  const refundWhere: Prisma.RefundWhereInput = {
    status: 'APPROVED',
    approvedAt: { gte: start, lte: end },
    ...(campusId ? { studentId: { in: (await prisma.student.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id) } } : {}),
  }

  const [feeAgg, expenseAgg, salaryAgg, refundAgg] = await Promise.all([
    prisma.feePayment.aggregate({ where: feeWhere, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
    prisma.salarySlip.aggregate({ where: salaryWhere, _sum: { netSalary: true } }),
    prisma.refund.aggregate({ where: refundWhere, _sum: { amount: true } }),
  ])

  const feeItems = await prisma.feePayment.findMany({
    where: feeWhere,
    select: { id: true, amount: true, paymentDate: true, paymentMethod: true },
    take: 1000,
  })
  const namer = await expenseCategoryNamer()
  const expenseItems = (await prisma.expense.findMany({
    where: expenseWhere,
    select: { id: true, title: true, category: true, categoryId: true, amount: true, date: true },
    take: 1000,
  })).map(({ categoryId, ...e }) => { const n = namer({ categoryId, category: e.category }); return { ...e, category: n.en, categoryAr: n.ar } })

  const income = num(feeAgg._sum.amount), refunds = num(refundAgg?._sum.amount), salaries = num(salaryAgg._sum.netSalary), expenses = num(expenseAgg._sum.amount)
  return {
    income, refunds, expenses, salaries,
    totalIncome: income - refunds,
    totalExpenses: expenses + salaries,
    feeItems, expenseItems,
  }
}
