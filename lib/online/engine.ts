/**
 * L5 online classes (free first step): the group's meeting link, today's sessions with a Join button for the student,
 * and the join log (provisional attendance shown to the instructor in the attendance screen). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { cairoDateTimeToUtc, cairoToday } from '@/lib/dates/cairo'
import { joinWindow } from './rules'

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`)

/** Today's online sessions of a student's groups (link only while Join is open). */
export async function myOnlineSessions(studentId: string, now = new Date()) {
  const enr = await prisma.studentEnrollment.findMany({
    where: { studentId, status: 'ACTIVE', classSection: { status: 'ACTIVE', onlineMeetingUrl: { not: null } } },
    select: { classSectionId: true, classSection: { select: { className: true, sectionName: true } } },
  })
  if (!enr.length) return []
  const today = cairoToday(now)
  const occ = await occurrencesFor({ groupIds: enr.map((e) => e.classSectionId) }, today, today)
  const joins = await prisma.onlineJoin.findMany({ where: { studentId, sessionDate: dateOnly(today) }, select: { classSectionId: true, joinedAt: true } })
  const out = []
  for (const g of occ) {
    for (const o of g.occurrences.filter((x) => x.date === today && (x.status === 'SCHEDULED' || x.status === 'HELD') && x.time)) {
      const start = cairoDateTimeToUtc(o.date, o.time)
      const w = joinWindow(start, null, now)
      if (!w.open && !w.upcoming) continue
      const label = enr.find((e) => e.classSectionId === g.id)
      out.push({
        groupId: g.id, group: `${label?.classSection.className ?? ''} ${label?.classSection.sectionName ?? ''}`.trim(), start, opensAt: w.opens,
        canJoin: w.open, joinedAt: joins.find((j) => j.classSectionId === g.id)?.joinedAt ?? null, sessionNumber: o.sessionNumber,
      })
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** The student (or the parent for a young child) presses Join: logged once per session, returns the link. */
export async function joinOnline(studentId: string, groupId: string, userId: string, now = new Date()): Promise<{ ok: boolean; url?: string; message?: string }> {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { onlineMeetingUrl: true } })
  if (!g?.onlineMeetingUrl) return { ok: false, message: 'This group has no online class link' }
  const session = (await myOnlineSessions(studentId, now)).find((s) => s.groupId === groupId)
  if (!session) return { ok: false, message: 'There is no online session of this group today' }
  if (!session.canJoin) return { ok: false, message: `Join opens at ${session.opensAt.toISOString()}` }
  const sessionDate = dateOnly(cairoToday(now))
  await prisma.onlineJoin.upsert({
    where: { classSectionId_studentId_sessionDate: { classSectionId: groupId, studentId, sessionDate } },
    create: { classSectionId: groupId, studentId, sessionDate, userId },
    update: {},
  })
  return { ok: true, url: g.onlineMeetingUrl }
}

/** Who joined a group's online session on a date (for the attendance screen). */
export async function onlineJoinsOn(groupId: string, date: string) {
  const rows = await prisma.onlineJoin.findMany({ where: { classSectionId: groupId, sessionDate: dateOnly(date) }, select: { studentId: true, joinedAt: true } })
  return new Map(rows.map((r) => [r.studentId, r.joinedAt]))
}
