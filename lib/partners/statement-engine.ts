/**
 * Partners part 1-B — statements in the database: make a draft from the deal + the system's numbers, recalculate, manual
 * lines, approve (numbers frozen, earlier open rests carried in), payments both ways. Server-only.
 * Maths: ./deal.ts (deal) and ./statement.ts (balance, payments, status).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextInSequence } from '@/lib/ids/sequence'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { computeDeal } from './deal'
import { asDeal, dealFacts } from './deal-engine'
import { overlaps, paymentProblem, periodBalance, remaining, statusAfterPayments, type ManualLine, type StatementPayment } from './statement'

type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT'; message: string }
const fail = (code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT', message: string): Outcome<never> => ({ ok: false, code, message })
const r2 = (n: number) => Math.round(n * 100) / 100
const OPEN = ['APPROVED', 'PARTIAL']

async function audit(userId: string, action: string, id: string, changes?: unknown) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entityType: 'PartnerStatement', entityId: id, changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined } })
  } catch (err) {
    console.error('[PARTNER_STATEMENT_AUDIT]', err)
  }
}

async function nextNumber() {
  const prefix = `TN-PST-${new Date().getFullYear()}-`
  const rows = await prisma.partnerStatement.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } })
  return nextInSequence(rows.map((r) => r.number), prefix, 5)
}

/** Places a statement covers: one place, or every place of the partner. */
async function scopePlaces(partnerId: string, campusId: string | null) {
  if (campusId) return [campusId]
  return (await prisma.campus.findMany({ where: { partnerId }, select: { id: true } })).map((c) => c.id)
}

/** The deal for the statement: for one place the place deal (else the all-places deal); for all places the all-places deal. */
async function findDeal(partnerId: string, campusId: string | null, from: Date, to: Date) {
  const deals = await prisma.partnerDeal.findMany({ where: { partnerId, isActive: true, validFrom: { lte: to }, OR: [{ validTo: null }, { validTo: { gte: from } }] }, orderBy: { validFrom: 'desc' } })
  return (campusId ? deals.find((d) => d.campusId === campusId) : null) ?? deals.find((d) => d.campusId === null) ?? null
}

/** The rest of earlier open statements of the same scope (to carry into a new one). */
async function openRests(partnerId: string, campusId: string | null, before: Date) {
  const rows = await prisma.partnerStatement.findMany({ where: { partnerId, campusId, status: { in: OPEN }, carriedToId: null, periodTo: { lt: before } }, include: { payments: true } })
  return rows.map((s) => ({ id: s.id, rest: remaining(Number(s.totalDue), s.payments.map(toPay)) }))
}

const toPay = (p: { direction: string; amount: unknown }): StatementPayment => ({ direction: p.direction as StatementPayment['direction'], amount: Number(p.amount) })

async function calculate(partnerId: string, campusId: string | null, from: Date, to: Date, manual: ManualLine[]) {
  const deal = await findDeal(partnerId, campusId, from, to)
  if (!deal) return null
  const facts = await dealFacts(await scopePlaces(partnerId, campusId), from, to)
  const result = computeDeal(asDeal(deal), facts)
  const rests = await openRests(partnerId, campusId, from)
  const previous = r2(rests.reduce((s, x) => s + x.rest, 0))
  const pb = periodBalance(result.balanceForTechNova, manual)
  return { deal, facts, result, previous, periodBalance: pb, totalDue: r2(pb + previous) }
}

export async function makeStatement(userId: string, partnerId: string, campusId: string | null, from: Date, to: Date): Promise<Outcome<{ id: string }>> {
  if (!(await prisma.partner.count({ where: { id: partnerId } }))) return fail('NOT_FOUND', 'Partner not found')
  if (campusId && !(await prisma.campus.count({ where: { id: campusId, partnerId } }))) return fail('INVALID', 'This place is not one of the partner places')
  if (to < from) return fail('INVALID', 'Check the period')
  const same = await prisma.partnerStatement.findMany({ where: { partnerId, campusId, status: { not: 'CANCELLED' } }, select: { periodFrom: true, periodTo: true, number: true } })
  const clash = same.find((s) => overlaps({ from, to }, { from: s.periodFrom, to: s.periodTo }))
  if (clash) return fail('CONFLICT', `There is already a statement for this period (${clash.number})`)
  const c = await calculate(partnerId, campusId, from, to, [])
  if (!c) return fail('INVALID', campusId
    ? 'مفيش اتفاق شغال للمكان ده في الفترة دي — ضيفه من تاب «الاتفاق» · No active deal for this place in this period — add one in the Deal tab'
    : 'مفيش اتفاق للشريك كله في الفترة دي — اختار المكان من القايمة · No deal for all the partner places in this period — choose the place')
  const row = await prisma.partnerStatement.create({
    data: {
      number: await nextNumber(), partnerId, campusId, dealId: c.deal.id, periodFrom: from, periodTo: to, status: 'DRAFT',
      facts: c.facts as unknown as Prisma.InputJsonValue, lines: c.result.lines as unknown as Prisma.InputJsonValue, manualLines: [],
      periodBalance: c.periodBalance, previousBalance: c.previous, totalDue: c.totalDue, createdById: userId,
    },
  })
  await audit(userId, 'CREATE', row.id, { period: [from, to], totalDue: c.totalDue })
  try {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true } })
    await notifyUsers((await usersWithPermission('partner_finance', 'approve')).filter((id) => id !== userId), 'PARTNER_STATEMENT', {
      title: `Statement to approve: ${partner?.name ?? ''}`,
      titleAr: `كشف حساب مستني الموافقة: ${partner?.name ?? ''}`,
      message: `${row.number} (${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}) is waiting for approval.`,
      messageAr: `${row.number} (${from.toISOString().slice(0, 10)} ← ${to.toISOString().slice(0, 10)}) مستني الموافقة.`,
      relatedId: partnerId,
    })
  } catch (err) {
    console.error('[PARTNER_STATEMENT_NOTIFY]', err)
  }
  return { ok: true, value: { id: row.id } }
}

/** Draft only: recalculate from the current numbers (and save the manual lines, if given). */
export async function recalculate(userId: string, id: string, manual?: ManualLine[], notes?: string | null): Promise<Outcome> {
  const s = await prisma.partnerStatement.findUnique({ where: { id } })
  if (!s) return fail('NOT_FOUND', 'Statement not found')
  if (s.status !== 'DRAFT') return fail('CONFLICT', 'Only a draft can change — an approved statement is frozen')
  const lines = manual ?? ((s.manualLines ?? []) as unknown as ManualLine[])
  for (const l of lines) if (!l.label?.trim() || !(Number(l.amount) >= 0)) return fail('INVALID', 'Each manual line needs a name and an amount')
  const c = await calculate(s.partnerId, s.campusId, s.periodFrom, s.periodTo, lines)
  if (!c) return fail('INVALID', 'There is no active deal for this period')
  await prisma.partnerStatement.update({
    where: { id },
    data: {
      dealId: c.deal.id, facts: c.facts as unknown as Prisma.InputJsonValue, lines: c.result.lines as unknown as Prisma.InputJsonValue,
      manualLines: lines as unknown as Prisma.InputJsonValue, periodBalance: c.periodBalance, previousBalance: c.previous, totalDue: c.totalDue,
      ...(notes !== undefined && { notes: notes?.trim() || null }),
    },
  })
  await audit(userId, 'UPDATE', id, { manualLines: lines, totalDue: c.totalDue })
  return { ok: true, value: null }
}

/** Approve: recalculate one last time, freeze, and move the rest of earlier open statements into this one. */
export async function approveStatement(userId: string, id: string): Promise<Outcome> {
  const re = await recalculate(userId, id)
  if (!re.ok) return re
  const s = await prisma.partnerStatement.findUniqueOrThrow({ where: { id } })
  const rests = await openRests(s.partnerId, s.campusId, s.periodFrom)
  await prisma.$transaction([
    prisma.partnerStatement.updateMany({ where: { id: { in: rests.map((r) => r.id) } }, data: { status: 'CARRIED', carriedToId: id } }),
    prisma.partnerStatement.update({ where: { id }, data: { status: Math.abs(Number(s.totalDue)) < 0.01 ? 'PAID' : 'APPROVED', approvedById: userId, approvedAt: new Date() } }),
  ])
  await audit(userId, 'APPROVE', id, { totalDue: Number(s.totalDue), carried: rests.map((r) => r.id) })
  return { ok: true, value: null }
}

export async function deleteDraft(userId: string, id: string): Promise<Outcome> {
  const s = await prisma.partnerStatement.findUnique({ where: { id } })
  if (!s) return fail('NOT_FOUND', 'Statement not found')
  if (s.status !== 'DRAFT') return fail('CONFLICT', 'Only a draft can be deleted')
  await prisma.partnerStatement.delete({ where: { id } })
  await audit(userId, 'DELETE', id, { number: s.number })
  return { ok: true, value: null }
}

export interface PaymentInput { direction: StatementPayment['direction']; amount: number; method: string; paidAt: string; reference?: string | null; note?: string | null }

export async function addPayment(userId: string, id: string, p: PaymentInput): Promise<Outcome<{ status: string }>> {
  const s = await prisma.partnerStatement.findUnique({ where: { id }, include: { payments: true } })
  if (!s) return fail('NOT_FOUND', 'Statement not found')
  if (!OPEN.includes(s.status)) return fail('CONFLICT', s.status === 'DRAFT' ? 'Approve the statement first' : 'This statement is closed')
  const pays = s.payments.map(toPay)
  const problem = paymentProblem(Number(s.totalDue), pays, { direction: p.direction, amount: p.amount })
  if (problem) return fail('INVALID', problem)
  const paidAt = new Date(p.paidAt)
  if (Number.isNaN(paidAt.getTime())) return fail('INVALID', 'Choose the payment date')
  const status = statusAfterPayments(Number(s.totalDue), [...pays, { direction: p.direction, amount: p.amount }])
  await prisma.$transaction([
    prisma.partnerStatementPayment.create({ data: { statementId: id, direction: p.direction, amount: p.amount, method: p.method.trim(), paidAt, reference: p.reference?.trim() || null, note: p.note?.trim() || null, recordedById: userId } }),
    prisma.partnerStatement.update({ where: { id }, data: { status } }),
  ])
  await audit(userId, 'PAYMENT', id, { direction: p.direction, amount: p.amount, method: p.method })
  return { ok: true, value: { status } }
}

export async function listStatements(partnerId: string) {
  const rows = await prisma.partnerStatement.findMany({ where: { partnerId }, orderBy: { periodFrom: 'desc' }, include: { payments: { orderBy: { paidAt: 'asc' } } } })
  return rows.map((s) => ({ ...shape(s), payments: s.payments.map((p) => ({ ...p, amount: Number(p.amount) })) }))
}

export async function getStatement(id: string) {
  const s = await prisma.partnerStatement.findUnique({ where: { id }, include: { payments: { orderBy: { paidAt: 'asc' } }, partner: { select: { id: true, name: true, kind: true } } } })
  if (!s) return null
  const place = s.campusId ? await prisma.campus.findUnique({ where: { id: s.campusId }, select: { name: true } }) : null
  return { ...shape(s), partner: s.partner, placeName: place?.name ?? null, payments: s.payments.map((p) => ({ ...p, amount: Number(p.amount) })) }
}

function shape(s: { totalDue: unknown; periodBalance: unknown; previousBalance: unknown; payments: { direction: string; amount: unknown }[] } & Record<string, unknown>) {
  const pays = s.payments.map(toPay)
  return { ...s, totalDue: Number(s.totalDue), periodBalance: Number(s.periodBalance), previousBalance: Number(s.previousBalance), rest: remaining(Number(s.totalDue), pays) }
}

/** Open money per partner (for the overview / reports): rest of open statements, from TechNova's side. */
export async function openBalances() {
  const rows = await prisma.partnerStatement.findMany({ where: { status: { in: OPEN } }, include: { payments: true, partner: { select: { id: true, name: true } } } })
  const by = new Map<string, { partnerId: string; name: string; rest: number }>()
  for (const s of rows) {
    const k = s.partnerId
    const cur = by.get(k) ?? { partnerId: k, name: s.partner.name, rest: 0 }
    cur.rest = r2(cur.rest + remaining(Number(s.totalDue), s.payments.map(toPay)))
    by.set(k, cur)
  }
  return [...by.values()]
}
