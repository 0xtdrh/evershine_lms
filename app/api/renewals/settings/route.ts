/** GET/PUT /api/renewals/settings { sessionsBefore } — when parents are asked "continuing?" (phase A). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getRenewalSettings, saveRenewalSettings } from '@/lib/groups/renewal'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'renewals', 'read')
  if (denied) return denied
  return successResponse(await getRenewalSettings())
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'finance_settings', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ sessionsBefore: z.number().int().min(0).max(20) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  await saveRenewalSettings({ sessionsBefore: parsed.data.sessionsBefore ?? 2 }, session.user.id)
  return successResponse(parsed.data, 'Saved')
}
