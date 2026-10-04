/** GET/PUT /api/referrals/settings — phase D: reward on/off + amount, welcome discount on/off + type, ambassador threshold. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getReferralSettings, saveReferralSettings } from '@/lib/referrals/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'referrals', 'read')
  if (denied) return denied
  const [settings, types] = await Promise.all([
    getReferralSettings(),
    prisma.discountType.findMany({ where: { isActive: true }, select: { id: true, name: true, valueType: true, value: true, duration: true }, orderBy: { name: 'asc' } }),
  ])
  return successResponse({ settings, discountTypes: types.map((t) => ({ ...t, value: Number(t.value) })) })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'referrals', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    rewardEnabled: z.boolean(),
    rewardAmount: z.number().min(0).max(100000),
    welcomeEnabled: z.boolean(),
    welcomeTypeId: z.string().min(1).nullable(),
    ambassadorAt: z.number().int().min(1).max(100),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data as Required<typeof parsed.data>
  if (v.welcomeEnabled && !v.welcomeTypeId) return errors.badRequest('Choose the discount type for the welcome discount')
  if (v.welcomeTypeId && !(await prisma.discountType.findUnique({ where: { id: v.welcomeTypeId }, select: { id: true } }))) return errors.badRequest('Unknown discount type')
  await saveReferralSettings(v, session.user.id)
  return successResponse(v, 'Saved')
}
