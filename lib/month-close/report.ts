/**
 * a03 — the monthly financial report for one month and one place (null = whole company). Headline numbers come from
 * lib/finance/pnl-totals.ts (same as a P&L statement); the rest explains them: income by payment method / branch,
 * refunds, expenses per category, salaries (paid / not yet), invoices made in the month and what is still owed, wallet
 * money (prepaid by families — not income yet), partner payments, budget, account balances at the month's end, and a
 * comparison with the month before. When a month is closed its report is frozen in MonthLock.snapshot. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { plTotals, salaryWhereFor, staffUserIdsOf } from '@/lib/finance/pnl-totals'
import { expenseCategoryNamer } from '@/lib/treasury/expense-category'
import { syncMovements } from '@/lib/treasury/sync'
import { prepaidTotal } from '@/lib/wallet/engine'
import { addMonths, monthRange } from './rules'

const num = (v: unknown) => Number(v ?? 0)
const r2 = (n: number) => Math.round(n * 100) / 100
type Line = { key: string; en: string; ar: string; amount: number; count?: number }

export interface MonthReport {
  ym: string
  campusId: string | null
  placeName: string | null
  generatedAt: string
  totals: { income: number; refunds: number; netIncome: number; expenses: number; salaries: number; totalCosts: number; profit: number }
  previous: { ym: string; netIncome: number; totalCosts: number; profit: number }
  incomeByMethod: Line[]
  incomeBySource: Line[]
  incomeByBranch: Line[]
  refunds: { cash: number; wallet: number; count: number }
  expensesByCategory: Line[]
  salaries: { count: number; total: number; paid: number; unpaid: number }
  invoices: { count: number; total: number; discount: number; collected: number; stillDue: number; cancelled: number }
  receivablesNow: number
  wallet: { topUps: number; withdrawals: number; prepaidNow: number }
  partners: { received: number; paid: number }
  budget: { budget: number; actual: number } | null
  accounts: { id: string; name: string; kind: string; balance: number }[]
}

const SOURCE: Record<string, [string, string]> = {
  STAFF: ['At the office', 'في المكتب'], PROOF: ['Receipt sent by the family', 'إيصال من ولي الأمر'],
  ONLINE: ['Online', 'أونلاين'], WALLET: ['From the wallet balance', 'من رصيد المحفظة'],
}

function sumBy<T>(rows: T[], key: (r: T) => string, amount: (r: T) => number) {
  const m = new Map<string, { amount: number; count: number }>()
  for (const r of rows) { const k = key(r); const c = m.get(k) ?? { amount: 0, count: 0 }; c.amount += amount(r); c.count++; m.set(k, c) }
  return [...m.entries()].map(([k, v]) => ({ key: k, amount: r2(v.amount), count: v.count })).sort((a, b) => b.amount - a.amount)
}

/** Just the headline numbers (used for the month before). */
export async function monthTotals(ym: string, campusId: string | null) {
  const { from, to } = monthRange(ym)
  const t = await plTotals(from, new Date(to.getTime() - 1), campusId)
  return { income: r2(t.income), refunds: r2(t.refunds), netIncome: r2(t.totalIncome), expenses: r2(t.expenses), salaries: r2(t.salaries), totalCosts: r2(t.totalExpenses), profit: r2(t.totalIncome - t.totalExpenses) }
}

export async function monthReport(ym: string, campusId: string | null): Promise<MonthReport> {
  const { from, to } = monthRange(ym)
  const end = new Date(to.getTime() - 1)
  const inMonth = { gte: from, lte: end }
  const studentIds = campusId ? (await prisma.student.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id) : null
  const forStudents = studentIds ? { studentId: { in: studentIds.length ? studentIds : ['__none__'] } } : {}
  const invoicePlace = campusId ? { OR: [{ classSection: { campusId } }, { classSectionId: null, student: { campusId } }] } : {}

  await syncMovements(true).catch(() => 0)
  const [totals, previous, place, payments, refunds, namer, expenses, slips, invoices, receivable, topUps, withdrawals, prepaidNow, partnerPays, budgets, accounts] = await Promise.all([
    monthTotals(ym, campusId),
    monthTotals(addMonths(ym, -1), campusId),
    campusId ? prisma.campus.findUnique({ where: { id: campusId }, select: { name: true } }) : null,
    prisma.feePayment.findMany({
      where: { status: 'COMPLETED', paymentDate: inMonth, ...(campusId ? { student: { is: { campusId } } } : {}) },
      select: { amount: true, paymentMethod: true, source: true, student: { select: { campus: { select: { id: true, name: true } } } } },
    }),
    prisma.refund.findMany({ where: { status: 'APPROVED', approvedAt: inMonth, ...forStudents }, select: { amount: true, method: true } }),
    expenseCategoryNamer(),
    prisma.expense.findMany({ where: { isDeleted: false, isApproved: true, date: inMonth, ...(campusId ? { campusId } : {}) }, select: { amount: true, category: true, categoryId: true } }),
    (async () => prisma.salarySlip.findMany({
      where: { ...salaryWhereFor(from, end), ...(campusId ? { employeeId: { in: await staffUserIdsOf(campusId) } } : {}) },
      select: { netSalary: true, status: true },
    }))(),
    prisma.feeInvoice.findMany({ where: { createdAt: inMonth, ...invoicePlace }, select: { totalAmount: true, discount: true, paidAmount: true, refundedAmount: true, status: true } }),
    prisma.feeInvoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lte: end }, ...invoicePlace }, select: { totalAmount: true, paidAmount: true } }),
    prisma.walletTopUp.aggregate({ where: { status: 'APPROVED', approvedAt: inMonth, source: { not: 'PAYMENT' }, ...forStudents }, _sum: { amount: true } }),
    prisma.walletWithdrawal.aggregate({ where: { status: 'APPROVED', approvedAt: inMonth, ...forStudents }, _sum: { amount: true } }),
    prepaidTotal(campusId),
    prisma.partnerStatementPayment.findMany({ where: { paidAt: inMonth, ...(campusId ? { statement: { campusId } } : {}) }, select: { amount: true, direction: true } }),
    (() => { const [y, m] = ym.split('-').map(Number); return prisma.budget.aggregate({ where: { year: y, month: m, campusId }, _sum: { amount: true }, _count: true }) })(),
    prisma.moneyAccount.findMany({ where: { isActive: true, openingDate: { lte: end }, ...(campusId ? { campusId } : {}) }, select: { id: true, name: true, kind: true, openingBalance: true, openingDate: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  ])

  const accountRows = await Promise.all(accounts.map(async (a) => {
    const g = await prisma.moneyMovement.groupBy({ by: ['direction'], where: { accountId: a.id, date: { gte: a.openingDate, lte: end } }, _sum: { amount: true } })
    const bal = num(a.openingBalance) + num(g.find((x) => x.direction === 'IN')?._sum.amount) - num(g.find((x) => x.direction === 'OUT')?._sum.amount)
    return { id: a.id, name: a.name, kind: a.kind, balance: r2(bal) }
  }))

  const live = invoices.filter((i) => i.status !== 'CANCELLED')
  return {
    ym, campusId, placeName: place?.name ?? null, generatedAt: new Date().toISOString(),
    totals,
    previous: { ym: addMonths(ym, -1), netIncome: previous.netIncome, totalCosts: previous.totalCosts, profit: previous.profit },
    incomeByMethod: sumBy(payments, (p) => p.paymentMethod, (p) => num(p.amount)).map((x) => ({ ...x, en: x.key, ar: x.key })),
    incomeBySource: sumBy(payments, (p) => p.source ?? 'STAFF', (p) => num(p.amount)).map((x) => ({ ...x, en: SOURCE[x.key]?.[0] ?? x.key, ar: SOURCE[x.key]?.[1] ?? x.key })),
    incomeByBranch: campusId ? [] : sumBy(payments, (p) => p.student?.campus?.name ?? '—', (p) => num(p.amount)).map((x) => ({ ...x, en: x.key, ar: x.key })),
    refunds: {
      cash: r2(refunds.filter((r) => r.method !== 'WALLET').reduce((s, r) => s + num(r.amount), 0)),
      wallet: r2(refunds.filter((r) => r.method === 'WALLET').reduce((s, r) => s + num(r.amount), 0)),
      count: refunds.length,
    },
    expensesByCategory: sumBy(expenses.map((e) => ({ ...e, name: namer({ categoryId: e.categoryId, category: e.category }) })), (e) => `${e.name.en}\u0000${e.name.ar}`, (e) => num(e.amount))
      .map((x) => { const [en, ar] = x.key.split('\u0000'); return { ...x, key: en, en, ar } }),
    salaries: {
      count: slips.length,
      total: r2(slips.reduce((s, x) => s + num(x.netSalary), 0)),
      paid: r2(slips.filter((x) => x.status === 'PAID').reduce((s, x) => s + num(x.netSalary), 0)),
      unpaid: r2(slips.filter((x) => x.status !== 'PAID').reduce((s, x) => s + num(x.netSalary), 0)),
    },
    invoices: {
      count: live.length,
      total: r2(live.reduce((s, i) => s + num(i.totalAmount), 0)),
      discount: r2(live.reduce((s, i) => s + num(i.discount), 0)),
      collected: r2(live.reduce((s, i) => s + num(i.paidAmount) - num(i.refundedAmount), 0)),
      stillDue: r2(live.reduce((s, i) => s + Math.max(0, num(i.totalAmount) - num(i.paidAmount)), 0)),
      cancelled: invoices.length - live.length,
    },
    receivablesNow: r2(receivable.reduce((s, i) => s + Math.max(0, num(i.totalAmount) - num(i.paidAmount)), 0)),
    wallet: { topUps: r2(num(topUps._sum.amount)), withdrawals: r2(num(withdrawals._sum.amount)), prepaidNow: prepaidNow },
    partners: {
      received: r2(partnerPays.filter((p) => p.direction === 'PARTNER_TO_TECHNOVA').reduce((s, p) => s + num(p.amount), 0)),
      paid: r2(partnerPays.filter((p) => p.direction === 'TECHNOVA_TO_PARTNER').reduce((s, p) => s + num(p.amount), 0)),
    },
    budget: budgets._count ? { budget: r2(num(budgets._sum.amount)), actual: totals.expenses } : null,
    accounts: accountRows,
  }
}
