/**
 * GET /api/birthdays?range=today|week|month&kind=ALL|STUDENT|GUARDIAN|STAFF&campusId=&groupId=
 * Phase C birthdays page (birthdays:read). Branch staff: their branch.
 * Instructors: only the students of their own groups.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { birthdayPeople, birthdayText, type PersonKind } from '@/lib/birthdays/birthdays'
import { cairoToday } from '@/lib/dates/cairo'

const DAYS: Record<string, number> = { today: 0, week: 6, month: 30 }

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'birthdays', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const days = DAYS[sp.get('range') ?? 'today'] ?? 0
  const kind = sp.get('kind') ?? 'ALL'
  let kinds: PersonKind[] = kind === 'ALL' ? ['STUDENT', 'GUARDIAN', 'STAFF'] : [kind as PersonKind]
  let groupIds: string[] | null = sp.get('groupId') ? [sp.get('groupId')!] : null
  let campusId = campusScope(role, session.user.campusId, sp.get('campusId'))
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return errors.forbidden()
    const own = await getTeacherClassSectionIds(t.id)
    groupIds = groupIds ? groupIds.filter((g) => own.includes(g)) : own
    kinds = ['STUDENT']
    campusId = undefined
  }
  if (groupIds && !groupIds.length) return successResponse({ today: cairoToday(), people: [] })
  const people = await birthdayPeople({ days, kinds, campusId, groupIds })
  return successResponse({ today: cairoToday(), people: people.map((p) => ({ ...p, greeting: birthdayText(p.name.split(' ')[0]) })) })
}
