/** Partners part 1-B2: GET /api/partners/[id]/activities — calls, meetings, visits; POST — log one (optional follow-up date). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { listActivities, saveActivity } from '@/lib/partners/relations'
import { activitySchema } from '@/lib/partners/validation'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  return successResponse(await listActivities((await params).id))
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  if (!(await prisma.partner.count({ where: { id } }))) return errors.notFound('Partner')
  const parsed = activitySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return createdResponse(await saveActivity(session.user.id, id, null, parsed.data as never), 'Saved')
}
