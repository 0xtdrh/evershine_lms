/**
 * Partners part 1-B2 — the partners overview (numbers + things that need attention), the partner report (what happened
 * in each place in a period) and the rows for Excel exports. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { contractState, daysLeft } from './rules'
import { openBalances } from './statement-engine'
import { dueFollowUps } from './relations'

const r2 = (n: number) => Math.round(n * 100) / 100
const day = (d: Date) => d.toISOString().slice(0, 10)

export async function partnersOverview(opts: { withMoney: boolean }, now = new Date()) {
  const partners = await prisma.partner.findMany({
    include: {
      places: { select: { id: true } },
      contracts: { select: { id: true, title: true, startDate: true, endDate: true, alertDaysBefore: true } },
      _count: { select: { contacts: true } },
    },
  })
  const placeIds = partners.flatMap((p) => p.places.map((x) => x.id))
  const groups = placeIds.length ? await prisma.classSection.groupBy({ by: ['campusId'], where: { campusId: { in: placeIds }, status: 'ACTIVE', isActive: true }, _count: { _all: true } }) : []
  const G = new Map(groups.map((g) => [g.campusId, g._count._all]))
  const active = partners.filter((p) => p.isActive)
  const ending: { partnerId: string; partner: string; contract: string; daysLeft: number | null; state: string }[] = []
  const notStarted: { partnerId: string; partner: string }[] = []
  const incomplete: { partnerId: string; partner: string; missing: string[] }[] = []
  for (const p of active) {
    for (const c of p.contracts) {
      const st = contractState(c, now)
      if (st === 'ENDING_SOON' || (st === 'ENDED' && (daysLeft(c.endDate, now) ?? 0) > -30)) ending.push({ partnerId: p.id, partner: p.name, contract: c.title, daysLeft: daysLeft(c.endDate, now), state: st })
    }
    const running = p.places.reduce((n, pl) => n + (G.get(pl.id) ?? 0), 0)
    const signed = p.contracts.some((c) => ['ACTIVE', 'ENDING_SOON', 'OPEN_ENDED'].includes(contractState(c, now)))
    if (signed && running === 0) notStarted.push({ partnerId: p.id, partner: p.name })
    const missing = [
      ...(p.places.length ? [] : ['place']),
      ...(p.contactPhone || p._count.contacts ? [] : ['contact']),
      ...(p.contracts.length ? [] : ['contract']),
    ]
    if (missing.length) incomplete.push({ partnerId: p.id, partner: p.name, missing })
  }
  const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59))
  const follow = await dueFollowUps(endOfToday)
  const drafts = await prisma.partnerStatement.findMany({ where: { status: 'DRAFT' }, select: { id: true, number: true, partner: { select: { id: true, name: true } } }, take: 50 })
  const balances = opts.withMoney ? await openBalances() : []
  return {
    counts: {
      partners: partners.length,
      active: active.length,
      places: placeIds.length,
      activeGroups: groups.reduce((n, g) => n + g._count._all, 0),
      endingContracts: ending.length,
      draftStatements: drafts.length,
      followUpsDue: follow.length,
    },
    money: opts.withMoney
      ? {
          toReceive: r2(balances.filter((b) => b.rest > 0).reduce((s, b) => s + b.rest, 0)),
          toPay: r2(Math.abs(balances.filter((b) => b.rest < 0).reduce((s, b) => s + b.rest, 0))),
          byPartner: balances.filter((b) => Math.abs(b.rest) >= 0.01).sort((a, b) => Math.abs(b.rest) - Math.abs(a.rest)),
        }
      : null,
    ending: ending.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
    notStarted,
    incomplete,
    followUps: follow.map((f) => ({ id: f.id, partnerId: f.partner.id, partner: f.partner.name, kind: f.kind, summary: f.summary, followUpAt: f.followUpAt })),
    drafts: opts.withMoney ? drafts.map((d) => ({ id: d.id, number: d.number, partnerId: d.partner.id, partner: d.partner.name })) : [],
  }
}

/** What happened at a partner's places in a period: groups, sessions held / cancelled, students, attendance. */
export async function partnerReport(partnerId: string, from: Date, to: Date) {
  const end = new Date(to.getTime() + 86_399_999)
  const p = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true, name: true, kind: true, places: { select: { id: true, name: true } } } })
  if (!p) return null
  const groups = await prisma.classSection.findMany({
    where: { campusId: { in: p.places.map((x) => x.id) }, isActive: true },
    select: { id: true, className: true, sectionName: true, campusId: true, unnamedHeadcount: true, level: { select: { name: true, subject: { select: { name: true } } } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  const ids = groups.map((g) => g.id)
  const [records, logs] = ids.length
    ? await Promise.all([
        prisma.enrollmentAttendanceRecord.findMany({ where: { attendanceDate: { gte: from, lte: end }, studentEnrollment: { classSectionId: { in: ids } } }, select: { attendanceDate: true, status: true, studentEnrollment: { select: { classSectionId: true } } } }),
        prisma.groupSessionLog.findMany({ where: { classSectionId: { in: ids }, sessionDate: { gte: from, lte: end } } }),
      ])
    : [[], []]
  const rows = groups.map((g) => {
    const rec = records.filter((r) => r.studentEnrollment.classSectionId === g.id)
    const held = new Set([...rec.map((r) => day(r.attendanceDate)), ...logs.filter((l) => l.classSectionId === g.id && l.status === 'HELD').map((l) => day(l.sessionDate))])
    const cancelled = logs.filter((l) => l.classSectionId === g.id && l.status !== 'HELD').length
    const present = rec.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
    return {
      id: g.id, name: `${g.className} ${g.sectionName}`.trim(), place: p.places.find((x) => x.id === g.campusId)?.name ?? '',
      level: g.level ? `${g.level.subject?.name ?? ''} › ${g.level.name}` : '', students: g.unnamedHeadcount ?? g._count.enrollments, unnamed: g.unnamedHeadcount !== null,
      sessionsHeld: held.size, sessionsCancelled: cancelled, attendancePct: rec.length ? Math.round((present / rec.length) * 100) : null,
    }
  }).filter((r) => r.sessionsHeld || r.sessionsCancelled || r.students)
  return {
    partner: { id: p.id, name: p.name, kind: p.kind },
    from: day(from), to: day(to),
    totals: {
      groups: rows.length,
      students: rows.reduce((n, r) => n + r.students, 0),
      sessionsHeld: rows.reduce((n, r) => n + r.sessionsHeld, 0),
      sessionsCancelled: rows.reduce((n, r) => n + r.sessionsCancelled, 0),
      attendancePct: records.length ? Math.round((records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length / records.length) * 100) : null,
    },
    groups: rows,
  }
}
