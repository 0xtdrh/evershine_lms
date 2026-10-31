/**
 * a04 daily cash-close sheet — gathers one Cairo day of an account (or of every account the person sees) and runs
 * the pure maths (lib/treasury/daily-sheet-calc.ts, rules explained there). Read-only; places + treasury:read.
 * Who counted / approved and when are names + times from the CashCount row (the electronic signature); the printed
 * sheet adds hand-signature lines.
 */

import { prisma } from '@/lib/prisma'
import { cairoDateTimeToUtc } from '@/lib/dates/cairo'
import { syncMovements } from './sync'
import { TreasuryError, visibleAccountWhere } from './engine'
import { buildSheet, sheetTotals, type DailySheet, type SheetCount } from './daily-sheet-calc'

type Who = { id: string; role: string }
const num = (v: unknown) => Number(v ?? 0)
const DAY = /^\d{4}-\d{2}-\d{2}$/
const shift = (day: string, n: number) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

/** [start, end) of a Cairo day as real moments. */
function dayBounds(day: string) {
  return { from: cairoDateTimeToUtc(day, '00:00'), to: cairoDateTimeToUtc(shift(day, 1), '00:00') }
}

async function peopleNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, email: true, admin: { select: { firstName: true, lastName: true } }, teacher: { select: { firstName: true, lastName: true } } },
  })
  return new Map(users.map((u) => {
    const p = u.admin ?? u.teacher
    return [u.id, p ? `${p.firstName} ${p.lastName}`.trim() : u.email]
  }))
}

export interface AccountSheet extends DailySheet {
  account: { id: string; name: string; kind: string; campus: string | null }
  date: string
}

async function sheetsFor(accounts: { id: string; name: string; kind: string; campusId: string | null; openingBalance: unknown; openingDate: Date }[], day: string): Promise<AccountSheet[]> {
  if (!accounts.length) return []
  const ids = accounts.map((a) => a.id)
  const { from, to } = dayBounds(day)
  const dayDate = new Date(`${day}T00:00:00.000Z`)
  const yDate = new Date(`${shift(day, -1)}T00:00:00.000Z`)
  const [before, during, yCounts, counts, campuses] = await Promise.all([
    // the books before the day: movements from the account's opening date up to the start of the day
    prisma.moneyMovement.groupBy({ by: ['accountId', 'direction'], where: { OR: accounts.map((a) => ({ accountId: a.id, date: { gte: a.openingDate, lt: from } })) }, _sum: { amount: true } }),
    prisma.moneyMovement.findMany({ where: { accountId: { in: ids }, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } }),
    prisma.cashCount.findMany({ where: { accountId: { in: ids }, date: yDate, status: 'APPROVED' }, orderBy: { createdAt: 'desc' } }),
    prisma.cashCount.findMany({ where: { accountId: { in: ids }, date: dayDate, status: { not: 'REJECTED' } }, orderBy: { createdAt: 'desc' } }),
    prisma.campus.findMany({ where: { id: { in: accounts.map((a) => a.campusId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ])
  const names = await peopleNames(counts.flatMap((c) => [c.countedById, c.approvedById ?? '']))
  const campusName = new Map(campuses.map((c) => [c.id, c.name]))
  const sumOf = (rows: typeof before, id: string, dir: string) => num(rows.find((r) => r.accountId === id && r.direction === dir)?._sum.amount)
  return accounts.map((a) => {
    const startsLater = a.openingDate >= to
    const computedOpening = startsLater ? 0 : num(a.openingBalance) + sumOf(before, a.id, 'IN') - sumOf(before, a.id, 'OUT')
    const y = yCounts.find((c) => c.accountId === a.id)
    const c = counts.find((x) => x.accountId === a.id)
    const count: SheetCount | null = c ? {
      id: c.id, counted: num(c.counted), expected: num(c.expected), difference: num(c.difference), status: c.status,
      countedBy: names.get(c.countedById) ?? '—', countedAt: c.createdAt, approvedBy: c.approvedById ? names.get(c.approvedById) ?? '—' : null,
      approvedAt: c.approvedAt, note: c.note,
    } : null
    const sheet = buildSheet({
      computedOpening,
      yesterdayCount: y ? { id: y.id, counted: num(y.counted) } : null,
      dayMovements: during.filter((m) => m.accountId === a.id && m.date >= a.openingDate).map((m) => ({ id: m.id, direction: m.direction, amount: num(m.amount), date: m.date, kind: m.kind, method: m.method, note: m.note, cashCountId: m.cashCountId })),
      count,
    })
    return { ...sheet, account: { id: a.id, name: a.name, kind: a.kind, campus: a.campusId ? campusName.get(a.campusId) ?? '' : null }, date: day }
  })
}

const KIND_ORDER = ['CASH', 'BANK', 'INSTAPAY', 'EWALLET', 'GATEWAY', 'OTHER']

/** Every account the person sees on a day — cash boxes first (owner). */
export async function dailySheets(user: Who, day: string, opts: { campusId?: string | null } = {}) {
  if (!DAY.test(day)) throw new TreasuryError('Pick a day')
  await syncMovements(true)
  const accounts = await prisma.moneyAccount.findMany({
    where: { isActive: true, ...(await visibleAccountWhere(user)), ...(opts.campusId ? { campusId: opts.campusId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  accounts.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  const sheets = await sheetsFor(accounts, day)
  return { date: day, sheets, totals: sheetTotals(sheets) }
}

/** One account's sheet (the detail page). */
export async function dailySheet(user: Who, accountId: string, day: string): Promise<AccountSheet> {
  if (!DAY.test(day)) throw new TreasuryError('Pick a day')
  const acc = await prisma.moneyAccount.findFirst({ where: { id: accountId, ...(await visibleAccountWhere(user)) } })
  if (!acc) throw new TreasuryError('Account not found in your places')
  await syncMovements(true)
  return (await sheetsFor([acc], day))[0]
}
