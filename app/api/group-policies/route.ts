/**
 * GET    /api/group-policies — six phases E: how students enter groups and when groups may start, per scope (+ names to choose).
 * PUT    /api/group-policies — add / change one rule (Super Admin / Admin; "start anyway" is the Super Admin's switch).
 * DELETE /api/group-policies?id= — remove one.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { policySchema } from '@/lib/groups/policy'

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
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'class_sections', 'read')
  if (denied) return denied
  const [rows, options] = await Promise.all([prisma.groupPolicy.findMany({ orderBy: { createdAt: 'asc' } }), names()])
  return successResponse({ rows, options, canEdit: ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role), canStartAnyway: session.user.role === 'SUPER_ADMIN' })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return errors.forbidden()
  const parsed = policySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  const scopeId = v.scopeType === 'COMPANY' ? null : v.scopeId!
  const old = await prisma.groupPolicy.findFirst({ where: { scopeType: v.scopeType, scopeId } })
  // the owner's switch: only the Super Admin may change "start anyway"
  if (session.user.role !== 'SUPER_ADMIN' && v.startAnyway !== undefined && (v.startAnyway ?? null) !== (old?.startAnyway ?? null)) return errors.forbidden('Only the Super Admin changes "start anyway" · «يبدأ برضه» في إيد السوبر أدمن بس')
  const data = {
    scopeType: v.scopeType, scopeId, entry: v.entry ?? null, minStudents: v.minStudents ?? null, countPaidOnly: v.countPaidOnly ?? null,
    minPartPercent: v.minPartPercent ?? null, alertDays: v.alertDays ?? null, nextMonthKeepDays: v.nextMonthKeepDays ?? null,
    startAnyway: session.user.role === 'SUPER_ADMIN' ? v.startAnyway ?? null : old?.startAnyway ?? null,
  }
  const row = old ? await prisma.groupPolicy.update({ where: { id: old.id }, data }) : await prisma.groupPolicy.create({ data })
  return successResponse(row)
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return errors.forbidden()
  const id = request.nextUrl.searchParams.get('id') ?? ''
  const row = await prisma.groupPolicy.findUnique({ where: { id } })
  if (!row) return errors.notFound('Rule')
  if (row.startAnyway !== null && session.user.role !== 'SUPER_ADMIN') return errors.forbidden()
  await prisma.groupPolicy.delete({ where: { id } })
  return successResponse({ ok: true })
}
