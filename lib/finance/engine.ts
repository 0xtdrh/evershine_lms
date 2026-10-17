/**
 * FIN-3 — cash flow (money in / out per month + a 30-day forecast) and "where every pound went", from the money
 * movements (lib/treasury/sync.ts), limited to the person's places and the header place filter. Wallet money is shown
 * as what TechNova still owes families (prepaid, not earned yet). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { requestPlaces, campusWhere, invoiceWhere, type Places } from '@/lib/places/server'
import { syncMovements } from '@/lib/treasury/sync'
import { expenseCategoryNamer } from '@/lib/treasury/expense-category'
import { prepaidTotal } from '@/lib/wallet/engine'
import { cairoToday } from '@/lib/dates/cairo'
import { forecastNext30, monthlyFlow, monthsBack, wherePound, type Move } from './calc'

type Who = { id: string; role: string }
const num = (v: unknown) => Number(v ?? 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const DAY = 86_400_000

/** Who may open the cash-flow / where-the-money-went reports: financial reports, or approving in the treasury. */
export const canSeeFinance = (role: string) => checkPermission(role, 'financial_reports', 'read') || checkPermission(role, 'treasury', 'approve')

const moveWhere = (p: Places) => (p.all ? {} : campusWhere(p))

/** Balance now of the accounts in these places (company accounts only with every place). */
async function balanceNow(p: Places): Promise<number> {
  const accounts = await prisma.moneyAccount.findMany({ where: { isActive: true, ...(p.all ? {} : campusWhere(p)) }, select: { id: true, openingBalance: true, openingDate: true } })
  let total = 0
  for (const a of accounts) {
    const g = await prisma.moneyMovement.groupBy({ by: ['direction'], where: { accountId: a.id, date: { gte: a.openingDate } }, _sum: { amount: true } })
    total += num(a.openingBalance) + num(g.find((x) => x.direction === 'IN')?._sum.amount) - num(g.find((x) => x.direction === 'OUT')?._sum.amount)
  }
  return r2(total)
}

/** Unpaid invoice money due in the next 30 days, and already overdue. */
async function unpaid(p: Places) {
  const now = new Date(`${cairoToday()}T00:00:00.000Z`)
  const rows = await prisma.feeInvoice.findMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: new Date(now.getTime() + 31 * DAY) }, ...invoiceWhere(p) },
    select: { totalAmount: true, paidAmount: true, dueDate: true },
  })
  let dueSoon = 0, overdue = 0
  for (const i of rows) {
    const left = Math.max(0, num(i.totalAmount) - num(i.paidAmount))
    if (i.dueDate < now) overdue += left; else dueSoon += left
  }
  return { dueSoon: r2(dueSoon), overdue: r2(overdue) }
}

async function wallets(p: Places): Promise<number> {
  if (p.all) return prepaidTotal()
  const ids = (await prisma.student.findMany({ where: campusWhere(p), select: { id: true } })).map((s) => s.id)
  return ids.length ? prepaidTotal(null, ids) : 0
}

export async function cashflow(user: Who, opts: { months?: number; campusId?: string | null }) {
  await syncMovements(true)
  const p = await requestPlaces(user, opts.campusId)
  const n = Math.min(24, Math.max(1, opts.months ?? 6))
  const last = cairoToday().slice(0, 7)
  const months = monthsBack(last, Math.max(n, 4)) // at least 3 full months for the forecast
  const from = new Date(`${months[0]}-01T00:00:00.000Z`)
  const raw = await prisma.moneyMovement.findMany({ where: { ...moveWhere(p), date: { gte: from }, kind: { not: 'TRANSFER' } }, select: { date: true, direction: true, amount: true, kind: true } })
  const moves: Move[] = raw.map((m) => ({ ...m, amount: num(m.amount) }))
  const all = monthlyFlow(moves, months)
  // the forecast uses the last 3 FULL months (this month is not over)
  const pastOut = all.slice(0, -1).slice(-3).map((r) => r.out)
  const [bal, due, prepaid] = await Promise.all([balanceNow(p), unpaid(p), wallets(p)])
  return {
    months: monthlyFlow(moves, months.slice(-n)),
    forecast: forecastNext30({ ...due, pastOut, balanceNow: bal }),
    prepaid,
  }
}

/** 1 when the 30-day forecast of this person's places ends below zero (for "your work today"). */
export async function forecastNegativeCount(user: Who): Promise<number> {
  if (!canSeeFinance(user.role)) return 0
  if (!(await prisma.moneyAccount.count())) return 0 // no accounts yet → nothing to forecast
  const f = (await cashflow(user, { months: 1 })).forecast
  return f.basisMonths && f.balanceAfter < 0 ? 1 : 0
}

export async function whereMoney(user: Who, opts: { from?: string | null; to?: string | null; campusId?: string | null }) {
  await syncMovements(true)
  const p = await requestPlaces(user, opts.campusId)
  const today = cairoToday()
  const fromS = opts.from || `${today.slice(0, 7)}-01`
  const toS = opts.to || today
  const range = { gte: new Date(`${fromS}T00:00:00.000Z`), lt: new Date(new Date(`${toS}T00:00:00.000Z`).getTime() + DAY) }
  const raw = await prisma.moneyMovement.findMany({ where: { ...moveWhere(p), date: range, kind: { not: 'TRANSFER' } }, select: { direction: true, amount: true, kind: true, date: true, expenseId: true } })
  const expIds = raw.map((m) => m.expenseId).filter((x): x is string => !!x)
  const namer = await expenseCategoryNamer()
  const exps = new Map((expIds.length ? await prisma.expense.findMany({ where: { id: { in: expIds } }, select: { id: true, category: true, categoryId: true } }) : []).map((e) => [e.id, namer(e)]))
  const names = new Map<string, { en: string; ar: string }>()
  const moves: Move[] = raw.map((m) => {
    const n = m.expenseId ? exps.get(m.expenseId) : undefined
    if (n) names.set(n.en, n)
    return { date: m.date, direction: m.direction, amount: num(m.amount), kind: m.kind, category: n?.en ?? null }
  })
  const w = wherePound(moves)
  const [bal, prepaid, loose] = await Promise.all([
    balanceNow(p), wallets(p),
    prisma.moneyMovement.groupBy({ by: ['direction'], where: { accountId: null, ...moveWhere(p) }, _sum: { amount: true } }),
  ])
  const unplaced = r2(num(loose.find((x) => x.direction === 'IN')?._sum.amount) - num(loose.find((x) => x.direction === 'OUT')?._sum.amount))
  return {
    from: fromS, to: toS, ...w,
    out: w.out.map((l) => (l.category ? { ...l, categoryAr: names.get(l.category)?.ar ?? l.category } : l)),
    now: { balance: bal, prepaid, unplaced, free: r2(bal - prepaid) },
  }
}
