/**
 * GET/PUT /api/wallet/rules — minimum top-up and "withdrawals allowed" per scope (phase B).
 * PUT replaces all rules: { rules: [{ kind: MIN_TOPUP|WITHDRAW, scopeType, scopeId?, minAmount?, allowed? }] }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'finance_settings', 'read')
  if (denied) return denied
  const rows = await prisma.walletRule.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] })
  return successResponse(rows.map((r) => ({ ...r, minAmount: r.minAmount == null ? null : Number(r.minAmount) })))
}

const schema = z.object({
  rules: z.array(z.object({
    kind: z.enum(['MIN_TOPUP', 'WITHDRAW']),
    scopeType: z.enum(['ALL', 'TRACK', 'COURSE', 'LEVEL', 'GROUP']),
    scopeId: z.string().min(1).nullable().optional(),
    minAmount: z.number().min(0).nullable().optional(),
    allowed: z.boolean().optional(),
  })).max(200),
})

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'finance_settings', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const rules = parsed.data.rules ?? []
  for (const r of rules) {
    if (r.scopeType !== 'ALL' && !r.scopeId) return errors.badRequest('Choose what the rule applies to')
    if (r.kind === 'MIN_TOPUP' && !(r.minAmount != null && r.minAmount >= 0)) return errors.badRequest('A minimum top-up rule needs an amount')
  }
  await prisma.$transaction([
    prisma.walletRule.deleteMany({}),
    prisma.walletRule.createMany({
      data: rules.map((r) => ({
        kind: r.kind!, scopeType: r.scopeType!, scopeId: r.scopeType === 'ALL' ? null : r.scopeId ?? null,
        minAmount: r.kind === 'MIN_TOPUP' ? r.minAmount ?? 0 : null, allowed: r.kind === 'WITHDRAW' ? r.allowed !== false : true,
      })),
    }),
  ])
  return successResponse({ saved: rules.length }, 'Saved')
}
