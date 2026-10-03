/**
 * GET/PUT /api/absence-excuses/rules — phase C excuse settings per scope.
 * PUT replaces all rules: { rules: [{ scopeType: ALL|TRACK|COURSE|GROUP, scopeId?, autoApprove, daysAfter }] }
 * No rule = accepted automatically, up to 2 days after the session.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { EXCUSE_DEFAULT } from '@/lib/excuses/rules'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'absence_excuses', 'read')
  if (denied) return denied
  const rows = await prisma.excuseRule.findMany({ orderBy: { createdAt: 'asc' } })
  return successResponse({ rules: rows, defaults: EXCUSE_DEFAULT })
}

const schema = z.object({
  rules: z.array(z.object({
    scopeType: z.enum(['ALL', 'TRACK', 'COURSE', 'GROUP']),
    scopeId: z.string().min(1).nullable().optional(),
    autoApprove: z.boolean(),
    daysAfter: z.number().int().min(0).max(30),
  })).max(200),
})

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'absence_excuses', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const rules = parsed.data.rules
  if (rules.some((r) => r.scopeType !== 'ALL' && !r.scopeId)) return errors.badRequest('Choose the track, course or group for each rule')
  const keys = rules.map((r) => `${r.scopeType}|${r.scopeType === 'ALL' ? '' : r.scopeId}`)
  if (new Set(keys).size !== keys.length) return errors.badRequest('Each scope can have only one rule')
  await prisma.$transaction([
    prisma.excuseRule.deleteMany({}),
    prisma.excuseRule.createMany({ data: rules.map((r) => ({ scopeType: r.scopeType, scopeId: r.scopeType === 'ALL' ? null : r.scopeId!, autoApprove: r.autoApprove, daysAfter: r.daysAfter })) }),
  ])
  return successResponse({ rules: await prisma.excuseRule.findMany({ orderBy: { createdAt: 'asc' } }) }, 'Saved')
}
