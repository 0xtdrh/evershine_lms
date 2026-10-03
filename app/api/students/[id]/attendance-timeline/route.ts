/**
 * GET /api/students/[id]/attendance-timeline — phase C: the student's sessions per
 * group/month (session N of M, date, status, excuse reason), attendance %, perfect
 * attendance. For staff, the student's instructors, parents and the student.
 */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { studentAttendanceTimeline } from '@/lib/attendance/timeline'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  if (!(await studentViewer(session.user, id))) return errors.forbidden()
  return successResponse(await studentAttendanceTimeline(id))
}
