/** P1: GET — the student's passport (student own, parent, the student's instructors, branch staff). Checks new stamps first. */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { passportView } from '@/lib/passport/engine'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { studentId } = await params
  const v = await passportView({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, studentId)
  if (!v) return errors.forbidden()
  return successResponse(v)
}
