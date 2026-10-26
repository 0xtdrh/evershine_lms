/**
 * a03 month close — ONE guard for every money table (wired in lib/prisma.ts, like the change log): a create / update /
 * delete of a row dated in a closed month is refused with MonthLockedError, whoever does it (screen, import, job).
 * Rules (which column dates a row, what may still change): lib/month-close/rules.ts → GUARDED.
 * Costs nothing while no month is closed; otherwise only rows old enough to be in a closed month are read first.
 * Uses the plain client for its reads (no loops). RELATIVE imports only (tsx scripts load lib/prisma.ts).
 */

import type { PrismaClient } from '@prisma/client'
import { GUARDED, isLocked, latestLockedEnd, refusalMessage, rowYm, touchesClosedFields, type LockRow } from './rules'
import { MonthLockedError, noteRefusal } from './refusal'

const TTL = 15_000
let cache: { at: number; locks: LockRow[] } | null = null
let reader: PrismaClient | null = null

/** Call after closing / reopening a month (this server; others see it within 15 s). */
export function forgetLocks() { cache = null }

async function locks(): Promise<LockRow[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.locks
  if (!reader) return []
  try {
    const rows = await reader.monthLock.findMany({ where: { status: 'LOCKED' }, select: { ym: true, scopeKey: true } })
    cache = { at: Date.now(), locks: rows }
  } catch {
    // table not there yet (schema push pending) — never block writes because of the guard itself
    cache = { at: Date.now(), locks: [] }
  }
  return cache.locks
}

type Row = Record<string, unknown>
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const idOf = (data: Row, field: string): string | null => {
  const v = data[field]
  if (typeof v === 'string') return v
  const rel = data[field.replace(/Id$/, '')] as { connect?: { id?: string } } | undefined
  return rel?.connect?.id ?? null
}

async function studentCampus(id: string | null) {
  if (!id || !reader) return null
  return (await reader.student.findUnique({ where: { id }, select: { campusId: true } }))?.campusId ?? null
}
async function invoiceCampus(id: string | null) {
  if (!id || !reader) return null
  const inv = await reader.feeInvoice.findUnique({ where: { id }, select: { studentId: true, classSection: { select: { campusId: true } } } })
  return inv ? inv.classSection?.campusId ?? (await studentCampus(inv.studentId)) : null
}
async function groupCampus(id: string | null) {
  if (!id || !reader) return null
  return (await reader.classSection.findUnique({ where: { id }, select: { campusId: true } }))?.campusId ?? null
}
async function accountCampus(id: string | null) {
  if (!id || !reader) return null
  return (await reader.moneyAccount.findUnique({ where: { id }, select: { campusId: true } }))?.campusId ?? null
}

/** The branches a row belongs to ([] = a company row). */
async function campusesOf(model: string, r: Row): Promise<(string | null)[]> {
  switch (model) {
    case 'FeePayment': return [(await invoiceCampus(idOf(r, 'invoiceId'))) ?? (await studentCampus(idOf(r, 'studentId')))]
    case 'Refund': return [(await invoiceCampus(idOf(r, 'invoiceId'))) ?? (await studentCampus(idOf(r, 'studentId')))]
    case 'FeeInvoice': return [(await groupCampus(idOf(r, 'classSectionId'))) ?? (await studentCampus(idOf(r, 'studentId')))]
    case 'Expense': return [idOf(r, 'campusId')]
    case 'WalletTopUp': case 'WalletWithdrawal': return [await studentCampus(idOf(r, 'studentId'))]
    case 'MoneyTransfer': return [await accountCampus(idOf(r, 'fromAccountId')), await accountCampus(idOf(r, 'toAccountId'))]
    case 'CashCount': return [await accountCampus(idOf(r, 'accountId'))]
    case 'PartnerStatementPayment': {
      const sid = idOf(r, 'statementId')
      if (!sid || !reader) return []
      return [(await reader.partnerStatement.findUnique({ where: { id: sid }, select: { campusId: true } }))?.campusId ?? null]
    }
    default: return []
  }
}

/** Throws MonthLockedError when this row sits in a closed month. */
async function check(model: string, row: Row, all: LockRow[]) {
  const ym = rowYm(model, row)
  if (!ym || !all.some((l) => l.ym === ym)) return
  const campuses = GUARDED[model].companyOnly ? [] : await campusesOf(model, row)
  if (isLocked(all, ym, campuses)) {
    const err = new MonthLockedError(ym, refusalMessage(ym))
    noteRefusal(err)
    throw err
  }
}

/**
 * For screens that edit by hand what the guard lets through (invoices): the refusal message when the row's month is
 * closed, else null. `row` needs the date column(s) and the ids used to find its branch (e.g. createdAt, classSectionId, studentId).
 */
export async function closedMonthMessage(model: keyof typeof GUARDED, row: Row): Promise<string | null> {
  const all = await locks()
  if (!all.length) return null
  try { await check(model, row, all); return null } catch (e) {
    if (e instanceof MonthLockedError) return e.message
    throw e
  }
}

type Op = { model?: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }

async function guarded({ model, operation, args, query }: Op): Promise<unknown> {
  const rule = model ? GUARDED[model] : undefined
  if (!model || !rule) return query(args)
  const all = await locks()
  if (!all.length) return query(args)
  const a = (args ?? {}) as { where?: Row; data?: Row | Row[]; create?: Row; update?: Row }
  const end = latestLockedEnd(all)!
  const delegate = (reader as unknown as Record<string, { findMany: (x: unknown) => Promise<Row[]> }>)[lowerFirst(model)]
  // rows that are old enough to be in a closed month (a newer row can never be)
  const oldRows = async (where: Row | undefined) => {
    const or = rule.dates.map((f) => ({ [f]: { lte: end } }))
    return delegate.findMany({ where: { AND: [where ?? {}, { OR: or }] }, take: 500 })
  }

  switch (operation) {
    case 'create':
      await check(model, (a.data ?? {}) as Row, all)
      break
    case 'createMany':
      for (const d of (Array.isArray(a.data) ? a.data : [a.data ?? {}]) as Row[]) await check(model, d, all)
      break
    case 'delete': case 'deleteMany':
      for (const r of await oldRows(a.where)) await check(model, r, all)
      break
    case 'update': case 'updateMany': case 'upsert': {
      const data = ((operation === 'upsert' ? a.update : a.data) ?? {}) as Row
      // invoices are updated all the time by payments / refunds: no extra read for them
      if (rule.createDeleteOnly && operation !== 'upsert') break
      const before = await oldRows(a.where)
      if (operation === 'upsert' && !before.length && !(await delegate.findMany({ where: a.where ?? {}, take: 1 })).length) await check(model, (a.create ?? {}) as Row, all)
      if (rule.createDeleteOnly) break
      for (const r of before) if (touchesClosedFields(model, data, r)) await check(model, r, all)
      // moving a row INTO a closed month (e.g. changing an expense's date back)
      const newYm = rule.dates.some((f) => data[f] !== undefined) ? rowYm(model, data) : null
      if (newYm && all.some((l) => l.ym === newYm)) {
        const rows = await delegate.findMany({ where: a.where ?? {}, take: 500 })
        for (const r of rows.length ? rows : [{}]) await check(model, { ...r, ...data }, all)
      }
      break
    }
  }
  return query(args)
}

/** Wraps a client so writes into a closed month are refused. `base` (plain client) is used for the guard's reads. */
export function withMonthGuard(base: PrismaClient): PrismaClient {
  reader = base
  const extend = (base as unknown as { $extends: (ext: unknown) => unknown }).$extends
  return extend.call(base, { query: { $allModels: { $allOperations: guarded } } }) as unknown as PrismaClient
}
