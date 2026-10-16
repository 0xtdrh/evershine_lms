/** Rules & policies: PATCH /api/group-rules/[id] — edit a written rule; DELETE — remove it. RBAC agreements:update. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { saveWrittenRule } from '@/lib/rules/group-rules-engine'
import { writtenRuleSchema } from '@/lib/rules/validation'

type P = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const { id } = await params
  if (!(await prisma.groupRule.count({ where: { id } }))) return errors.notFound('Rule')
  const parsed = writtenRuleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveWrittenRule(session.user.id, id, parsed.data as never), 'Saved')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const r = await prisma.groupRule.deleteMany({ where: { id: (await params).id } })
  return r.count ? successResponse({ deleted: true }) : errors.notFound('Rule')
}
