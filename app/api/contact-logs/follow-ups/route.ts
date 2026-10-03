/**
 * GET /api/contact-logs/follow-ups — open follow-ups for the user's branch:
 * { overdue, today, upcoming, counts }. "Today" uses Egypt time.
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { staffNames } from '@/lib/contacts/contact-log'

/** Start of "today" in Egypt (UTC+2/+3) as a UTC instant. */
function egyptDayBounds(now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }))
  const offset = local.getTime() - now.getTime()
  const startLocal = new Date(local)
  startLocal.setHours(0, 0, 0, 0)
  const start = new Date(startLocal.getTime() - offset)
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'contact_logs', 'read')
  if (denied) return denied
  const campusId = campusScope(role, session.user.campusId, null)
  const { start, end } = egyptDayBounds()
  const rows = await prisma.contactLog.findMany({
    where: { followUpAt: { not: null, lt: new Date(end.getTime() + 14 * 86_400_000) }, followUpDoneAt: null, ...(campusId && { campusId }) },
    orderBy: { followUpAt: 'asc' },
    take: 300,
  })
  const students = await prisma.student.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
    select: { id: true, firstName: true, lastName: true, registrationNumber: true, guardians: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
  })
  const S = new Map(students.map((s) => [s.id, s]))
  const names = await staffNames(rows.map((r) => r.createdById ?? ''))
  const shape = (r: (typeof rows)[number]) => {
    const s = S.get(r.studentId)
    const g = s?.guardians.find((x) => x.id === r.guardianId) ?? s?.guardians[0]
    return {
      id: r.id,
      followUpAt: r.followUpAt,
      channel: r.channel,
      reason: r.reason,
      summary: r.summary,
      createdAt: r.createdAt,
      by: r.createdById ? names.get(r.createdById) ?? null : null,
      student: s ? { id: s.id, name: `${s.firstName} ${s.lastName}`, registrationNumber: s.registrationNumber } : null,
      guardian: g ? { name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber } : null,
    }
  }
  const overdue = rows.filter((r) => r.followUpAt! < start).map(shape)
  const today = rows.filter((r) => r.followUpAt! >= start && r.followUpAt! < end).map(shape)
  const upcoming = rows.filter((r) => r.followUpAt! >= end).map(shape)
  return successResponse({ overdue, today, upcoming, counts: { overdue: overdue.length, today: today.length, upcoming: upcoming.length } })
}
