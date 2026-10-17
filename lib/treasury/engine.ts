/**
 * FIN-1 money accounts — accounts + balances, payment-method routes, movements, transfers (two people), end-of-day
 * cash counts (difference approved by a manager, small ones automatically), editable expense categories.
 * Places: a branch person sees the accounts of their branches; company accounts (no branch) only people with every place.
 * Permissions: treasury read / create (transfer, count) / approve / update (accounts, routes). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { loadPlaces } from '@/lib/places/server'
import { takeNumber } from '@/lib/ids/counter'
import { cairoToday } from '@/lib/dates/cairo'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { syncMovements } from './sync'
import { countOutcome, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_TREASURY_SETTINGS, type TreasurySettings } from './rules'

type Who = { id: string; role: string }
export class TreasuryError extends Error {}

const KEY = 'treasury.settings'
export const getTreasurySettings = () => getSetting<TreasurySettings>(KEY, DEFAULT_TREASURY_SETTINGS)
export async function saveTreasurySettings(v: Partial<TreasurySettings>, userId: string) {
  const next = { ...(await getTreasurySettings()), ...v }
  next.closeAfterHour = Math.min(23, Math.max(0, Math.round(next.closeAfterHour)))
  next.tolerance = Math.max(0, Number(next.tolerance) || 0)
  await setSetting(KEY, next, userId)
  return next
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => Number(v ?? 0)

/** Ids of the accounts this person may see (null = all). */
export async function visibleAccountWhere(user: Who) {
  const places = await loadPlaces(user)
  return places.all ? {} : { campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }
}

async function assertAccount(user: Who, id: string) {
  const acc = await prisma.moneyAccount.findFirst({ where: { id, ...(await visibleAccountWhere(user)) } })
  if (!acc) throw new TreasuryError('Account not found in your places')
  return acc
}

/** Balance of each account (opening + in − out from the opening date) — one query for all. */
async function balances(ids: string[], openings: Map<string, Date>): Promise<Map<string, { in: number; out: number }>> {
  const out = new Map<string, { in: number; out: number }>()
  if (!ids.length) return out
  const rows = await prisma.moneyMovement.findMany({ where: { accountId: { in: ids } }, select: { accountId: true, direction: true, amount: true, date: true } })
  for (const m of rows) {
    if (!m.accountId) continue
    const from = openings.get(m.accountId)
    if (from && m.date < from) continue
    const b = out.get(m.accountId) ?? { in: 0, out: 0 }
    if (m.direction === 'IN') b.in += num(m.amount); else b.out += num(m.amount)
    out.set(m.accountId, b)
  }
  return out
}

export async function accountsOverview(user: Who) {
  await syncMovements(true) // money pages show the balance as it is now (the sync is a few cheap queries)
  const where = await visibleAccountWhere(user)
  const accounts = await prisma.moneyAccount.findMany({ where, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] })
  const sums = await balances(accounts.map((a) => a.id), new Map(accounts.map((a) => [a.id, a.openingDate])))
  const campuses = new Map((await prisma.campus.findMany({ where: { id: { in: accounts.map((a) => a.campusId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const today = new Date(`${cairoToday()}T00:00:00.000Z`)
  const counts = await prisma.cashCount.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, date: today }, select: { accountId: true, status: true } })
  const places = await loadPlaces(user)
  const unplaced = await prisma.moneyMovement.groupBy({
    by: ['direction'], where: { accountId: null, ...(places.all ? {} : { campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }) }, _sum: { amount: true }, _count: { _all: true },
  })
  return {
    accounts: accounts.map((a) => {
      const s = sums.get(a.id) ?? { in: 0, out: 0 }
      return {
        id: a.id, name: a.name, kind: a.kind, campusId: a.campusId, campus: a.campusId ? campuses.get(a.campusId) ?? '' : null,
        openingBalance: num(a.openingBalance), openingDate: a.openingDate, isActive: a.isActive, notes: a.notes,
        in: r2(s.in), out: r2(s.out), balance: r2(num(a.openingBalance) + s.in - s.out),
        countedToday: counts.find((c) => c.accountId === a.id)?.status ?? null,
      }
    }),
    unplaced: {
      count: unplaced.reduce((n, u) => n + u._count._all, 0),
      in: r2(num(unplaced.find((u) => u.direction === 'IN')?._sum.amount)),
      out: r2(num(unplaced.find((u) => u.direction === 'OUT')?._sum.amount)),
    },
  }
}

export interface AccountInput { name: string; kind: string; campusId?: string | null; openingBalance?: number; openingDate?: string | null; isActive?: boolean; notes?: string | null; sortOrder?: number }

export async function saveAccount(user: Who, input: AccountInput, id?: string) {
  if (!checkPermission(user.role, 'treasury', 'update')) throw new TreasuryError('You cannot manage accounts')
  const places = await loadPlaces(user)
  if (input.campusId ? !places.all && !places.campusIds.includes(input.campusId) : !places.all) throw new TreasuryError('Choose one of your branches (company accounts need every place)')
  if (id) await assertAccount(user, id)
  const data = {
    name: input.name.trim().slice(0, 100), kind: input.kind, campusId: input.campusId || null,
    openingBalance: input.openingBalance ?? 0, openingDate: new Date(`${input.openingDate || cairoToday()}T00:00:00.000Z`),
    isActive: input.isActive ?? true, notes: input.notes?.slice(0, 300) || null, sortOrder: input.sortOrder ?? 0,
  }
  return id ? prisma.moneyAccount.update({ where: { id }, data }) : prisma.moneyAccount.create({ data })
}

// ── routes: payment method (+ branch) → account ───────────────────────────────────────────────────────────────

export async function listRoutes(user: Who) {
  const [methods, routes, accounts, places] = await Promise.all([
    prisma.paymentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { name: true } }),
    prisma.accountRoute.findMany({ select: { id: true, method: true, campusId: true, accountId: true } }),
    prisma.moneyAccount.findMany({ where: { isActive: true, ...(await visibleAccountWhere(user)) }, select: { id: true, name: true, campusId: true } }),
    loadPlaces(user),
  ])
  const extra = ['Cash', 'Bank Transfer'].filter((m) => !methods.some((x) => x.name === m))
  const campuses = await prisma.campus.findMany({ where: { isActive: true, ...(places.all ? {} : { id: { in: places.campusIds } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  return { methods: [...methods.map((m) => m.name), ...extra], campuses, accounts, routes: routes.filter((r) => places.all || (r.campusId && places.campusIds.includes(r.campusId))) }
}

export async function setRoute(user: Who, method: string, campusId: string | null, accountId: string | null) {
  if (!checkPermission(user.role, 'treasury', 'update')) throw new TreasuryError('You cannot manage accounts')
  const places = await loadPlaces(user)
  if (campusId ? !places.all && !places.campusIds.includes(campusId) : !places.all) throw new TreasuryError('This branch is not yours')
  if (accountId) await assertAccount(user, accountId)
  await prisma.accountRoute.deleteMany({ where: { method, campusId } })
  if (accountId) await prisma.accountRoute.create({ data: { method: method.slice(0, 50), campusId, accountId } })
  await syncMovements(true) // place movements that were waiting for this route
}

// ── movements ───────────────────────────────────────────────────────────────────────────────────────────────

export async function movements(user: Who, opts: { accountId?: string | null; unplaced?: boolean; from?: string | null; to?: string | null }) {
  await syncMovements(true)
  const places = await loadPlaces(user)
  const range = opts.from || opts.to ? { date: { ...(opts.from && { gte: new Date(`${opts.from}T00:00:00.000Z`) }), ...(opts.to && { lt: new Date(new Date(`${opts.to}T00:00:00.000Z`).getTime() + 86_400_000) }) } } : {}
  let where: Record<string, unknown>
  if (opts.unplaced) where = { accountId: null, ...(places.all ? {} : { campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }) }
  else if (opts.accountId) { await assertAccount(user, opts.accountId); where = { accountId: opts.accountId } }
  else where = { account: await visibleAccountWhere(user) }
  const rows = await prisma.moneyMovement.findMany({ where: { ...where, ...range }, orderBy: { date: 'desc' }, take: 1000, include: { account: { select: { name: true } } } })
  return rows.map((m) => ({ id: m.id, date: m.date, direction: m.direction, amount: num(m.amount), kind: m.kind, method: m.method, note: m.note, account: m.account?.name ?? null, campusId: m.campusId }))
}

// ── transfers ───────────────────────────────────────────────────────────────────────────────────────────────

async function accountBalance(id: string) {
  const a = await prisma.moneyAccount.findUnique({ where: { id } })
  if (!a) return 0
  const s = (await balances([id], new Map([[id, a.openingDate]]))).get(id) ?? { in: 0, out: 0 }
  return r2(num(a.openingBalance) + s.in - s.out)
}

export async function createTransfer(user: Who, input: { fromAccountId: string; toAccountId: string; amount: number; date?: string | null; note?: string | null }) {
  if (!checkPermission(user.role, 'treasury', 'create')) throw new TreasuryError('You cannot move money')
  if (input.fromAccountId === input.toAccountId) throw new TreasuryError('Choose two different accounts')
  if (!(input.amount > 0)) throw new TreasuryError('The amount must be more than 0')
  const from = await assertAccount(user, input.fromAccountId)
  await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.toAccountId } }) // the destination may be a company account (e.g. the bank)
  await syncMovements(true)
  if (from.kind === 'CASH' && (await accountBalance(from.id)) + 0.001 < input.amount) throw new TreasuryError('There is not that much in this cash box')
  const settings = await getTreasurySettings()
  const t = await prisma.$transaction(async (tx) => {
    const number = await takeNumber(tx, { prefix: `TN-TRF-${new Date().getFullYear()}-`, pad: 5, table: 'MoneyTransfer', column: 'number' })
    return tx.moneyTransfer.create({
      data: { number, fromAccountId: from.id, toAccountId: input.toAccountId, amount: input.amount, date: input.date ? new Date(`${input.date}T12:00:00.000Z`) : new Date(), note: input.note?.slice(0, 300) || null, status: settings.transferNeedsApproval ? 'PENDING' : 'APPROVED', createdById: user.id, ...(settings.transferNeedsApproval ? {} : { approvedById: user.id, approvedAt: new Date() }) },
    })
  })
  if (t.status === 'APPROVED') await postTransfer(t.id)
  else {
    const approvers = (await usersWithPermission('treasury', 'approve', from.campusId)).filter((x) => x !== user.id)
    await notifyUsers(approvers, 'TREASURY_APPROVAL', { title: `Transfer to approve: ${t.number}`, message: `${num(t.amount)} EGP`, titleAr: `تحويل مستني موافقتك: ${t.number}`, messageAr: `${num(t.amount)} ج.م`, relatedId: t.id })
  }
  return t
}

async function postTransfer(id: string) {
  const t = await prisma.moneyTransfer.findUniqueOrThrow({ where: { id } })
  const [from, to] = await Promise.all([prisma.moneyAccount.findUnique({ where: { id: t.fromAccountId } }), prisma.moneyAccount.findUnique({ where: { id: t.toAccountId } })])
  await prisma.moneyMovement.createMany({
    data: [
      { accountId: t.fromAccountId, direction: 'OUT', amount: t.amount, date: t.date, kind: 'TRANSFER', campusId: from?.campusId ?? null, note: `${t.number} → ${to?.name ?? ''}`, transferId: t.id },
      { accountId: t.toAccountId, direction: 'IN', amount: t.amount, date: t.date, kind: 'TRANSFER', campusId: to?.campusId ?? null, note: `${t.number} ← ${from?.name ?? ''}`, transferId: t.id },
    ],
  })
}

export async function decideTransfer(user: Who, id: string, action: 'approve' | 'reject' | 'cancel') {
  const t = await prisma.moneyTransfer.findUnique({ where: { id } })
  if (!t || t.status !== 'PENDING') throw new TreasuryError('Nothing to decide')
  await assertAccount(user, t.fromAccountId)
  if (action === 'cancel') {
    if (t.createdById !== user.id) throw new TreasuryError('Only the person who made it can cancel it')
  } else {
    if (!checkPermission(user.role, 'treasury', 'approve')) throw new TreasuryError('You cannot approve transfers')
    if (t.createdById === user.id && user.role !== 'SUPER_ADMIN') throw new TreasuryError('Another person must approve your transfer')
  }
  const status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'CANCELLED'
  const upd = await prisma.moneyTransfer.updateMany({ where: { id, status: 'PENDING' }, data: { status, approvedById: user.id, approvedAt: new Date() } })
  if (upd.count && status === 'APPROVED') await postTransfer(id)
}

export async function listTransfers(user: Who) {
  const where = await visibleAccountWhere(user)
  const ids = (await prisma.moneyAccount.findMany({ where, select: { id: true } })).map((a) => a.id)
  const rows = await prisma.moneyTransfer.findMany({ where: { OR: [{ fromAccountId: { in: ids } }, { toAccountId: { in: ids } }] }, orderBy: { createdAt: 'desc' }, take: 200 })
  const names = new Map((await prisma.moneyAccount.findMany({ where: { id: { in: rows.flatMap((r) => [r.fromAccountId, r.toAccountId]) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]))
  return rows.map((t) => ({ ...t, amount: num(t.amount), from: names.get(t.fromAccountId) ?? '', to: names.get(t.toAccountId) ?? '', mine: t.createdById === user.id }))
}

// ── end-of-day cash count ───────────────────────────────────────────────────────────────────────────────────

export async function createCount(user: Who, input: { accountId: string; counted: number; note?: string | null }) {
  if (!checkPermission(user.role, 'treasury', 'create')) throw new TreasuryError('You cannot count cash')
  const acc = await assertAccount(user, input.accountId)
  if (!(input.counted >= 0)) throw new TreasuryError('Write the amount you counted')
  await syncMovements(true)
  const expected = await accountBalance(acc.id)
  const settings = await getTreasurySettings()
  const { difference, autoApprove } = countOutcome(expected, input.counted, settings.tolerance)
  const c = await prisma.cashCount.create({
    data: { accountId: acc.id, date: new Date(`${cairoToday()}T00:00:00.000Z`), expected, counted: input.counted, difference, note: input.note?.slice(0, 300) || null, status: autoApprove ? 'APPROVED' : 'PENDING', countedById: user.id, ...(autoApprove ? { approvedById: user.id, approvedAt: new Date() } : {}) },
  })
  if (autoApprove) await postCount(c.id)
  else {
    const approvers = (await usersWithPermission('treasury', 'approve', acc.campusId)).filter((x) => x !== user.id)
    await notifyUsers(approvers, 'TREASURY_APPROVAL', { title: `Cash count difference: ${acc.name}`, message: `${difference} EGP`, titleAr: `فرق في جرد ${acc.name}`, messageAr: `${difference} ج.م`, relatedId: c.id })
  }
  return { ...c, expected, difference }
}

async function postCount(id: string) {
  const c = await prisma.cashCount.findUniqueOrThrow({ where: { id } })
  const diff = num(c.difference)
  if (!diff) return
  const acc = await prisma.moneyAccount.findUnique({ where: { id: c.accountId }, select: { campusId: true } })
  await prisma.moneyMovement.create({ data: { accountId: c.accountId, direction: diff > 0 ? 'IN' : 'OUT', amount: Math.abs(diff), date: new Date(), kind: 'ADJUST', campusId: acc?.campusId ?? null, note: c.note ? `Count difference — ${c.note}` : 'Count difference', cashCountId: c.id } })
}

export async function decideCount(user: Who, id: string, action: 'approve' | 'reject') {
  if (!checkPermission(user.role, 'treasury', 'approve')) throw new TreasuryError('You cannot approve counts')
  const c = await prisma.cashCount.findUnique({ where: { id } })
  if (!c || c.status !== 'PENDING') throw new TreasuryError('Nothing to decide')
  await assertAccount(user, c.accountId)
  if (c.countedById === user.id && user.role !== 'SUPER_ADMIN') throw new TreasuryError('Another person must approve your count')
  const upd = await prisma.cashCount.updateMany({ where: { id, status: 'PENDING' }, data: { status: action === 'approve' ? 'APPROVED' : 'REJECTED', approvedById: user.id, approvedAt: new Date() } })
  if (upd.count && action === 'approve') await postCount(id)
}

export async function listCounts(user: Who) {
  const ids = (await prisma.moneyAccount.findMany({ where: await visibleAccountWhere(user), select: { id: true, name: true } }))
  const names = new Map(ids.map((a) => [a.id, a.name]))
  const rows = await prisma.cashCount.findMany({ where: { accountId: { in: ids.map((a) => a.id) } }, orderBy: { createdAt: 'desc' }, take: 200 })
  return rows.map((c) => ({ ...c, expected: num(c.expected), counted: num(c.counted), difference: num(c.difference), account: names.get(c.accountId) ?? '', mine: c.countedById === user.id }))
}

// ── expense categories ──────────────────────────────────────────────────────────────────────────────────────

export async function expenseCategories(includeHidden = false) {
  if (!(await prisma.expenseCategoryDef.count())) {
    await prisma.expenseCategoryDef.createMany({ data: DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })), skipDuplicates: true })
  }
  return prisma.expenseCategoryDef.findMany({ where: includeHidden ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] })
}

export async function saveExpenseCategory(input: { nameEn: string; nameAr: string; isActive?: boolean; sortOrder?: number }, id?: string) {
  const data = { nameEn: input.nameEn.trim().slice(0, 80), nameAr: input.nameAr.trim().slice(0, 80), isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 50 }
  if (id) return prisma.expenseCategoryDef.update({ where: { id }, data })
  const key = `C-${Date.now().toString(36).toUpperCase()}`
  return prisma.expenseCategoryDef.create({ data: { ...data, key } })
}
