/**
 * Rules & policies: written group rules on four levels (company / place / level / group).
 * GET ?scope=&scopeId= — list (staff who can see groups); POST — add one (RBAC agreements:update).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { listWrittenRules, saveWrittenRule, RULE_SCOPES, type RuleScope } from '@/lib/rules/group-rules-engine'
import { writtenRuleSchema } from '@/lib/rules/validation'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'class_sections', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const scope = sp.get('scope') as RuleScope | null
  return successResponse(await listWrittenRules(scope && RULE_SCOPES.includes(scope) ? scope : undefined, sp.get('scopeId')))
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const parsed = writtenRuleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  if (parsed.data.scope !== 'GLOBAL' && !parsed.data.scopeId) return errors.badRequest('Choose the place, level or group')
  return createdResponse(await saveWrittenRule(session.user.id, null, parsed.data as never), 'Rule added')
}
