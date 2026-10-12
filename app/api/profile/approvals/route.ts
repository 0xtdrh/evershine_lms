/** P2: GET — thank-you notes and student uploads waiting for the instructor / managers; POST { what, id, approve }. */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { decide, pendingApprovals } from '@/lib/profile/engine'

async function who() {
  const session = await auth()
  return session?.user ? { id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId } : null
}

export async function GET() {
  const user = await who()
  if (!user) return errors.unauthorized()
  return successResponse(await pendingApprovals(user))
}

export async function POST(req: Request) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const body = (await req.json().catch(() => null)) as { what?: string; id?: string; approve?: boolean } | null
  if ((body?.what !== 'THANKS' && body?.what !== 'UPLOAD') || !body.id) return errors.badRequest('Unknown item')
  const r = await decide(user, body.what, body.id, !!body.approve)
  return r.ok ? successResponse({ saved: true }) : r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : errors.notFound(r.message ?? 'Not found')
}
