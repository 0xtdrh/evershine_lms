/** P2: PATCH { type: 'goal', id, progress } — move a free goal; DELETE ?type=goal|experience&id= — remove one. */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { removeExperience, updateGoal } from '@/lib/profile/engine'

async function who() {
  const session = await auth()
  return session?.user ? { id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId } : null
}

export async function PATCH(req: Request) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const body = (await req.json().catch(() => null)) as { type?: string; id?: string; progress?: number } | null
  if (body?.type !== 'goal' || !body.id) return errors.badRequest('Unknown item')
  const r = await updateGoal(user, body.id, { progress: Number(body.progress) })
  return r.ok ? successResponse({ saved: true }) : errors.badRequest(r.message ?? 'Not possible')
}

export async function DELETE(req: Request) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const q = new URL(req.url).searchParams
  const id = q.get('id') ?? ''
  const r = q.get('type') === 'goal' ? await updateGoal(user, id, { remove: true }) : q.get('type') === 'experience' ? await removeExperience(user, id) : { ok: false, message: 'Unknown item' }
  return r.ok ? successResponse({ removed: true }) : errors.notFound(r.message ?? 'Not found')
}
