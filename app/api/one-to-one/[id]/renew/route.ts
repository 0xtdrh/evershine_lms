/**
 * a02 M3: POST — next cycle of a One-to-One, through the same route as a group's "advance cycle" (its rules apply: all sessions
 * held, unpaid fees block). Same plan and people; when the level's sessions are done it moves to the next level.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api-response'
import { callRoute } from '@/lib/api/call-route'
import { assertOneToOne } from '@/lib/one-to-one/engine'
import { httpCtx, oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { POST as advance } from '@/app/api/groups/[id]/advance-cycle/route'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function POST_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  const { id } = await params
  try { await assertOneToOne(u.user, id) } catch (e) { return oneToOneError(e) }
  const body = (await request.json().catch(() => null)) as { force?: boolean; carry?: boolean } | null
  const rows = await prisma.studentEnrollment.findMany({ where: { classSectionId: id, status: 'ACTIVE' }, select: { studentId: true } })
  const ctx = httpCtx(request)
  const r = await callRoute(advance as never, ctx.origin, ctx.cookie, `/api/groups/${id}/advance-cycle`, 'POST', { continuingStudentIds: rows.map((x) => x.studentId), ...(body?.force && { force: true }), ...(body?.carry && { carry: true }) }, { id })
  if (!r.ok) return errorResponse(r.code ?? 'CONFLICT', r.message, r.status)
  return successResponse(r.data)
}

export const POST = withMonthLock(POST_)
