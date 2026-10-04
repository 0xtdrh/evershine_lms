/**
 * Phase D: one complaint.
 * GET   — the conversation (senders never see internal staff notes); staff also get the list of handlers
 * POST  — reply { body, internal? } (internal notes: staff only)
 * PATCH — staff: { status?, assignedToId? }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { COMPLAINT_STATUSES, addReply, normStatus, updateComplaint } from '@/lib/complaints/engine'
import { isPortal, staffScope, staffSees } from '@/lib/complaints/access'
import { usersWithPermission } from '@/lib/notifications/events'

export const dynamic = 'force-dynamic'

async function load(id: string, user: { id: string; role: string; campusId?: string | null }) {
  const c = await prisma.complaint.findUnique({ where: { id } })
  if (!c) return { err: errors.notFound('Complaint') }
  if (isPortal(user.role)) {
    if (c.complainantId !== user.id) return { err: errors.notFound('Complaint') }
    return { c, staff: false }
  }
  const scope = staffScope(user)
  if (!scope.canRead || !staffSees(scope, c)) return { err: errors.forbidden() }
  return { c, staff: true, scope }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const l = await load(id, session.user)
  if (l.err) return l.err
  const c = l.c!
  const replies = await prisma.complaintReply.findMany({ where: { complaintId: c.id, ...(!l.staff && { internal: false }) }, orderBy: { createdAt: 'asc' } })
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(replies.map((r) => r.authorId))] } }, select: { id: true, displayName: true, email: true } })
  const aName = new Map(authors.map((u) => [u.id, u.displayName ?? u.email]))
  const [student, group, handlers] = await Promise.all([
    c.studentId ? prisma.student.findUnique({ where: { id: c.studentId }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }) : null,
    c.classSectionId ? prisma.classSection.findUnique({ where: { id: c.classSectionId }, select: { className: true, sectionName: true } }) : null,
    l.staff ? usersWithPermission('complaints', 'update', c.campusId).then((ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true } })) : Promise.resolve([]),
  ])
  return successResponse({
    id: c.id, number: c.number, kind: c.kind, topic: c.topic, status: normStatus(c.status), source: c.source,
    text: c.body ?? c.description, sender: c.complainantName, senderRole: c.complainantRole,
    student: student ? { id: student.id, name: `${student.firstName} ${student.lastName}`, registrationNumber: student.registrationNumber } : null,
    group: group ? `${group.className} ${group.sectionName}`.trim() : null,
    assignedToId: c.assignedToId, dueAt: c.dueAt, escalatedAt: c.escalatedAt, resolvedAt: c.resolvedAt, closedAt: c.closedAt,
    satisfied: c.satisfied, handlingRating: c.handlingRating, createdAt: c.createdAt,
    legacyRemarks: c.remarks,
    replies: replies.map((r) => ({ id: r.id, body: r.body, internal: r.internal, fromStaff: r.authorRole === 'STAFF', author: r.authorRole === 'STAFF' ? (l.staff ? aName.get(r.authorId) ?? 'Staff' : 'TechNova team') : c.complainantName, createdAt: r.createdAt })),
    handlers: handlers.map((u) => ({ id: u.id, name: u.displayName ?? u.email })),
    canHandle: l.staff ? l.scope!.canHandle : false,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const l = await load(id, session.user)
  if (l.err) return l.err
  if (l.staff && !l.scope!.canHandle) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await addReply({ id, userId: session.user.id, role: session.user.role, body: parsed.data.body!, internal: parsed.data.internal, asStaff: !!l.staff })
  if (!r.ok) return r.code === 409 ? errors.conflict(r.message!) : errors.badRequest(r.message!)
  return successResponse(r, 'Sent')
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const l = await load(id, session.user)
  if (l.err) return l.err
  if (!l.staff || !l.scope!.canHandle) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ status: z.enum(COMPLAINT_STATUSES).optional(), assignedToId: z.string().min(1).nullable().optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await updateComplaint({ id, userId: session.user.id, status: parsed.data.status, assignedToId: parsed.data.assignedToId })
  if (!r.ok) return r.code === 409 ? errors.conflict(r.message!) : errors.notFound('Complaint')
  return successResponse(r, 'Saved')
}
