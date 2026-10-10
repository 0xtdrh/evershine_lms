/**
 * LMS L3: a group's homework for the people who run it (not secretaries). GET = students × assignments gradebook.
 * PATCH { blockId, dueAt: ISO | null } (group due date) | { blockId, inClass: [studentIds], fullMarks? }
 * | { policy: {...} | null } (managers: this group's homework rules).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getPolicySettings, gradebook, markInClass, savePolicySettings, setGroupDue } from '@/lib/assignments/engine'
import { policySchema } from '@/lib/assignments/rules'
import { canManageGroupLessons } from '@/lib/lms/engine'

type Ctx = { params: Promise<{ id: string }> }

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  const user = { id: session.user.id, role: session.user.role, campusId: session.user.campusId }
  if (!(await canManageGroupLessons(user, id))) return { err: errors.forbidden() }
  return { user }
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const ps = await getPolicySettings()
  return successResponse({ ...(await gradebook(id)), groupPolicy: ps.groups?.[id] ?? null, canChangePolicy: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(g.user!.role) })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.union([
    z.object({ blockId: z.string().min(1), dueAt: z.string().datetime().nullable() }),
    z.object({ blockId: z.string().min(1), inClass: z.array(z.string()).min(1).max(200), fullMarks: z.boolean().default(false) }),
    z.object({ policy: policySchema.nullable() }),
  ]).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { blockId?: string; dueAt?: string | null; inClass?: string[]; fullMarks?: boolean; policy?: object | null }
  if ('policy' in d) {
    if (!['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(g.user!.role)) return errors.forbidden('Only managers change homework rules')
    const ps = await getPolicySettings()
    const groups = { ...(ps.groups ?? {}) }
    if (d.policy) groups[id] = d.policy as never
    else delete groups[id]
    await savePolicySettings({ ...ps, groups }, g.user!.id)
    return successResponse(null, 'Saved')
  }
  if (d.inClass) {
    const o = await markInClass(g.user!, id, d.blockId!, d.inClass, !!d.fullMarks)
    if (!o.ok) return errors.badRequest(o.message!)
    return successResponse(o.value, `Marked ${o.value!.count}`)
  }
  await setGroupDue(id, d.blockId!, d.dueAt ? new Date(d.dueAt) : null, g.user!.id)
  return successResponse(null, 'Saved')
}
