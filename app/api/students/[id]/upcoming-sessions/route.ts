/**
 * GET /api/students/[id]/upcoming-sessions — the student's coming sessions (next 4 weeks, max 8) with holidays
 * ("postponed"), cancellations and makeup sessions (lib/schedule/student-upcoming.ts). id = "me" for the signed-in
 * student. Staff, the student's instructors, parents and the student (studentViewer).
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { studentUpcomingSessions } from '@/lib/schedule/student-upcoming'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  let { id } = await params
  if (id === 'me') {
    const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
    if (!s) return successResponse({ today: null, sessions: [] })
    id = s.id
  }
  if (!(await studentViewer(session.user, id))) return errors.forbidden()
  return successResponse(await studentUpcomingSessions(id))
}
