/** PATCH /api/wallet/withdrawals/[id] { action: approve|reject, reason? } (phase B). */

import { canSeeStudent } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { decideWithdrawal } from '@/lib/wallet/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

const bodySchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional().nullable() })

async function PATCH_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'approve')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const w = await prisma.walletWithdrawal.findUnique({ where: { id }, select: { studentId: true } })
  if (!w) return errors.notFound('Request')
  const s = await prisma.student.findUnique({ where: { id: w.studentId }, select: { campusId: true } })
  if (!s || !(await canSeeStudent(session.user, w.studentId))) return errors.forbidden()
  const r = await decideWithdrawal(id, session.user.id, parsed.data.action === 'approve', parsed.data.reason)
  if ('message' in r) return r.status === 404 ? errors.notFound('Request') : errors.conflict(r.message)
  return successResponse(r, parsed.data.action === 'approve' ? 'Withdrawal approved' : 'Withdrawal rejected')
}

// a03: a write into a closed month answers 409 with the reason
export const PATCH = withMonthLock(PATCH_)
