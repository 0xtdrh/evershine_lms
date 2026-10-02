/**
 * GET/PUT /api/refunds/rules — refund rules per scope (the list is replaced as sent).
 * Read: refunds:read or finance_settings:read. Write: finance_settings:update.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

const ruleSchema = z.object({
  scopeType: z.enum(['ALL', 'TRACK', 'COURSE', 'LEVEL', 'GROUP']),
  scopeId: z.string().optional().nullable(),
  allowed: z.boolean(),
  adminFeeType: z.enum(['FIXED', 'PERCENT']),
  adminFeeValue: z.number().min(0).max(100000),
  deductBasis: z.enum(['ATTENDED', 'HELD']),
  note: z.string().trim().max(300).optional().nullable(),
})
const bodySchema = z.object({ rules: z.array(ruleSchema).max(200) })

const shape = (r: { adminFeeValue: unknown }) => ({ ...r, adminFeeValue: Number(r.adminFeeValue) })

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'refunds', 'read') && !checkPermission(role, 'finance_settings', 'read')) return errors.forbidden()
  const rules = await prisma.refundRule.findMany({ orderBy: { createdAt: 'asc' } })
  return successResponse(rules.map(shape))
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'finance_settings', 'update')) return errors.forbidden()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const rules = parsed.data.rules!
  const keys = rules.map((r) => `${r.scopeType}:${r.scopeType === 'ALL' ? '' : r.scopeId ?? ''}`)
  if (new Set(keys).size !== keys.length) return errors.badRequest('Two rules are for the same place')
  if (rules.some((r) => r.scopeType !== 'ALL' && !r.scopeId)) return errors.badRequest('Choose where each rule applies')
  if (rules.some((r) => r.adminFeeType === 'PERCENT' && Number(r.adminFeeValue) > 100)) return errors.badRequest('A percentage cannot be more than 100')
  await prisma.$transaction(async (tx) => {
    await tx.refundRule.deleteMany({})
    for (const r of rules) {
      await tx.refundRule.create({
        data: {
          scopeType: r.scopeType!,
          scopeId: r.scopeType === 'ALL' ? null : r.scopeId ?? null,
          allowed: !!r.allowed,
          adminFeeType: r.adminFeeType!,
          adminFeeValue: Number(r.adminFeeValue),
          deductBasis: r.deductBasis!,
          note: r.note ?? null,
          createdById: session.user.id,
        },
      })
    }
  })
  const saved = await prisma.refundRule.findMany({ orderBy: { createdAt: 'asc' } })
  return successResponse(saved.map(shape), 'Saved')
}
