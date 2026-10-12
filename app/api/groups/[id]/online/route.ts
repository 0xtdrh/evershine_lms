/** L5: the group's online class link — GET / PATCH { url } (instructor and managers; not secretaries). Empty = not online. */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { canManageGroupLessons } from '@/lib/lms/engine'
import { cleanMeetingUrl } from '@/lib/online/rules'

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, id))) return { err: errors.forbidden() }
  return {}
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const row = await prisma.classSection.findUnique({ where: { id }, select: { onlineMeetingUrl: true } })
  return successResponse({ url: row?.onlineMeetingUrl ?? null })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const body = (await req.json().catch(() => null)) as { url?: string | null } | null
  const c = cleanMeetingUrl(body?.url ?? null)
  if (!c.ok) return errors.badRequest(c.message ?? 'The link is not valid')
  await prisma.classSection.update({ where: { id }, data: { onlineMeetingUrl: c.url } })
  return successResponse({ url: c.url })
}
