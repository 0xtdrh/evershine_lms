/**
 * Holidays (phase A, docs/design-phase-a.md): a day off for one branch or the
 * whole company. Sessions on that day move to the next scheduled slot.
 *
 * GET  /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
 * POST /api/holidays { date, name, campusId? (empty = whole company), toDate? (a range) }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { notifyHoliday } from '@/lib/notifications/session-events'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'holidays', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const campusId = campusScope(role, session.user.campusId, null)
  const rows = await prisma.holiday.findMany({
    where: {
      ...(from && DATE.test(from) && { date: { gte: day(from), ...(to && DATE.test(to) && { lte: day(to) }) } }),
      ...(campusId && { OR: [{ campusId: null }, { campusId }] }),
    },
    orderBy: { date: 'asc' },
  })
  const campuses = await prisma.campus.findMany({ where: { id: { in: rows.map((r) => r.campusId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
  const names = new Map(campuses.map((c) => [c.id, c.name]))
  return successResponse(rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    name: r.name,
    campus: r.campusId ? { id: r.campusId, name: names.get(r.campusId) ?? '' } : null,
  })))
}

const bodySchema = z.object({
  date: z.string().regex(DATE),
  toDate: z.string().regex(DATE).optional().nullable(),
  name: z.string().trim().min(2).max(100),
  campusId: z.preprocess((v) => (v === '' ? null : v), z.string().min(1).nullable().optional()),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'holidays', 'create')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data

  // Branch staff can only add holidays for their own branch; company-wide = Super Admin.
  const ownCampus = campusScope(role, session.user.campusId, null)
  const campusId = d.campusId ?? null
  if (ownCampus && campusId !== ownCampus) return errors.forbidden('You can only add holidays for your own branch')

  const end = d.toDate && d.toDate >= d.date ? d.toDate : d.date
  const days: string[] = []
  for (let x = day(d.date); x <= day(end) && days.length < 60; x = new Date(x.getTime() + 86_400_000)) days.push(x.toISOString().slice(0, 10))
  const existing = await prisma.holiday.findMany({ where: { date: { in: days.map(day) }, campusId }, select: { date: true } })
  const taken = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)))
  const fresh = days.filter((x) => !taken.has(x))
  if (fresh.length) {
    await prisma.holiday.createMany({ data: fresh.map((x) => ({ date: day(x), campusId, name: d.name, createdById: session.user.id })) })
    await notifyHoliday(campusId, fresh, d.name)
  }
  return createdResponse({ added: fresh.length, skipped: days.length - fresh.length }, fresh.length ? 'Holiday added' : 'Already a holiday')
}
