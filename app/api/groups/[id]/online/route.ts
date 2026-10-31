/**
 * L5: the group's online class link — GET (?date= → + that day's own link) / PATCH { url } or { date, sessionUrl }
 * (instructor and managers; not secretaries). Empty = not online / no own link that day (a02 M1 batch 6: SessionMeetingLink).
 */

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

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const row = await prisma.classSection.findUnique({ where: { id }, select: { onlineMeetingUrl: true } })
  const date = new URL(req.url).searchParams.get('date')
  const day = date && DAY.test(date) ? await prisma.sessionMeetingLink.findUnique({ where: { classSectionId_date: { classSectionId: id, date: new Date(`${date}T00:00:00Z`) } }, select: { url: true } }) : null
  return successResponse({ url: row?.onlineMeetingUrl ?? null, sessionUrl: day?.url ?? null })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const body = (await req.json().catch(() => null)) as { url?: string | null; date?: string; sessionUrl?: string | null } | null
  if (body?.date !== undefined) {
    if (!DAY.test(String(body.date))) return errors.badRequest('Pick a day')
    const c = cleanMeetingUrl(body.sessionUrl ?? null)
    if (!c.ok) return errors.badRequest(c.message ?? 'The link is not valid')
    const where = { classSectionId_date: { classSectionId: id, date: new Date(`${body.date}T00:00:00Z`) } }
    if (!c.url) await prisma.sessionMeetingLink.deleteMany({ where: where.classSectionId_date })
    else await prisma.sessionMeetingLink.upsert({ where, create: { ...where.classSectionId_date, url: c.url }, update: { url: c.url } })
    return successResponse({ sessionUrl: c.url })
  }
  const c = cleanMeetingUrl(body?.url ?? null)
  if (!c.ok) return errors.badRequest(c.message ?? 'The link is not valid')
  await prisma.classSection.update({ where: { id }, data: { onlineMeetingUrl: c.url } })
  return successResponse({ url: c.url })
}
