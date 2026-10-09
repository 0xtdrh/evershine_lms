/**
 * LMS L2: one open lesson for the signed-in student (?g=<groupId>). Student view only (no instructor notes or
 * instructor-only content); files go through /api/lessons/media (checked + logged). The opening is logged.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { logLessonView, studentLesson } from '@/lib/lms/engine'
import { getLmsSettings } from '@/lib/lms/settings'
import { clientIp, portalLessonViewer } from '@/lib/lms/api'
import { ageOn, cairoYmd } from '@/lib/dates/cairo'

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const groupId = request.nextUrl.searchParams.get('g')
  const { v, err } = await portalLessonViewer(request.nextUrl.searchParams.get('s'))
  if (err) return err
  if (v!.asParent) return errors.forbidden('Parents see the lessons summary only')
  if (!groupId) return errors.badRequest('g (group) is required')
  const r = (await studentLesson(v!.studentId, groupId, sessionId)) as { ok: boolean; code?: string; message?: string; value?: object }
  if (!r.ok) return r.code === 'LOCKED' ? errorResponse('LOCKED', r.message!, 403) : r.code === 'NOT_FOUND' ? errors.notFound('Lesson') : errors.forbidden(r.message)
  await logLessonView({ userId: v!.userId, studentId: v!.studentId, classSectionId: groupId, sessionId, kind: 'SESSION', ip: clientIp(request), userAgent: request.headers.get('user-agent') })
  const [student, settings] = await Promise.all([
    prisma.student.findUnique({ where: { id: v!.studentId }, select: { firstName: true, lastName: true, registrationNumber: true, dateOfBirth: true } }),
    getLmsSettings(),
  ])
  const age = student?.dateOfBirth ? ageOn(student.dateOfBirth, cairoYmd()) : null
  return successResponse({
    ...r.value,
    watermark: settings.watermark ? `${student?.firstName ?? ''} ${student?.lastName ?? ''} · ${student?.registrationNumber ?? ''}`.trim() : null,
    kidMode: age !== null && age <= settings.kidModeMaxAge,
  })
}
