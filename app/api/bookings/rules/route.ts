/**
 * GET    /api/bookings/rules — six phases 1-B: how bookings are confirmed (AUTO / STAFF) and how long a seat is held, per scope.
 * PUT    /api/bookings/rules { scopeType, scopeId, confirm, holdHours } — add / change one (Super Admin / Admin).
 * DELETE /api/bookings/rules?id= — remove one.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { staffSession } from '@/lib/accounts/staff'
import { ruleSchema } from '@/lib/bookings/rules'

async function names() {
  const [campuses, tracks, courses, levels, groups] = await Promise.all([
    prisma.campus.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.level.findMany({ where: { isActive: true }, select: { id: true, name: true, subject: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    prisma.classSection.findMany({ where: { status: 'ACTIVE', isActive: true, kind: 'GROUP' }, select: { id: true, className: true, sectionName: true }, orderBy: { className: 'asc' }, take: 300 }),
  ])
  return {
    CAMPUS: campuses, TRACK: tracks, COURSE: courses,
    LEVEL: levels.map((l) => ({ id: l.id, name: `${l.subject?.name ?? ''} — ${l.name}` })),
    GROUP: groups.map((g) => ({ id: g.id, name: [g.className, g.sectionName].filter(Boolean).join(' ') })),
  }
}

export async function GET() {
  const s = await staffSession('read')
  if (s.error) return s.error
  const [rules, options] = await Promise.all([prisma.bookingRule.findMany({ orderBy: { createdAt: 'asc' } }), names()])
  return successResponse({ rules, options })
}

export async function PUT(request: NextRequest) {
  const s = await staffSession('update')
  if (s.error) return s.error
  if (!['SUPER_ADMIN', 'ADMIN'].includes(s.user.role)) return errors.forbidden()
  const parsed = ruleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  const scopeId = v.scopeType === 'COMPANY' ? null : v.scopeId!
  const old = await prisma.bookingRule.findFirst({ where: { scopeType: v.scopeType, scopeId } })
  const data = { scopeType: v.scopeType, scopeId, confirm: v.confirm, holdHours: v.holdHours ?? null }
  const row = old ? await prisma.bookingRule.update({ where: { id: old.id }, data }) : await prisma.bookingRule.create({ data })
  return successResponse(row)
}

export async function DELETE(request: NextRequest) {
  const s = await staffSession('update')
  if (s.error) return s.error
  if (!['SUPER_ADMIN', 'ADMIN'].includes(s.user.role)) return errors.forbidden()
  const r = await prisma.bookingRule.deleteMany({ where: { id: request.nextUrl.searchParams.get('id') ?? '' } })
  return r.count ? successResponse({ ok: true }) : errors.notFound('Rule')
}
