/**
 * Partners part 1 — database side of the deals: save / list, gather the facts of a period from the system and calculate
 * (preview now; statements in batch B). Server-only. Pure maths in ./deal.ts.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeDeal, dealProblem, periodMonths, pickDeal, type Deal, type DealComponent, type DealExtra, type DealFacts } from './deal'

type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'INVALID'; message: string }
const fail = (code: 'NOT_FOUND' | 'INVALID', message: string): Outcome<never> => ({ ok: false, code, message })
const r2 = (n: number) => Math.round(n * 100) / 100
const day = (d: Date) => d.toISOString().slice(0, 10)

export interface DealInput {
  title: string; campusId?: string | null; contractId?: string | null; collector: Deal['collector']; components: DealComponent[]; extras?: DealExtra[] | null
  countPartnerCancelled?: boolean; period?: Deal['period']; validFrom: string; validTo?: string | null; notes?: string | null; isActive?: boolean
}

export async function listDeals(partnerId: string) {
  return prisma.partnerDeal.findMany({ where: { partnerId }, orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }] })
}

export async function saveDeal(userId: string, partnerId: string, id: string | null, input: DealInput): Promise<Outcome<{ id: string }>> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true, places: { select: { id: true } }, contracts: { select: { id: true } } } })
  if (!partner) return fail('NOT_FOUND', 'Partner not found')
  if (input.campusId && !partner.places.some((p) => p.id === input.campusId)) return fail('INVALID', 'This place is not one of the partner places')
  if (input.contractId && !partner.contracts.some((c) => c.id === input.contractId)) return fail('INVALID', 'This contract is not one of the partner contracts')
  const deal: Deal = { collector: input.collector, components: input.components, extras: input.extras ?? [], countPartnerCancelled: input.countPartnerCancelled ?? true, period: input.period ?? 'MONTH' }
  const problem = dealProblem(deal)
  if (problem) return fail('INVALID', problem)
  const validFrom = new Date(input.validFrom)
  const validTo = input.validTo ? new Date(input.validTo) : null
  if (Number.isNaN(validFrom.getTime()) || (validTo && (Number.isNaN(validTo.getTime()) || validTo < validFrom))) return fail('INVALID', 'Check the dates of the deal')
  const data = {
    title: input.title.trim(), campusId: input.campusId || null, contractId: input.contractId || null, collector: deal.collector,
    components: deal.components as unknown as Prisma.InputJsonValue, extras: (deal.extras ?? []) as unknown as Prisma.InputJsonValue,
    countPartnerCancelled: deal.countPartnerCancelled, period: deal.period, validFrom, validTo, notes: input.notes?.trim() || null,
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }
  const row = id
    ? await prisma.partnerDeal.update({ where: { id, partnerId }, data })
    : await prisma.partnerDeal.create({ data: { ...data, partnerId, createdById: userId } })
  try {
    await prisma.auditLog.create({ data: { userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'PartnerDeal', entityId: row.id, changes: data as unknown as Prisma.InputJsonValue } })
  } catch (err) {
    console.error('[PARTNER_DEAL_AUDIT]', err)
  }
  return { ok: true, value: { id: row.id } }
}

/** The facts of a period for some places, read from what the system already holds. */
export async function dealFacts(campusIds: string[], from: Date, to: Date): Promise<DealFacts & { groupIds: string[] }> {
  const end = new Date(to.getTime() + 86_399_999)
  const groups = await prisma.classSection.findMany({ where: { campusId: { in: campusIds } }, select: { id: true, unnamedHeadcount: true } })
  const groupIds = groups.map((g) => g.id)
  const empty = { collected: 0, refunds: 0, discounts: 0, sessionsHeld: 0, sessionsCancelledByPartner: 0, students: 0, groups: 0, months: periodMonths(from, to), groupIds }
  if (!groupIds.length && !campusIds.length) return empty
  const invoiceScope: Prisma.FeeInvoiceWhereInput = { OR: [{ classSectionId: { in: groupIds } }, { classSectionId: null, student: { campusId: { in: campusIds } } }] }
  const [paid, invoiceIds, attendance, logs] = await Promise.all([
    prisma.feePayment.aggregate({ where: { status: 'COMPLETED', paymentDate: { gte: from, lte: end }, invoice: invoiceScope }, _sum: { amount: true } }),
    prisma.feeInvoice.findMany({ where: invoiceScope, select: { id: true } }).then((r) => r.map((x) => x.id)),
    groupIds.length
      ? prisma.enrollmentAttendanceRecord.findMany({ where: { attendanceDate: { gte: from, lte: end }, studentEnrollment: { classSectionId: { in: groupIds } } }, select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true, studentId: true } } } })
      : Promise.resolve([]),
    groupIds.length ? prisma.groupSessionLog.findMany({ where: { classSectionId: { in: groupIds }, sessionDate: { gte: from, lte: end } } }) : Promise.resolve([]),
  ])
  const [refunds, discounts] = invoiceIds.length
    ? await Promise.all([
        prisma.refund.aggregate({ where: { status: 'APPROVED', approvedAt: { gte: from, lte: end }, invoiceId: { in: invoiceIds } }, _sum: { amount: true } }),
        prisma.invoiceDiscount.aggregate({ where: { createdAt: { gte: from, lte: end }, invoiceId: { in: invoiceIds } }, _sum: { amount: true } }),
      ])
    : [{ _sum: { amount: null } }, { _sum: { amount: null } }]
  const held = new Set<string>()
  for (const a of attendance) held.add(`${a.studentEnrollment.classSectionId}|${day(a.attendanceDate)}`)
  for (const l of logs.filter((x) => x.status === 'HELD')) held.add(`${l.classSectionId}|${day(l.sessionDate)}`)
  const groupsWithSessions = new Set([...held].map((k) => k.split('|')[0]))
  const attendedStudents = new Set(attendance.map((a) => a.studentEnrollment.studentId))
  const active = groupIds.length
    ? await prisma.studentEnrollment.findMany({ where: { classSectionId: { in: [...groupsWithSessions] }, status: 'ACTIVE', createdAt: { lte: end } }, select: { studentId: true } })
    : []
  for (const e of active) attendedStudents.add(e.studentId)
  const unnamedChildren = groups.filter((g) => g.unnamedHeadcount !== null && groupsWithSessions.has(g.id)).reduce((n, g) => n + (g.unnamedHeadcount ?? 0), 0)
  return {
    collected: r2(Number(paid._sum.amount ?? 0)),
    refunds: r2(Number(refunds._sum.amount ?? 0)),
    discounts: r2(Number(discounts._sum.amount ?? 0)),
    sessionsHeld: held.size,
    sessionsCancelledByPartner: logs.filter((x) => x.status === 'CANCELLED_PARTNER').length,
    students: attendedStudents.size + unnamedChildren,
    groups: groupsWithSessions.size,
    months: periodMonths(from, to),
    groupIds,
  }
}

const asDeal = (d: { collector: string; components: unknown; extras: unknown; countPartnerCancelled: boolean; period: string }): Deal => ({
  collector: d.collector as Deal['collector'], components: (d.components ?? []) as DealComponent[], extras: (d.extras ?? []) as DealExtra[],
  countPartnerCancelled: d.countPartnerCancelled, period: d.period === 'TERM' ? 'TERM' : 'MONTH',
})

/** Live calculation for one deal over a period (nothing is saved). */
export async function previewDeal(dealId: string, from: Date, to: Date) {
  const d = await prisma.partnerDeal.findUnique({ where: { id: dealId }, include: { partner: { select: { places: { select: { id: true } } } } } })
  if (!d) return null
  const campusIds = d.campusId ? [d.campusId] : d.partner.places.map((p) => p.id)
  const facts = await dealFacts(campusIds, from, to)
  return { deal: { id: d.id, title: d.title, collector: d.collector }, from: day(from), to: day(to), facts, result: computeDeal(asDeal(d), facts) }
}

/** The deal that applies to a place for a period (place-specific first). */
export async function dealFor(partnerId: string, campusId: string, from: Date, to: Date) {
  return pickDeal(await prisma.partnerDeal.findMany({ where: { partnerId } }), campusId, from, to)
}

export { asDeal }
