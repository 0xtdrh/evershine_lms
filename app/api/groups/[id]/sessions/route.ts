/**
 * Partners part 1: sessions recorded without per-student attendance.
 * GET — the list; POST { date, status HELD|CANCELLED_PARTNER|CANCELLED_TECHNOVA, headcount?, note? } — record (HELD only for
 * classes without names); DELETE ?logId= — remove. Same permission as attendance; the group must be visible to the person.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { canSeeGroup } from '@/lib/places/server'
import { deleteSessionLog, listSessionLogs, logSession } from '@/lib/groups/session-log'
import { sessionLogSchema } from '@/lib/partners/validation'

type P = { params: Promise<{ id: string }> }

async function gate(user: { id: string; role: string }, id: string, action: 'read' | 'create') {
  const denied = requirePermission(user.role as Role, 'attendance', action)
  if (denied) return denied
  if (!(await canSeeGroup(user, id))) return errors.forbidden()
  return null
}

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const denied = await gate(session.user, id, 'read')
  if (denied) return denied
  return successResponse(await listSessionLogs(id))
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const denied = await gate(session.user, id, 'create')
  if (denied) return denied
  const parsed = sessionLogSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await logSession(session.user.id, id, parsed.data as never)
  if (!r.ok) return errors.badRequest((r as { message: string }).message)
  return successResponse({ saved: true }, 'Saved')
}

export async function DELETE(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const denied = await gate(session.user, id, 'create')
  if (denied) return denied
  const logId = new URL(request.url).searchParams.get('logId') ?? ''
  return (await deleteSessionLog(id, logId)) ? successResponse({ deleted: true }) : errors.notFound('Session')
}
