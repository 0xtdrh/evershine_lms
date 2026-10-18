/**
 * GET /api/usage?from&to&role&q — 2026-10-18 usage report: per person, how many visits / sign-ins, active time,
 * average visit length and last seen in the period (default: this month). audit_logs:read; places-limited
 * (a branch person sees the people of their places: staff, instructors, students, parents).
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { visibleUserIds } from '@/lib/places/server'
import { summarize } from '@/lib/activity/usage'
import { cairoToday } from '@/lib/dates/cairo'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ROLE_GROUPS: Record<string, string[]> = {
  STUDENT: ['STUDENT'], PARENT: ['PARENT', 'GUARDIAN'], TEACHER: ['TEACHER'],
  STAFF: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING'],
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'audit_logs', 'read')) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const today = cairoToday()
  const fromS = DATE.test(sp.get('from') ?? '') ? sp.get('from')! : `${today.slice(0, 7)}-01`
  const toS = DATE.test(sp.get('to') ?? '') ? sp.get('to')! : today
  const ids = await visibleUserIds({ id: session.user.id, role })
  const roles = ROLE_GROUPS[sp.get('role') ?? '']
  const rows = await prisma.userActivityDay.findMany({
    where: {
      day: { gte: new Date(`${fromS}T00:00:00.000Z`), lte: new Date(`${toS}T00:00:00.000Z`) },
      ...(ids ? { userId: { in: ids.length ? ids : ['__none__'] } } : {}),
      ...(roles ? { role: { in: roles } } : {}),
    },
    select: { userId: true, role: true, visits: true, activeSeconds: true, logins: true, lastAt: true },
  })
  const byUser = new Map<string, typeof rows>()
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
  const users = await prisma.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, displayName: true, email: true, role: true } })
  const q = (sp.get('q') ?? '').trim().toLowerCase()
  const people = users
    .map((u) => ({ userId: u.id, name: u.displayName || u.email, role: u.role, ...summarize(byUser.get(u.id) ?? []) }))
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
  // people of the same roles who never opened TechNova in the period (only when a role is chosen; capped)
  let never: { userId: string; name: string; role: string }[] = []
  if (roles) {
    const quiet = await prisma.user.findMany({
      where: { role: { in: roles as never[] }, isActive: true, id: { notIn: [...byUser.keys()].length ? [...byUser.keys()] : ['__none__'] }, ...(ids ? { AND: [{ id: { in: ids.length ? ids : ['__none__'] } }] } : {}) },
      select: { id: true, displayName: true, email: true, role: true }, take: 200, orderBy: { displayName: 'asc' },
    })
    never = quiet.map((u) => ({ userId: u.id, name: u.displayName || u.email, role: u.role }))
  }
  const total = summarize(rows)
  return successResponse({ from: fromS, to: toS, total: { people: people.length, visits: total.visits, activeSeconds: total.activeSeconds, logins: total.logins, avgVisitMin: total.avgVisitMin }, people: people.slice(0, 500), never })
}
