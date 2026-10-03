/**
 * Extra one-off sessions for a group (phase A), e.g. to make up a holiday so
 * the month does not run late. They count like normal sessions.
 *
 * GET  /api/groups/[id]/extra-sessions
 * POST /api/groups/[id]/extra-sessions { date: YYYY-MM-DD, time: HH:MM, reason? }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'

async function loadGroup(id: string, role: Role, userCampusId: string | null | undefined) {
  const g = await prisma.classSection.findUnique({ where: { id }, select: { id: true, campusId: true } })
  if (!g) return { error: errors.notFound('Group') }
  const campusId = campusScope(role, userCampusId, null)
  if (campusId && g.campusId !== campusId) return { error: errors.forbidden() }
  return { group: g }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied
  const { id } = await params
  const r = await loadGroup(id, role, session.user.campusId)
  if (r.error) return r.error
  const rows = await prisma.extraSession.findMany({ where: { classSectionId: id }, orderBy: { date: 'asc' } })
  return successResponse(rows.map((x) => ({ id: x.id, date: x.date.toISOString().slice(0, 10), time: x.time, reason: x.reason })))
}

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().max(200).optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied
  const { id } = await params
  const r = await loadGroup(id, role, session.user.campusId)
  if (r.error) return r.error
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`)
  const clash = await prisma.extraSession.findUnique({ where: { classSectionId_date: { classSectionId: id, date } } })
  if (clash) return errors.conflict('This group already has an extra session on that day')
  const row = await prisma.extraSession.create({
    data: { classSectionId: id, date, time: parsed.data.time, reason: parsed.data.reason ?? null, createdById: session.user.id },
  })
  return createdResponse({ id: row.id }, 'Extra session added')
}
