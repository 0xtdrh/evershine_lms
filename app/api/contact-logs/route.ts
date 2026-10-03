/**
 * POST /api/contact-logs — log a call / WhatsApp / meeting / visit with a parent
 * (phase A). Body: { studentId, guardianId?, channel, direction?, reason, summary, followUpAt?, auto? }
 * `auto: true` = logged by a screen when staff clicked a WhatsApp button (receipt,
 * portal password, renewal reminder); any staff who can read students may send it.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse } from '@/lib/api-response'
import { requireSession, campusScope } from '@/lib/academic/api-helpers'
import { CONTACT_CHANNELS, CONTACT_REASONS, logContact } from '@/lib/contacts/contact-log'

const bodySchema = z.object({
  studentId: z.string().min(1),
  guardianId: z.string().min(1).optional().nullable(),
  channel: z.enum(CONTACT_CHANNELS),
  direction: z.enum(['OUT', 'IN']).optional(),
  reason: z.enum(CONTACT_REASONS),
  summary: z.string().trim().min(2, 'Write a short summary').max(5000),
  followUpAt: z.string().datetime().optional().nullable(),
  auto: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data

  const allowed = d.auto ? checkPermission(role, 'students', 'read') : checkPermission(role, 'contact_logs', 'create')
  if (!allowed || ['STUDENT', 'PARENT', 'GUARDIAN'].includes(role)) return errors.forbidden()

  const student = await prisma.student.findUnique({ where: { id: d.studentId }, select: { campusId: true } })
  if (!student) return errors.notFound('Student')
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && student.campusId !== campusId) return errors.forbidden('This student is in another branch')

  const row = await logContact({
    studentId: d.studentId,
    guardianId: d.guardianId ?? null,
    channel: d.channel,
    direction: d.direction,
    reason: d.reason,
    summary: d.summary,
    followUpAt: d.followUpAt ? new Date(d.followUpAt) : null,
    auto: d.auto,
    userId: session.user.id,
  })
  return createdResponse({ id: row.id }, 'Contact logged')
}
