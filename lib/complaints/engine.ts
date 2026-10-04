/**
 * Phase D complaints & suggestions (docs/design-phase-d.md).
 *  - students and parents send a COMPLAINT, SUGGESTION or PRAISE (never anonymous)
 *  - stages NEW → IN_PROGRESS → RESOLVED → CLOSED; the sender sees each stage + replies
 *  - handlers = staff whose role has complaints:update (secretary by default); one
 *    responsible person (assignedTo); reply deadline (default 24 h) — past it, an
 *    unanswered complaint is escalated to the branch managers
 *  - RESOLVED asks the sender "solved?": yes → CLOSED (+ 1–5 rating), no → back to
 *    IN_PROGRESS + managers told; no answer for N days (default 3) → CLOSED
 *  - staff can record a phone complaint; a low rating opens one automatically
 * The old template rows (status PENDING) count as NEW.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { nextInSequence, isUniqueConflictOn } from '@/lib/ids/sequence'
import { notifyUsers, managerUserIds, usersWithPermission } from '@/lib/notifications/events'
import { logSystemContact } from '@/lib/contacts/contact-log'

export const COMPLAINT_KINDS = ['COMPLAINT', 'SUGGESTION', 'PRAISE'] as const
export const COMPLAINT_TOPICS = ['INSTRUCTOR', 'SCHEDULE', 'PAYMENT', 'PLACE', 'SESSION', 'OTHER'] as const
export const COMPLAINT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number]
export type ComplaintTopic = (typeof COMPLAINT_TOPICS)[number]
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]

export interface ComplaintSettings { replyHours: number; autoCloseDays: number }
export const COMPLAINT_DEFAULTS: ComplaintSettings = { replyHours: 24, autoCloseDays: 3 }
export const getComplaintSettings = async (): Promise<ComplaintSettings> => ({ ...COMPLAINT_DEFAULTS, ...(await getSetting<Partial<ComplaintSettings>>('complaints.settings', {})) })
export const saveComplaintSettings = (v: ComplaintSettings, userId: string) => setSetting('complaints.settings', v, userId)

/** Legacy PENDING = NEW, legacy RESOLVED stays RESOLVED. */
export const normStatus = (s: string): ComplaintStatus => (s === 'PENDING' ? 'NEW' : (COMPLAINT_STATUSES as readonly string[]).includes(s) ? (s as ComplaintStatus) : 'NEW')
const KIND_LABEL: Record<ComplaintKind, string> = { COMPLAINT: 'complaint', SUGGESTION: 'suggestion', PRAISE: 'thank-you note' }

async function nextNumber() {
  const prefix = `TN-CMP-${new Date().getFullYear()}-`
  const rows = await prisma.complaint.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } })
  return nextInSequence(rows.map((r) => r.number!).filter(Boolean), prefix, 5)
}

async function campusOf(studentId?: string | null, userId?: string | null): Promise<string | null> {
  if (studentId) return (await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true } }))?.campusId ?? null
  if (!userId) return null
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { student: { select: { campusId: true } }, guardian: { select: { students: { select: { campusId: true }, take: 1 } } } } })
  return u?.student?.campusId ?? u?.guardian?.students[0]?.campusId ?? null
}

export interface ComplaintOutcome { ok: boolean; code?: number; message?: string; id?: string; number?: string | null }

export async function createComplaint(input: {
  senderUserId: string
  senderName: string
  senderRole: string
  kind: ComplaintKind
  topic: ComplaintTopic
  body: string
  studentId?: string | null
  classSectionId?: string | null
  source?: 'PORTAL' | 'PHONE' | 'AUTO_RATING'
  recordedById?: string | null
}): Promise<ComplaintOutcome> {
  const body = input.body.trim()
  if (body.length < 3) return { ok: false, code: 400, message: 'Write a few words' }
  const settings = await getComplaintSettings()
  const campusId = await campusOf(input.studentId, input.senderUserId)
  const now = new Date()
  let created
  for (let i = 0; i < 5; i++) {
    try {
      created = await prisma.complaint.create({
        data: {
          number: await nextNumber(),
          complainantId: input.senderUserId,
          complainantName: input.senderName.slice(0, 190),
          complainantRole: input.senderRole as never,
          title: body.slice(0, 80),
          description: body.slice(0, 190),
          body,
          status: 'NEW',
          kind: input.kind,
          topic: input.topic,
          studentId: input.studentId ?? null,
          classSectionId: input.classSectionId ?? null,
          campusId,
          source: input.source ?? 'PORTAL',
          dueAt: new Date(now.getTime() + Math.max(1, settings.replyHours) * 3_600_000),
        },
      })
      break
    } catch (err) {
      if (i < 4 && isUniqueConflictOn(err, 'number')) continue
      throw err
    }
  }
  if (!created) return { ok: false, code: 500, message: 'Could not save' }
  if (input.recordedById) {
    await prisma.complaintReply.create({ data: { complaintId: created.id, authorId: input.recordedById, authorRole: 'STAFF', body: 'Recorded by staff from a phone call / visit.', internal: true } })
  }
  const handlers = await usersWithPermission('complaints', 'update', campusId)
  await notifyUsers(handlers.filter((id) => id !== input.recordedById), 'COMPLAINT_NEW', {
    title: `New ${KIND_LABEL[input.kind]} ${created.number ?? ''}`.trim(),
    message: `${input.senderName}: ${body.slice(0, 140)}`,
    relatedId: created.id,
  })
  if (input.studentId && input.kind === 'COMPLAINT') {
    await logSystemContact({ studentId: input.studentId, channel: 'SYSTEM', direction: 'IN', reason: 'COMPLAINT', summary: `Complaint ${created.number}: ${body.slice(0, 300)}` })
  }
  return { ok: true, id: created.id, number: created.number }
}

async function tellSender(c: { id: string; complainantId: string; number: string | null }, title: string, message: string) {
  await notifyUsers([c.complainantId], 'COMPLAINT_UPDATE', { title: `${title} — ${c.number ?? ''}`.trim(), message, relatedId: c.id })
}

/** Staff reply (or internal note) / sender reply. */
export async function addReply(input: { id: string; userId: string; role: string; body: string; internal?: boolean; asStaff: boolean }): Promise<ComplaintOutcome> {
  const c = await prisma.complaint.findUnique({ where: { id: input.id } })
  if (!c) return { ok: false, code: 404, message: 'Not found' }
  const status = normStatus(c.status)
  if (status === 'CLOSED') return { ok: false, code: 409, message: 'This complaint is closed' }
  const body = input.body.trim()
  if (body.length < 1) return { ok: false, code: 400, message: 'Write a reply' }
  const internal = input.asStaff && !!input.internal
  await prisma.complaintReply.create({ data: { complaintId: c.id, authorId: input.userId, authorRole: input.asStaff ? 'STAFF' : input.role, body: body.slice(0, 5000), internal } })
  if (input.asStaff && !internal) {
    await prisma.complaint.update({
      where: { id: c.id },
      data: { firstReplyAt: c.firstReplyAt ?? new Date(), ...(status === 'NEW' && { status: 'IN_PROGRESS' }), assignedToId: c.assignedToId ?? input.userId },
    })
    await tellSender(c, 'Reply to your message', body.slice(0, 150))
  } else if (!input.asStaff) {
    const to = c.assignedToId ? [c.assignedToId] : await usersWithPermission('complaints', 'update', c.campusId)
    await notifyUsers(to, 'COMPLAINT_NEW', { title: `Reply from ${c.complainantName} — ${c.number ?? ''}`.trim(), message: body.slice(0, 150), relatedId: c.id })
  }
  return { ok: true, id: c.id }
}

/** Staff: change stage / responsible person. */
export async function updateComplaint(input: { id: string; userId: string; status?: ComplaintStatus; assignedToId?: string | null }): Promise<ComplaintOutcome> {
  const c = await prisma.complaint.findUnique({ where: { id: input.id } })
  if (!c) return { ok: false, code: 404, message: 'Not found' }
  const from = normStatus(c.status)
  const data: Record<string, unknown> = {}
  if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId
  if (input.status && input.status !== from) {
    if (from === 'CLOSED') return { ok: false, code: 409, message: 'This complaint is closed' }
    data.status = input.status
    if (input.status === 'IN_PROGRESS' && !c.assignedToId && input.assignedToId === undefined) data.assignedToId = input.userId
    if (input.status === 'RESOLVED') { data.resolvedAt = new Date(); data.resolvedBy = input.userId; data.satisfied = null }
    if (input.status === 'CLOSED') data.closedAt = new Date()
  }
  if (!Object.keys(data).length) return { ok: true, id: c.id }
  await prisma.complaint.update({ where: { id: c.id }, data })
  if (data.status === 'IN_PROGRESS') await tellSender(c, 'We are working on it', 'Your message is being followed up by our team.')
  if (data.status === 'RESOLVED') await tellSender(c, 'Marked as solved', 'Please open it in the portal and tell us if it is really solved.')
  if (data.status === 'CLOSED') await tellSender(c, 'Closed', 'Your message is closed. Thank you for helping us improve.')
  if (input.assignedToId && input.assignedToId !== input.userId) {
    await notifyUsers([input.assignedToId], 'COMPLAINT_NEW', { title: `Assigned to you — ${c.number ?? ''}`.trim(), message: `${c.complainantName}: ${(c.body ?? c.description).slice(0, 140)}`, relatedId: c.id })
  }
  return { ok: true, id: c.id }
}

/** Sender: "was it solved?" */
export async function confirmResolution(input: { id: string; senderUserId: string; satisfied: boolean; rating?: number | null }): Promise<ComplaintOutcome> {
  const c = await prisma.complaint.findUnique({ where: { id: input.id } })
  if (!c || c.complainantId !== input.senderUserId) return { ok: false, code: 404, message: 'Not found' }
  if (normStatus(c.status) !== 'RESOLVED') return { ok: false, code: 409, message: 'This can be answered only after it is marked as solved' }
  const rating = input.rating && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null
  if (input.satisfied) {
    await prisma.complaint.update({ where: { id: c.id }, data: { status: 'CLOSED', closedAt: new Date(), satisfied: true, handlingRating: rating } })
  } else {
    await prisma.complaint.update({ where: { id: c.id }, data: { status: 'IN_PROGRESS', satisfied: false, handlingRating: rating, resolvedAt: null } })
    await notifyUsers([...(await managerUserIds(c.campusId)), ...(c.assignedToId ? [c.assignedToId] : [])], 'COMPLAINT_ESCALATED', {
      title: `Not solved yet — ${c.number ?? ''}`.trim(),
      message: `${c.complainantName} says the problem is not solved: ${(c.body ?? c.description).slice(0, 120)}`,
      relatedId: c.id,
    })
  }
  return { ok: true, id: c.id }
}

let lastSweep = 0
/** Escalate unanswered complaints past the deadline; close RESOLVED ones nobody answered. Throttled; never throws. */
export async function sweepComplaints(force = false) {
  if (!force && Date.now() - lastSweep < 5 * 60_000) return { escalated: 0, closed: 0 }
  lastSweep = Date.now()
  try {
    const settings = await getComplaintSettings()
    const now = new Date()
    const overdue = await prisma.complaint.findMany({
      where: { status: { in: ['NEW', 'PENDING'] }, kind: 'COMPLAINT', dueAt: { lt: now }, escalatedAt: null, firstReplyAt: null },
      select: { id: true, number: true, campusId: true, complainantName: true, body: true, description: true },
      take: 100,
    })
    for (const c of overdue) {
      const done = await prisma.complaint.updateMany({ where: { id: c.id, escalatedAt: null }, data: { escalatedAt: now } })
      if (!done.count) continue
      await notifyUsers(await managerUserIds(c.campusId), 'COMPLAINT_ESCALATED', {
        title: `No reply in ${settings.replyHours} h — ${c.number ?? ''}`.trim(),
        message: `${c.complainantName}: ${(c.body ?? c.description).slice(0, 140)}`,
        relatedId: c.id,
      })
    }
    const closeBefore = new Date(now.getTime() - Math.max(1, settings.autoCloseDays) * 86_400_000)
    const closed = await prisma.complaint.updateMany({ where: { status: 'RESOLVED', resolvedAt: { lt: closeBefore } }, data: { status: 'CLOSED', closedAt: now } })
    return { escalated: overdue.length, closed: closed.count }
  } catch (err) {
    console.error('[COMPLAINTS_SWEEP]', err)
    return { escalated: 0, closed: 0 }
  }
}

/** Monthly report: counts by topic / branch / kind, average hours to resolve, satisfaction. */
export async function complaintsReport(opts: { campusId?: string | null; month?: string }) {
  const m = /^\d{4}-\d{2}$/.test(opts.month ?? '') ? opts.month! : new Date().toISOString().slice(0, 7)
  const from = new Date(`${m}-01T00:00:00.000Z`)
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
  const rows = await prisma.complaint.findMany({
    where: { createdAt: { gte: from, lt: to }, ...(opts.campusId && { campusId: opts.campusId }) },
    select: { kind: true, topic: true, campusId: true, status: true, createdAt: true, resolvedAt: true, closedAt: true, satisfied: true, handlingRating: true, escalatedAt: true },
  })
  const campuses = new Map((await prisma.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const count = (key: (r: (typeof rows)[number]) => string) => {
    const out: Record<string, number> = {}
    for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1
    return out
  }
  const hours = rows.filter((r) => r.resolvedAt ?? r.closedAt).map((r) => ((r.resolvedAt ?? r.closedAt)!.getTime() - r.createdAt.getTime()) / 3_600_000)
  const answered = rows.filter((r) => r.satisfied !== null)
  const ratings = rows.map((r) => r.handlingRating).filter((x): x is number => x != null)
  return {
    month: m,
    total: rows.length,
    byKind: count((r) => r.kind),
    byTopic: count((r) => r.topic ?? 'OTHER'),
    byBranch: count((r) => (r.campusId ? campuses.get(r.campusId) ?? '—' : '—')),
    byStatus: count((r) => normStatus(r.status)),
    escalated: rows.filter((r) => r.escalatedAt).length,
    avgHoursToResolve: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
    solvedRate: answered.length ? Math.round((answered.filter((r) => r.satisfied).length / answered.length) * 100) : null,
    avgHandlingRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
  }
}
