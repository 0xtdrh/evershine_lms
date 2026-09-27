/**
 * GET /api/teachers/[id]/substitutions
 * Two lists for the "My Substitutions" page, each grouped by day:
 * - asSubstitute: sessions this teacher covered (or is pending/confirmed to
 *   cover) for someone else
 * - asAbsent: this teacher's own absence requests and their outcome
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
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
    const denied = requirePermission(role, 'teacher_absences', 'read')
    if (denied) return denied
  }

  const substituteRows = await prisma.substituteAssignment.findMany({
    where: { substituteTeacherId: id },
    include: {
      classSection: { select: { className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } } },
      originalTeacher: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: 'desc' },
  })

  const absenceRows = await prisma.teacherAbsence.findMany({
    where: { teacherId: id },
    include: {
      classSection: { select: { className: true, sectionName: true } },
      substitutes: { include: { substituteTeacher: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { date: 'desc' },
  })

  const groupByDate = <T extends { date: Date }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.entries()).map(([date, items]) => ({ date, items }))
  }

  return successResponse({
    asSubstitute: groupByDate(substituteRows).map((g) => ({
      date: g.date,
      sessions: g.items.map((r) => ({
        id: r.id,
        status: r.status,
        groupLabel: `${r.classSection.className} ${r.classSection.sectionName}`,
        courseName: r.classSection.level?.subject.name ?? null,
        levelName: r.classSection.level?.name ?? null,
        originalTeacherName: `${r.originalTeacher.firstName} ${r.originalTeacher.lastName}`,
      })),
    })),
    asAbsent: groupByDate(absenceRows).map((g) => ({
      date: g.date,
      items: g.items.map((r) => ({
        id: r.id,
        scope: r.scope,
        status: r.status,
        reason: r.reason,
        isForceMajeure: r.isForceMajeure,
        groupLabel: r.classSection ? `${r.classSection.className} ${r.classSection.sectionName}` : 'Whole day',
        substitutes: r.substitutes.map((s) => ({ status: s.status, name: `${s.substituteTeacher.firstName} ${s.substituteTeacher.lastName}` })),
      })),
    })),
  })
}
