/**
 * LMS L3: homework rules (late, penalty, handing in again, excuse extension, parents for young children).
 * GET (curriculum:read) = company + per level. PUT (curriculum:approve) { company?, level?: { id, policy | null } }.
 * A single group is changed from its gradebook (PATCH /api/groups/[id]/assignments).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { getPolicySettings, savePolicySettings } from '@/lib/assignments/engine'
import { policySchema, POLICY_DEFAULTS } from '@/lib/assignments/rules'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'read')
  if (denied) return denied
  const ps = await getPolicySettings()
  return successResponse({ company: { ...POLICY_DEFAULTS, ...ps.company }, levels: ps.levels ?? {} })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'approve')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ company: policySchema.optional(), level: z.object({ id: z.string().min(1), policy: policySchema.nullable() }).optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const ps = await getPolicySettings()
  const next = { ...ps, levels: { ...(ps.levels ?? {}) } }
  if (parsed.data.company) next.company = parsed.data.company as never
  if (parsed.data.level) {
    if (parsed.data.level.policy) next.levels[parsed.data.level.id] = parsed.data.level.policy as never
    else delete next.levels[parsed.data.level.id]
  }
  await savePolicySettings(next, session.user.id)
  return successResponse({ company: next.company, levels: next.levels }, 'Saved')
}
