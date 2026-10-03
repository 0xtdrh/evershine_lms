/**
 * Phase C: absence excuses for staff (docs/design-phase-c.md).
 * GET  ?status=PENDING|ALL&groupId= — branch staff: their branch; instructors: their own groups
 * POST { studentId, classSectionId, sessionDate, reason } — staff record an excuse a parent gave by phone
 *      (approved at once when the staff member may approve excuses)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { submitExcuse, decideExcuse, canDecideExcuses } from '@/lib/excuses/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'absence_excuses', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const status = sp.get('status') ?? 'PENDING'
  const groupId = sp.get('groupId')

  let groupIds: string[] | null = null
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return errors.forbidden()
    groupIds = await getTeacherClassSectionIds(t.id)
  } else {
    const scoped = campusScope(role, session.user.campusId, null)
    if (scoped) groupIds = (await prisma.classSection.findMany({ where: { campusId: scoped }, select: { id: true } })).map((g) => g.id)
  }
  if (groupId) groupIds = groupIds ? groupIds.filter((id) => id === groupId) : [groupId]

  const rows = await prisma.absenceExcuse.findMany({
    where: {
      ...(status !== 'ALL' && { status }),
      ...(groupIds && { classSectionId: { in: groupIds } }),
    },
    orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  })
  const [students, groups] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }),
    prisma.classSection.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.classSectionId))] } }, select: { id: true, className: true, sectionName: true } }),
  ])
  const sMap = new Map(students.map((s) => [s.id, s]))
  const gMap = new Map(groups.map((g) => [g.id, `${g.className} ${g.sectionName}`.trim()]))
  return successResponse({
    canDecide: canDecideExcuses(role),
    excuses: rows.map((r) => {
      const s = sMap.get(r.studentId)
      return {
        id: r.id,
        studentId: r.studentId,
        student: s ? `${s.firstName} ${s.lastName}` : '—',
        registrationNumber: s?.registrationNumber ?? '',
        classSectionId: r.classSectionId,
        group: gMap.get(r.classSectionId) ?? '—',
        sessionDate: r.sessionDate.toISOString().slice(0, 10),
        reason: r.reason,
        status: r.status,
        autoApproved: r.autoApproved,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt,
      }
    }),
  })
}

const bodySchema = z.object({
  studentId: z.string().min(1),
  classSectionId: z.string().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(500),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'absence_excuses', 'create')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const scoped = campusScope(role, session.user.campusId, null)
  if (scoped) {
    const g = await prisma.classSection.findUnique({ where: { id: parsed.data.classSectionId }, select: { campusId: true } })
    if (g?.campusId !== scoped) return errors.forbidden()
  }
  const r = await submitExcuse({ ...(parsed.data as Required<typeof parsed.data>), userId: session.user.id })
  if (!r.ok) return r.code === 404 ? errors.notFound('Enrollment') : errors.conflict(r.message)
  if (r.status === 'PENDING' && canDecideExcuses(role)) {
    const d = await decideExcuse({ id: r.id, action: 'approve', note: 'Recorded by staff', userId: session.user.id })
    if (d.ok) return createdResponse({ id: r.id, status: d.status }, 'Excuse recorded')
  }
  return createdResponse({ id: r.id, status: r.status }, 'Excuse recorded')
}
