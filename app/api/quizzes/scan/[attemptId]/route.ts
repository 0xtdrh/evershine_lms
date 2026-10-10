/** LMS L4: opens a scanned paper exam (?i=<index>) for the student, their parents or the people who run the group. */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { curriculumMediaUrl } from '@/lib/cloudinary'
import { canManageGroupLessons } from '@/lib/lms/engine'

export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, select: { studentId: true, classSectionId: true, scanFiles: true } })
  if (!a) return errors.notFound('Scan')
  const role = session.user.role
  const allowed = role === 'STUDENT'
    ? (await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } }))?.id === a.studentId
    : role === 'PARENT' || role === 'GUARDIAN'
      ? await assertGuardianAccessToStudent(session.user.id, a.studentId)
      : await canManageGroupLessons({ id: session.user.id, role, campusId: session.user.campusId }, a.classSectionId)
  if (!allowed) return errors.forbidden()
  const f = ((a.scanFiles as { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string }[] | null) ?? [])[Number(request.nextUrl.searchParams.get('i') ?? 0)]
  if (!f) return errors.notFound('Scan')
  const res = NextResponse.redirect(curriculumMediaUrl(f.publicId, f.resourceType, f.format), 302)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
