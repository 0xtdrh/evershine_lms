/**
 * GET /api/students/[id]/watch — six phases 2: the student's video watching per group (minutes this week / in all, videos
 * watched of the total, recent ones). id = "me" for the signed-in student. Staff, instructors, parents and the student.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { studentWatchSummary } from '@/lib/videos/watch-engine'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  let { id } = await params
  if (id === 'me') {
    const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
    if (!s) return successResponse([])
    id = s.id
  }
  if (!(await studentViewer(session.user, id))) return errors.forbidden()
  return successResponse(await studentWatchSummary(id))
}
