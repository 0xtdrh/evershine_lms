/**
 * FIN-2 budgets — a monthly amount per expense category, for one branch or the whole company (campusId null),
 * compared with what was actually spent (expenses of that month; a company budget counts every branch).
 * Branch people see their branches; company budgets need every place. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { loadPlaces } from '@/lib/places/server'
import { expenseCategories } from '@/lib/treasury/engine'

type Who = { id: string; role: string }
const num = (v: unknown) => Number(v ?? 0)
const r2 = (n: number) => Math.round(n * 100) / 100

export async function setBudget(user: Who, input: { year: number; month: number; campusId: string | null; categoryId: string; amount: number }) {
  const places = await loadPlaces(user)
  if (input.campusId ? !places.all && !places.campusIds.includes(input.campusId) : !places.all) throw new Error('This branch is not yours')
  const existing = await prisma.budget.findFirst({ where: { year: input.year, month: input.month, campusId: input.campusId, categoryId: input.categoryId } })
  if (input.amount <= 0) { if (existing) await prisma.budget.delete({ where: { id: existing.id } }); return null }
  return existing
    ? prisma.budget.update({ where: { id: existing.id }, data: { amount: input.amount } })
    : prisma.budget.create({ data: { year: input.year, month: input.month, campusId: input.campusId, categoryId: input.categoryId, amount: input.amount } })
}

/** Budget vs actual for one month and one scope (campusId null = company). */
export async function budgetVsActual(user: Who, year: number, month: number, campusId: string | null) {
  const places = await loadPlaces(user)
  if (campusId ? !places.all && !places.campusIds.includes(campusId) : !places.all) throw new Error('This branch is not yours')
  const cats = await expenseCategories(true)
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  const [budgets, expenses] = await Promise.all([
    prisma.budget.findMany({ where: { year, month, campusId } }),
    prisma.expense.findMany({ where: { isDeleted: false, date: { gte: from, lt: to }, ...(campusId ? { campusId } : {}) }, select: { amount: true, category: true, categoryId: true } }),
  ])
  const byKey = new Map(cats.map((c) => [c.key, c.id]))
  const actual = new Map<string, number>()
  for (const e of expenses) {
    const id = e.categoryId ?? byKey.get(e.category) ?? null
    if (id) actual.set(id, (actual.get(id) ?? 0) + num(e.amount))
  }
  const rows = cats.filter((c) => c.isActive || budgets.some((b) => b.categoryId === c.id) || actual.has(c.id)).map((c) => {
    const budget = num(budgets.find((b) => b.categoryId === c.id)?.amount)
    const spent = r2(actual.get(c.id) ?? 0)
    const pct = budget > 0 ? Math.round((spent / budget) * 100) : null
    return { categoryId: c.id, nameEn: c.nameEn, nameAr: c.nameAr, budget, actual: spent, pct, status: pct === null ? (spent > 0 ? 'NO_BUDGET' : 'NONE') : pct > 100 ? 'OVER' : pct >= 90 ? 'NEAR' : 'OK' }
  })
  const totals = rows.reduce((t, r) => ({ budget: t.budget + r.budget, actual: t.actual + r.actual }), { budget: 0, actual: 0 })
  return { year, month, campusId, rows, totals: { budget: r2(totals.budget), actual: r2(totals.actual) } }
}

/** How many budget lines this month are already over (for "your work today"). */
export async function overBudgetCount(user: Who): Promise<number> {
  const places = await loadPlaces(user)
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  const scopes: (string | null)[] = places.all ? [null, ...(await prisma.budget.findMany({ where: { year: y, month: m, campusId: { not: null } }, select: { campusId: true }, distinct: ['campusId'] })).map((b) => b.campusId)] : places.campusIds
  let n = 0
  for (const s of scopes) {
    if (!(await prisma.budget.count({ where: { year: y, month: m, campusId: s } }))) continue
    n += (await budgetVsActual(user, y, m, s)).rows.filter((r) => r.status === 'OVER').length
  }
  return n
}
