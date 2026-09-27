/**
 * POST /api/teacher-absences
 * Body: { date, scope: 'FULL_DAY'|'SINGLE_SESSION', classSectionId?, reason, isForceMajeure? }
 * GET  /api/teacher-absences?status=PENDING — list absence requests (for the
 *      approval queue, or a teacher's own history)
 *
 * Normal requests need 6+ hours' notice before the earliest affected
 * session. isForceMajeure (severe illness, bereavement) bypasses that, but
 * if submitted within 6 hours, the notification sent to approvers is
 * flagged urgent so it isn't missed.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { getTeacherSessionsOnDate, combineDateAndTime } from '@/lib/teachers/schedule'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  date: z.string().min(1),
  scope: z.enum(['FULL_DAY', 'SINGLE_SESSION']),
  classSectionId: z.string().min(1).optional(),
  reason: z.string().min(3, 'Give a reason'),
  isForceMajeure: z.boolean().optional(),
}).refine(
  (d) => d.scope !== 'SINGLE_SESSION' || !!d.classSectionId,
  { message: 'classSectionId is required when scope is SINGLE_SESSION' }
)

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  // A teacher submits their own; an admin/manager/secretary can submit on
  // a teacher's behalf via 'create' permission too (same as other resources).
  let teacherId: string
  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    teacherId = teacher.id
  } else {
    const denied = requirePermission(role, 'teacher_absences', 'create')
    if (denied) return denied
    const body2 = body as { teacherId?: string }
    if (!body2.teacherId) return errors.validation({ errors: [{ path: ['teacherId'], message: 'teacherId is required' }] } as never)
    teacherId = body2.teacherId
  }

  const date = new Date(parsed.data.date)
  const sessionsThatDay = await getTeacherSessionsOnDate(teacherId, date)

  if (parsed.data.scope === 'SINGLE_SESSION') {
    const match = sessionsThatDay.find((s) => s.classSectionId === parsed.data.classSectionId)
    if (!match) return errors.conflict('This teacher has no session for that group on this date')
  }

  const relevantSessions = parsed.data.scope === 'SINGLE_SESSION'
    ? sessionsThatDay.filter((s) => s.classSectionId === parsed.data.classSectionId)
    : sessionsThatDay

  const earliestTime = relevantSessions[0]?.time
  const deadline = earliestTime ? combineDateAndTime(date, earliestTime) : null
  const hoursUntilSession = deadline ? (deadline.getTime() - Date.now()) / (1000 * 60 * 60) : null

  const isLate = hoursUntilSession !== null && hoursUntilSession < 6
  if (isLate && !parsed.data.isForceMajeure) {
    return errors.conflict('Absence requests need at least 6 hours notice before the session — use the force-majeure option for a genuine emergency')
  }

  const absence = await prisma.teacherAbsence.create({
    data: {
      teacherId,
      date,
      scope: parsed.data.scope,
      classSectionId: parsed.data.scope === 'SINGLE_SESSION' ? parsed.data.classSectionId : null,
      reason: parsed.data.reason,
      isForceMajeure: parsed.data.isForceMajeure ?? false,
    },
  })

  // Notify everyone whose role can approve absences.
  try {
    const approverUsers = await prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] } },
      select: { id: true },
    })
    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { firstName: true, lastName: true } })
    const urgentPrefix = isLate ? '🚨 URGENT — ' : ''
    await prisma.notification.createMany({
      data: approverUsers.map((u) => ({
        userId: u.id,
        title: `${urgentPrefix}Absence request from ${teacher?.firstName} ${teacher?.lastName}`,
        message: parsed.data.scope === 'FULL_DAY'
          ? `Requesting the full day off on ${parsed.data.date}. Reason: ${parsed.data.reason}`
          : `Requesting to skip one session on ${parsed.data.date}. Reason: ${parsed.data.reason}`,
        type: 'TEACHER_ABSENCE_REQUEST',
        relatedId: absence.id,
      })),
    })
  } catch (notifErr) {
    console.error('[TEACHER_ABSENCE_CREATE] notification failed:', notifErr)
  }

  return createdResponse(absence, 'Absence request submitted')
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  const status = request.nextUrl.searchParams.get('status')
  const teacherIdParam = request.nextUrl.searchParams.get('teacherId')

  let teacherFilter: string | undefined
  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    teacherFilter = teacher.id
  } else {
    const denied = requirePermission(role, 'teacher_absences', 'read')
    if (denied) return denied
    teacherFilter = teacherIdParam ?? undefined
  }

  const rows = await prisma.teacherAbsence.findMany({
    where: {
      ...(teacherFilter && { teacherId: teacherFilter }),
      ...(status && { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' }),
    },
    include: {
      teacher: { select: { id: true, firstName: true, lastName: true } },
      classSection: { select: { id: true, className: true, sectionName: true } },
      substitutes: {
        include: { substituteTeacher: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { requestedAt: 'desc' },
  })

  return successResponse(rows)
}
