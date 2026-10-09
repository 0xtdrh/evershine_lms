/**
 * LMS L2: a group's lessons for the people who run it (admin, branch manager of the branch, the instructor, a
 * confirmed substitute — not secretaries). GET = every curriculum session with open / locked state + group notes.
 * PATCH { sessionNumber, action: open | lock | auto } or { mode: ALL | SCHEDULE | ATTENDANCE | MANUAL | PREVIOUS | null }
 * or { useLatest: true } (managers: move the group to the newest published curriculum version).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { canManageGroupLessons, groupLessons, groupNotes, moveGroupToLatest, setGroupMode, setLessonOverride } from '@/lib/lms/engine'
import { UNLOCK_MODES } from '@/lib/lms/unlock'
import { isModuleOn } from '@/lib/platform/settings'

type Ctx = { params: Promise<{ id: string }> }

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id))) return { err: errors.forbidden() }
  return { session }
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const data = await groupLessons(id)
  if (!data) return errors.notFound('Group')
  return successResponse({
    ...data, notes: await groupNotes(id), portalOn: await isModuleOn('lms'),
    canChangeMode: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(g.session!.user.role), modes: UNLOCK_MODES,
  })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.union([
    z.object({ sessionNumber: z.number().int().min(1).max(500), action: z.enum(['open', 'lock', 'auto']) }),
    z.object({ mode: z.enum(UNLOCK_MODES).nullable() }),
    z.object({ useLatest: z.literal(true) }),
  ]).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { sessionNumber?: number; action?: 'open' | 'lock' | 'auto'; mode?: string | null; useLatest?: boolean }
  const manager = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(g.session!.user.role)
  if (d.useLatest) {
    if (!manager) return errors.forbidden('Only managers move a group to a new curriculum version')
    const o = await moveGroupToLatest(id)
    if (!o.ok) return errors.badRequest(o.message!)
    return successResponse(o.value, `Now on version ${o.value!.number}`)
  }
  if (d.sessionNumber) {
    const o = await setLessonOverride(id, d.sessionNumber, d.action!, g.session!.user.id)
    if (!o.ok) return errors.notFound('Group')
  } else {
    if (!['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(g.session!.user.role)) return errors.forbidden('Only managers change how lessons open')
    const o = await setGroupMode(id, d.mode ?? null)
    if (!o.ok) return errors.badRequest(o.message!)
  }
  return successResponse(null, 'Saved')
}
