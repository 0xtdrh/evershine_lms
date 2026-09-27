/**
 * GET /api/teachers/[id]/my-week?days=7
 * This teacher's sessions for the next N days (default 7), grouped by day,
 * with each session flagged if it's already got an absence request or a
 * substitute attached — used by the My Schedule page's per-session
 * "Excuse" button.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { getTeacherSessionsOnDate } from '@/lib/teachers/schedule'
import type { Role } from '@prisma/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  const { id } = await params
  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher || teacher.id !== id) return errors.forbidden()
  } else {
    const denied = requirePermission(role, 'teachers', 'read')
    if (denied) return denied
  }

  const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? 7), 30)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const rangeEnd = new Date(today)
  rangeEnd.setDate(rangeEnd.getDate() + days)

  const [absences, substituteAssignments, cancelledSessions] = await Promise.all([
    prisma.teacherAbsence.findMany({
      where: { teacherId: id, date: { gte: today, lt: rangeEnd } },
      select: { id: true, date: true, scope: true, classSectionId: true, status: true },
    }),
    prisma.substituteAssignment.findMany({
      where: { substituteTeacherId: id, date: { gte: today, lt: rangeEnd }, status: 'CONFIRMED' },
      include: { originalTeacher: { select: { firstName: true, lastName: true } } },
    }),
    prisma.cancelledSession.findMany({
      where: { date: { gte: today, lt: rangeEnd } },
      select: { classSectionId: true, date: true, reason: true },
    }),
  ])

  const dayList = []
  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const sessions = await getTeacherSessionsOnDate(id, date)
    const dateStr = date.toISOString().slice(0, 10)

    const daySessions = sessions.map((s) => {
      const absence = absences.find(
        (a) => a.date.toISOString().slice(0, 10) === dateStr &&
          (a.scope === 'FULL_DAY' || a.classSectionId === s.classSectionId) &&
          a.status !== 'REJECTED' && a.status !== 'CANCELLED'
      )
      const substituteCoverage = substituteAssignments.find(
        (sub) => sub.date.toISOString().slice(0, 10) === dateStr && sub.classSectionId === s.classSectionId
      )
      const cancelled = cancelledSessions.find(
        (c) => c.date.toISOString().slice(0, 10) === dateStr && c.classSectionId === s.classSectionId
      )
      return {
        ...s,
        absenceStatus: absence?.status ?? null,
        isSubstituteCoverageHere: !!substituteCoverage,
        coveringForName: substituteCoverage ? `${substituteCoverage.originalTeacher.firstName} ${substituteCoverage.originalTeacher.lastName}` : null,
        isCancelled: !!cancelled,
        cancelledReason: cancelled?.reason ?? null,
      }
    })

    // Also surface substitute sessions this teacher is covering even if it
    // isn't one of their own regular assigned sessions.
    const extraSubSessions = substituteAssignments.filter(
      (sub) => sub.date.toISOString().slice(0, 10) === dateStr && !sessions.some((s) => s.classSectionId === sub.classSectionId)
    )
    for (const sub of extraSubSessions) {
      const cs = await prisma.classSection.findUnique({
        where: { id: sub.classSectionId },
        select: { className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } }, scheduleSlots: true },
      })
      const slots = Array.isArray(cs?.scheduleSlots) ? (cs!.scheduleSlots as { dayOfWeek: number; time: string }[]) : []
      const slot = slots.find((sl) => sl.dayOfWeek === date.getDay())
      daySessions.push({
        classSectionId: sub.classSectionId,
        className: cs?.className ?? '',
        sectionName: cs?.sectionName ?? '',
        time: slot?.time ?? '00:00',
        courseName: cs?.level?.subject.name ?? null,
        levelName: cs?.level?.name ?? null,
        absenceStatus: null,
        isSubstituteCoverageHere: true,
        coveringForName: `${sub.originalTeacher.firstName} ${sub.originalTeacher.lastName}`,
      })
    }

    daySessions.sort((a, b) => a.time.localeCompare(b.time))
    dayList.push({ date: dateStr, sessions: daySessions })
  }

  return successResponse(dayList)
}
