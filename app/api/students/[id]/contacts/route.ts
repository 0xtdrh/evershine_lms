/** GET /api/students/[id]/contacts — the student's contact log, newest first (phase A). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { staffNames } from '@/lib/contacts/contact-log'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'contact_logs', 'read')
  if (denied) return denied
  const { id } = await params
  const student = await prisma.student.findUnique({
    where: { id },
    select: { campusId: true, guardians: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
  })
  if (!student) return errors.notFound('Student')
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && student.campusId !== campusId) return errors.forbidden()
  const rows = await prisma.contactLog.findMany({ where: { studentId: id }, orderBy: { createdAt: 'desc' }, take: 200 })
  const names = await staffNames(rows.map((r) => r.createdById ?? ''))
  const G = new Map(student.guardians.map((g) => [g.id, `${g.firstName} ${g.lastName}`.trim()]))
  return successResponse({
    guardians: student.guardians.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber })),
    logs: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      direction: r.direction,
      reason: r.reason,
      summary: r.summary,
      followUpAt: r.followUpAt,
      followUpDoneAt: r.followUpDoneAt,
      auto: r.auto,
      createdAt: r.createdAt,
      guardian: r.guardianId ? G.get(r.guardianId) ?? null : null,
      by: r.createdById ? names.get(r.createdById) ?? null : r.auto ? 'System' : null,
    })),
  })
}
