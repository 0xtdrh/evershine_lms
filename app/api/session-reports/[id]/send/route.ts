/** R1: POST — the instructor sends the session report now (draft only). */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { sendNow } from '@/lib/session-reports/engine'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const r = await sendNow({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, id)
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound('Report') : r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : errors.conflict(r.message ?? 'Cannot send')
  return successResponse({ sent: true })
}
