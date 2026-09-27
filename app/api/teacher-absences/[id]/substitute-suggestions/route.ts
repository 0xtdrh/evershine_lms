/**
 * GET /api/teacher-absences/[id]/substitute-suggestions
 * For an APPROVED absence, returns each affected session with a list of
 * candidate substitutes — teachers qualified for that level/course/track
 * AND free at that exact time (checked against their own assigned groups'
 * schedules). Read-only; assigning happens via /assign-substitute.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherSessionsOnDate } from '@/lib/teachers/schedule'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teacher_absences', 'approve')
  if (denied) return denied

  const { id } = await params
  const absence = await prisma.teacherAbsence.findUnique({ where: { id } })
  if (!absence) return errors.notFound('Absence request')
  if (absence.status !== 'APPROVED') return errors.conflict('Substitutes can only be suggested for an approved absence')

  const sessionsThatDay = await getTeacherSessionsOnDate(absence.teacherId, absence.date)
  const affectedSessions = absence.scope === 'SINGLE_SESSION'
    ? sessionsThatDay.filter((s) => s.classSectionId === absence.classSectionId)
    : sessionsThatDay

  const alreadyAssigned = await prisma.substituteAssignment.findMany({
    where: { teacherAbsenceId: id },
    select: { classSectionId: true, substituteTeacherId: true, status: true },
  })

  const results = []
  for (const affected of affectedSessions) {
    const group = await prisma.classSection.findUnique({
      where: { id: affected.classSectionId },
      select: { levelId: true, level: { select: { subjectId: true, subject: { select: { trackId: true } } } } },
    })
    const levelId = group?.levelId ?? null
    const subjectId = group?.level?.subjectId ?? null
    const trackId = group?.level?.subject.trackId ?? null

    const qualified = await prisma.teacherQualifiedSubject.findMany({
      where: {
        OR: [
          ...(levelId ? [{ levelId }] : []),
          ...(subjectId ? [{ subjectId }] : []),
          ...(trackId ? [{ trackId }] : []),
        ],
      },
      select: { teacherId: true },
    })
    const qualifiedTeacherIds = [...new Set(qualified.map((q) => q.teacherId))].filter((tid) => tid !== absence.teacherId)

    const candidates = []
    for (const tid of qualifiedTeacherIds) {
      const theirSessions = await getTeacherSessionsOnDate(tid, absence.date)
      const hasConflict = theirSessions.some((s) => s.time === affected.time)
      if (hasConflict) continue
      const teacher = await prisma.teacher.findUnique({ where: { id: tid }, select: { id: true, firstName: true, lastName: true, isActive: true } })
      if (!teacher?.isActive) continue
      candidates.push({ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}` })
    }

    const existing = alreadyAssigned.find((a) => a.classSectionId === affected.classSectionId)

    results.push({
      classSectionId: affected.classSectionId,
      groupLabel: `${affected.className} ${affected.sectionName}`,
      time: affected.time,
      courseName: affected.courseName,
      levelName: affected.levelName,
      candidates,
      existingAssignment: existing ?? null,
    })
  }

  return successResponse(results)
}
