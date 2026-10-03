/** POST /api/students/[id]/wallet/transfer { toStudentId, amount } — staff move wallet money to a sibling (phase B). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { transferBetweenSiblings } from '@/lib/wallet/engine'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'create')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ toStudentId: z.string().min(1), amount: z.number().positive() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const s = await prisma.student.findUnique({ where: { id }, select: { campusId: true } })
  if (!s) return errors.notFound('Student')
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && s.campusId !== campusId) return errors.forbidden()
  const r = await transferBetweenSiblings({ fromId: id, toId: parsed.data.toStudentId!, amount: parsed.data.amount!, userId: session.user.id })
  if ('message' in r) return errors.badRequest(r.message)
  return successResponse(r, 'Moved to the sibling’s wallet')
}
