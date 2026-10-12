/** P1: GET — everything for the printable booklet / passport / transcript (branch staff only). */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { printData } from '@/lib/passport/engine'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { studentId } = await params
  const d = await printData({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, studentId)
  if (!d) return errors.forbidden('Only branch staff print the passport')
  return successResponse(d)
}
