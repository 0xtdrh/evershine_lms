/** P1: POST { showProjects, showPhoto } — the parent makes a share link (expires; no phone, money, grades or attendance). */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, createdResponse } from '@/lib/api-response'
import { createShare } from '@/lib/passport/engine'

export async function POST(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { studentId } = await params
  const body = (await req.json().catch(() => null)) as { showProjects?: boolean; showPhoto?: boolean; showSkills?: boolean } | null
  const r = await createShare({ id: session.user.id, role: session.user.role as Role }, studentId, { showProjects: !!body?.showProjects, showPhoto: !!body?.showPhoto, showSkills: !!body?.showSkills })
  if (!r.ok) return r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : errors.conflict(r.message ?? 'Cannot share')
  return createdResponse(r.value)
}
