/**
 * Rules & policies: GET /api/groups/[id]/rules — the group's rules (automatic + written) and which families accepted
 * the current rules. Staff who can see the group; a parent of a child in the group gets the rules only (for printing).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { canSeeGroup } from '@/lib/places/server'
import { groupRulesStatus, rulesForGroup } from '@/lib/rules/group-rules-engine'

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const role = session.user.role as Role
  if (role === 'PARENT' || role === 'GUARDIAN') {
    const mine = await prisma.studentEnrollment.count({ where: { classSectionId: id, student: { OR: [{ guardians: { some: { userId: session.user.id } } }, { parents: { some: { userId: session.user.id } } }] } } })
    if (!mine) return errors.forbidden()
    const r = await rulesForGroup(id)
    return r ? successResponse({ items: r.items, hash: r.hash, families: [] }) : errors.notFound('Group')
  }
  if (!checkPermission(role, 'class_sections', 'read') || !(await canSeeGroup(session.user, id))) return errors.forbidden()
  const s = await groupRulesStatus(id)
  return s ? successResponse(s) : errors.notFound('Group')
}
