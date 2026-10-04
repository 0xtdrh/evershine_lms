/**
 * Phase D referrals (staff).
 * GET  — report: every referral, top referrers, totals (referrals:read; branch staff: their branch)
 * GET  ?studentId= — the referral of one student (who referred them), or null
 * POST { studentId, codeOrPhone } — link a student to the parent who referred them (referrals:create)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { linkReferral, referralReport } from '@/lib/referrals/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const studentId = new URL(request.url).searchParams.get('studentId')
  if (studentId) {
    const denied = requirePermission(role, 'students', 'read')
    if (denied) return denied
    const r = await prisma.referral.findUnique({ where: { referredStudentId: studentId } })
    if (!r) return successResponse(null)
    const g = await prisma.guardian.findUnique({ where: { id: r.referrerGuardianId }, select: { firstName: true, lastName: true, phoneNumber: true } })
    return successResponse({ id: r.id, code: r.code, status: r.status, reward: Number(r.rewardAmount ?? 0), createdAt: r.createdAt, referrer: g ? { name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber } : null })
  }
  const denied = requirePermission(role, 'referrals', 'read')
  if (denied) return denied
  return successResponse(await referralReport(campusScope(role, session.user.campusId, null)))
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'referrals', 'create')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ studentId: z.string().min(1), codeOrPhone: z.string().trim().min(3).max(40) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await linkReferral({ studentId: parsed.data.studentId!, codeOrPhone: parsed.data.codeOrPhone!, userId: session.user.id })
  if (!r.ok) return r.code === 404 ? errors.badRequest(r.message!) : errors.conflict(r.message!)
  return createdResponse(r, r.welcome ? 'Referral linked — welcome discount added' : 'Referral linked')
}
