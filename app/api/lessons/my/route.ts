/**
 * LMS L2: "My lessons". Student → their groups with every session (open / locked, progress).
 * Parent (?s=<childId>) → what was learned so far (titles + objectives of the open sessions), read-only.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { parentLessonsSummary, studentLessonsOverview } from '@/lib/lms/engine'
import { getLmsSettings } from '@/lib/lms/settings'
import { portalLessonViewer } from '@/lib/lms/api'
import { ageOn, cairoYmd } from '@/lib/dates/cairo'

export async function GET(request: NextRequest) {
  const { v, err } = await portalLessonViewer(request.nextUrl.searchParams.get('s'))
  if (err) return err
  const student = await prisma.student.findUnique({ where: { id: v!.studentId }, select: { firstName: true, lastName: true, dateOfBirth: true } })
  if (v!.asParent) return successResponse({ mode: 'PARENT', student: { firstName: student?.firstName }, groups: await parentLessonsSummary(v!.studentId) })
  const settings = await getLmsSettings()
  const age = student?.dateOfBirth ? ageOn(student.dateOfBirth, cairoYmd()) : null
  return successResponse({
    mode: 'STUDENT',
    student: { firstName: student?.firstName },
    kidMode: age !== null && age <= settings.kidModeMaxAge,
    groups: await studentLessonsOverview(v!.studentId),
  })
}
