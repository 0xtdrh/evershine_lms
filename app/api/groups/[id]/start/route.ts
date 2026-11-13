/**
 * GET  /api/groups/[id]/start — six phases E2: the group's start (state, count / minimum, expected start, first session).
 * POST /api/groups/[id]/start
 *      { action: 'EXPECTED', date, reason? }  — set / postpone the expected start (group_start:update; families told on a change)
 *      { action: 'FORCE' }                     — start below the minimum (group_start:approve, only when the policy allows it)
 *      { action: 'CANCEL', reason, choices }   — cancel a group that has not started (group_start:delete): money to the wallet,
 *                                                each student MOVE (toGroupId) / WAIT / LEAVE
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { canSeeGroup } from '@/lib/places/server'
import { cancelGroup, groupStart, setExpected, startAnyway, StartError, type CancelChoice } from '@/lib/groups/start'

type P = { params: Promise<{ id: string }> }

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('EXPECTED'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(200).nullable().optional() }),
  z.object({ action: z.literal('FORCE') }),
  z.object({ action: z.literal('CANCEL'), reason: z.string().trim().min(2).max(300), choices: z.array(z.object({ studentId: z.string().max(40), action: z.enum(['MOVE', 'WAIT', 'LEAVE']), toGroupId: z.string().max(40).nullable().optional() })).max(200).default([]) }),
])

function fail(e: unknown) {
  if (e instanceof StartError) return errorResponse(e.code, e.message, e.status)
  console.error('[GROUP_START]', e)
  return errors.internal()
}

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'class_sections', 'read')
  if (denied) return denied
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  try { return successResponse(await groupStart(id)) } catch (e) { return fail(e) }
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  const need = v.action === 'EXPECTED' ? 'update' : v.action === 'FORCE' ? 'approve' : 'delete'
  const denied = requirePermission(session.user.role as Role, 'group_start', need)
  if (denied) return denied
  try {
    if (v.action === 'EXPECTED') return successResponse(await setExpected(id, v.date, v.reason ?? null))
    if (v.action === 'FORCE') return successResponse(await startAnyway(id))
    return successResponse(await cancelGroup({ id: session.user.id, role: session.user.role }, id, v.reason, v.choices as CancelChoice[]))
  } catch (e) { return fail(e) }
}
