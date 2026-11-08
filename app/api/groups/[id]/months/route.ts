/**
 * GET /api/groups/[id]/months — every month (billing cycle) of this group, oldest first: sessions, students, attendance %,
 * and the money only for people with fees:read. Groups the person may not see are left out. Read-only.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { canSeeGroup } from '@/lib/places/server'
import { attendancePct, walkChain, whoContinued } from '@/lib/groups/months'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()

  // only the links that can reach this group: follow them outward step by step
  const raw: { from: string; to: string; at: Date }[] = []
  const done = new Set<string>()
  let frontier = [id]
  while (frontier.length && done.size < 120) {
    frontier.forEach((x) => done.add(x))
    const found = new Set<string>()
    const rows = await prisma.groupCycleLog.findMany({
      where: { newClassSectionId: { not: null }, OR: [{ classSectionId: { in: frontier } }, { newClassSectionId: { in: frontier } }] },
      select: { classSectionId: true, newClassSectionId: true, completedAt: true },
    })
    for (const l of rows) {
      raw.push({ from: l.classSectionId, to: l.newClassSectionId!, at: l.completedAt })
      found.add(l.classSectionId); found.add(l.newClassSectionId!)
    }
    frontier = [...found].filter((x) => !done.has(x))
  }
  const chain = walkChain(raw, id)
  let allowed = (await Promise.all(chain.map(async (g) => ((await canSeeGroup(session.user, g)) ? g : null)))).filter((g): g is string => !!g)

  // Owner rule: an instructor sees only the groups he teaches or covers, even with an "every place" account.
  if (role === 'TEACHER') {
    const t = await prisma.teacher.findUnique({ where: { userId: session.user.id }, select: { id: true } })
    if (!t) return errors.forbidden()
    const [teaches, covers] = await Promise.all([
      prisma.subjectOffering.findMany({ where: { classSectionId: { in: allowed }, teacherId: t.id }, select: { classSectionId: true } }),
      prisma.substituteAssignment.findMany({ where: { classSectionId: { in: allowed }, substituteTeacherId: t.id, status: 'CONFIRMED' }, select: { classSectionId: true } }),
    ])
    const mine = new Set([...teaches, ...covers].map((x) => x.classSectionId))
    if (!mine.has(id)) return errors.forbidden()
    allowed = allowed.filter((g) => mine.has(g))
  }

  const seeMoney = checkPermission(role, 'fees', 'read')
  const [groups, enrolled, records, logs, invoices] = await Promise.all([
    prisma.classSection.findMany({ where: { id: { in: allowed } }, select: { id: true, className: true, sectionName: true, status: true, currentCycleNumber: true, startDate: true, level: { select: { name: true } } } }),
    prisma.studentEnrollment.findMany({ where: { classSectionId: { in: chain } }, select: { classSectionId: true, studentId: true, withdrawalReason: true, student: { select: { firstName: true, lastName: true } } } }), // the whole chain: the next month may be another instructor's
    prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollment: { classSectionId: { in: allowed } } }, select: { status: true, attendanceDate: true, studentEnrollment: { select: { classSectionId: true } } } }),
    prisma.groupSessionLog.findMany({ where: { classSectionId: { in: allowed }, status: 'HELD' }, select: { classSectionId: true, sessionDate: true } }),
    seeMoney ? prisma.feeInvoice.findMany({ where: { classSectionId: { in: allowed } }, select: { classSectionId: true, totalAmount: true, paidAmount: true, refundedAmount: true } }) : Promise.resolve([]),
  ])
  const byId = new Map(groups.map((g) => [g.id, g]))
  const inMonth = (g: string) => enrolled.filter((e) => e.classSectionId === g)
  const whoNext = (g: string) => {
    const nextGroup = chain[chain.indexOf(g) + 1]
    const r = whoContinued(
      inMonth(g).map((e) => ({ id: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`, transferred: e.withdrawalReason === 'TRANSFERRED' })),
      nextGroup ? inMonth(nextGroup).map((e) => e.studentId) : null,
    )
    return r ? { continued: r.continued, stopped: r.stopped } : { continued: null, stopped: [] }
  }

  return successResponse({
    seeMoney,
    months: allowed.filter((g) => byId.has(g)).map((gid) => {
      const g = byId.get(gid)!
      const rows = records.filter((r) => r.studentEnrollment.classSectionId === gid)
      const dates = [...new Set([...rows.map((r) => ymd(r.attendanceDate)), ...logs.filter((l) => l.classSectionId === gid).map((l) => ymd(l.sessionDate))])].sort()
      const inv = invoices.filter((i) => i.classSectionId === gid)
      const expected = inv.reduce((a, i) => a + Number(i.totalAmount), 0)
      const collected = inv.reduce((a, i) => a + Number(i.paidAmount) - Number(i.refundedAmount), 0) // same sums as the Financials window
      return {
        id: g.id, current: g.id === id, name: g.className, section: g.sectionName, level: g.level?.name ?? null, status: g.status, cycleNumber: g.currentCycleNumber,
        firstSession: dates[0] ?? (g.startDate ? ymd(g.startDate) : null), lastSession: dates[dates.length - 1] ?? null, sessions: dates.length,
        students: inMonth(gid).length,
        ...whoNext(gid),
        attendancePct: attendancePct(rows.map((r) => r.status)),
        ...(seeMoney ? { invoices: inv.length, expected, collected, outstanding: expected - collected } : {}),
      }
    }),
  })
}
