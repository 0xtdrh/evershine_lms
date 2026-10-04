/**
 * Phase D complaints & suggestions (docs/design-phase-d.md).
 * GET  — students / parents: their own messages; staff (complaints:read): the queue of their branch
 *        ?status=NEW|IN_PROGRESS|RESOLVED|CLOSED|OPEN|ALL &kind= &topic= &mine=1 &overdue=1
 * POST — students / parents: { kind, topic, body, studentId?, classSectionId? }
 *        staff (complaints:create): a phone / visit complaint { studentId, from: PARENT|STUDENT, kind, topic, body }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { COMPLAINT_KINDS, COMPLAINT_TOPICS, createComplaint, normStatus, sweepComplaints } from '@/lib/complaints/engine'
import { isPortal, senderStudents, staffScope } from '@/lib/complaints/access'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const user = session.user
  await sweepComplaints()
  const sp = new URL(request.url).searchParams
  let where: Prisma.ComplaintWhereInput
  if (isPortal(user.role)) {
    where = { complainantId: user.id }
  } else {
    const scope = staffScope(user)
    if (!scope.canRead) return errors.forbidden()
    const status = sp.get('status') ?? 'OPEN'
    where = {
      ...(scope.campusId && { OR: [{ campusId: scope.campusId }, { campusId: null }] }),
      ...(status === 'OPEN' ? { status: { in: ['NEW', 'PENDING', 'IN_PROGRESS', 'RESOLVED'] } } : status === 'NEW' ? { status: { in: ['NEW', 'PENDING'] } } : status !== 'ALL' ? { status } : {}),
      ...(sp.get('kind') && { kind: sp.get('kind')! }),
      ...(sp.get('topic') && { topic: sp.get('topic')! }),
      ...(sp.get('mine') === '1' && { assignedToId: user.id }),
      ...(sp.get('overdue') === '1' && { dueAt: { lt: new Date() }, firstReplyAt: null, kind: 'COMPLAINT' }),
    }
  }
  const rows = await prisma.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })
  const ids = rows.map((r) => r.id)
  const [students, groups, staff, replies] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.classSection.findMany({ where: { id: { in: rows.map((r) => r.classSectionId).filter((x): x is string => !!x) } }, select: { id: true, className: true, sectionName: true } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true, email: true } }),
    prisma.complaintReply.groupBy({ by: ['complaintId'], where: { complaintId: { in: ids }, ...(isPortal(user.role) && { internal: false }) }, _count: { _all: true } }),
  ])
  const sName = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`]))
  const gName = new Map(groups.map((g) => [g.id, `${g.className} ${g.sectionName}`.trim()]))
  const uName = new Map(staff.map((u) => [u.id, u.displayName ?? u.email]))
  const rc = new Map(replies.map((r) => [r.complaintId, r._count._all]))
  const now = Date.now()
  return successResponse({
    portal: isPortal(user.role),
    complaints: rows.map((c) => {
      const status = normStatus(c.status)
      return {
        id: c.id, number: c.number, kind: c.kind, topic: c.topic, status, source: c.source,
        text: c.body ?? c.description, sender: c.complainantName, senderRole: c.complainantRole,
        student: c.studentId ? sName.get(c.studentId) ?? null : null, group: c.classSectionId ? gName.get(c.classSectionId) ?? null : null,
        assignedTo: c.assignedToId ? uName.get(c.assignedToId) ?? null : null,
        overdue: status === 'NEW' && c.kind === 'COMPLAINT' && !!c.dueAt && c.dueAt.getTime() < now && !c.firstReplyAt,
        escalated: !!c.escalatedAt, satisfied: c.satisfied, replies: rc.get(c.id) ?? 0, createdAt: c.createdAt,
      }
    }),
  })
}

const portalSchema = z.object({
  kind: z.enum(COMPLAINT_KINDS),
  topic: z.enum(COMPLAINT_TOPICS),
  body: z.string().trim().min(3).max(5000),
  studentId: z.string().min(1).optional().nullable(),
  classSectionId: z.string().min(1).optional().nullable(),
})
const staffSchema = portalSchema.extend({ studentId: z.string().min(1), from: z.enum(['PARENT', 'STUDENT']) })

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const user = session.user
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }

  if (isPortal(user.role)) {
    const parsed = portalSchema.safeParse(body)
    if (!parsed.success) return errors.validation(parsed.error)
    const d = parsed.data as z.infer<typeof portalSchema>
    const mine = await senderStudents(user)
    const studentId = d.studentId ?? (mine.length === 1 ? mine[0].id : null)
    if (studentId && !mine.some((s) => s.id === studentId)) return errors.forbidden('You can only write about your own child')
    if (d.classSectionId && studentId) {
      const ok = await prisma.studentEnrollment.count({ where: { studentId, classSectionId: d.classSectionId } })
      if (!ok) return errors.badRequest('The student is not in that group')
    }
    const r = await createComplaint({
      senderUserId: user.id, senderName: user.name ?? user.email ?? 'User', senderRole: user.role,
      kind: d.kind!, topic: d.topic!, body: d.body!, studentId, classSectionId: d.classSectionId ?? null,
    })
    if (!r.ok) return errors.badRequest(r.message!)
    return createdResponse(r, 'Sent — we will reply soon')
  }

  const scope = staffScope(user)
  if (!scope.canCreate) return errors.forbidden()
  const parsed = staffSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as z.infer<typeof staffSchema>
  const s = await prisma.student.findUnique({
    where: { id: d.studentId! },
    select: { campusId: true, userId: true, firstName: true, lastName: true, guardians: { select: { userId: true, firstName: true, lastName: true } } },
  })
  if (!s) return errors.notFound('Student')
  if (scope.campusId && s.campusId !== scope.campusId) return errors.forbidden()
  const g = s.guardians[0]
  const sender = d.from === 'PARENT' && g
    ? { id: g.userId, name: `${g.firstName} ${g.lastName}`.trim(), role: 'PARENT' }
    : { id: s.userId, name: `${s.firstName} ${s.lastName}`, role: 'STUDENT' }
  const r = await createComplaint({
    senderUserId: sender.id, senderName: sender.name, senderRole: sender.role,
    kind: d.kind!, topic: d.topic!, body: d.body!, studentId: d.studentId!, classSectionId: d.classSectionId ?? null,
    source: 'PHONE', recordedById: user.id,
  })
  if (!r.ok) return errors.badRequest(r.message!)
  return createdResponse(r, 'Recorded')
}
