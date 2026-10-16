/**
 * 5-D targeted announcements — create (PUBLISHED or PENDING by permission), approve / reject, deliver (recipients +
 * bilingual notification, also for announcements published for later), the reader's feed, read / "I read it",
 * reach for the sender, follow-up of parents who did not confirm. Server-only. Pure rules in ./rules.ts.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { loadPlaces } from '@/lib/places/server'
import { isOwnCloudinaryUrl } from '@/lib/cloudinary'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { logContact, staffNames } from '@/lib/contacts/contact-log'
import { resolveRecipients, scopeProblem } from './audience'
import {
  DEFAULT_ANNOUNCEMENT_SETTINGS, draftProblem, parseAudiences, reach, shortCopy, statusFor,
  type AnnouncementSettings, type Audience, type ScopeType,
} from './rules'

const KEY = 'announcements.settings'
export const getAnnouncementSettings = () => getSetting<AnnouncementSettings>(KEY, DEFAULT_ANNOUNCEMENT_SETTINGS)
export async function saveAnnouncementSettings(v: Partial<AnnouncementSettings>, userId: string) {
  const next = { ...(await getAnnouncementSettings()), ...v }
  await setSetting(KEY, next, userId)
  return next
}

type Who = { id: string; role: string }

export interface AnnouncementInput {
  title: string
  body: string
  titleAr?: string | null
  contentAr?: string | null
  audiences: Audience[]
  scopeType: ScopeType
  scopeIds: string[]
  attachmentUrl?: string | null
  attachmentName?: string | null
  pinned?: boolean
  requireAck?: boolean
  publishAt?: string | null
  expiresAt?: string | null
}

export class AnnouncementError extends Error {}

/** How many people it would reach (the form shows it before sending). */
export async function previewCount(user: Who, d: Pick<AnnouncementInput, 'audiences' | 'scopeType' | 'scopeIds'>) {
  const problem = await problemFor(user, d)
  if (problem) return { count: 0, problem }
  const places = await loadPlaces(user)
  const r = await resolveRecipients(d.audiences, d.scopeType, d.scopeIds, user.role === 'TEACHER' ? undefined : places)
  const by: Record<string, number> = {}
  for (const x of r) by[x.kind] = (by[x.kind] ?? 0) + 1
  return { count: r.length, byKind: by, problem: null }
}

async function problemFor(user: Who, d: Pick<AnnouncementInput, 'audiences' | 'scopeType' | 'scopeIds'>): Promise<string | null> {
  const [settings, places] = await Promise.all([getAnnouncementSettings(), loadPlaces(user)])
  return draftProblem(d, { role: user.role, allPlaces: places.all, teachersCanSend: settings.teachersCanSend }) ?? (await scopeProblem(user, d.scopeType, d.scopeIds))
}

export async function createAnnouncement(user: Who, input: AnnouncementInput) {
  const problem = await problemFor(user, input)
  if (problem) throw new AnnouncementError(problem)
  if (input.attachmentUrl && !isOwnCloudinaryUrl(input.attachmentUrl)) throw new AnnouncementError('The attachment must be uploaded here')
  const canApprove = checkPermission(user.role, 'announcements', 'approve')
  const places = await loadPlaces(user)
  const publishAt = input.publishAt ? new Date(input.publishAt) : new Date()
  const row = await prisma.announcement.create({
    data: {
      title: input.title.slice(0, 190), content: shortCopy(input.body), body: input.body,
      titleAr: input.titleAr?.trim() ? input.titleAr.trim().slice(0, 190) : null, contentAr: input.contentAr?.trim() || null,
      audiences: input.audiences.join(','), scopeType: input.scopeType, scopeIds: input.scopeIds as Prisma.InputJsonValue,
      attachmentUrl: input.attachmentUrl || null, attachmentName: input.attachmentName || null,
      pinned: !!input.pinned, requireAck: !!input.requireAck,
      // the sender's main place, so branch approvers see it (null = a company-wide person)
      campusId: places.all ? null : places.primary ?? places.campusIds[0] ?? null,
      status: statusFor(canApprove), publishedAt: publishAt,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      isActive: true, createdBy: user.id,
      ...(canApprove && { approvedById: user.id, approvedAt: new Date() }),
    },
  })
  if (row.status === 'PENDING') {
    const approvers = (await usersWithPermission('announcements', 'approve', row.campusId)).filter((id) => id !== user.id)
    await notifyUsers(approvers, 'ANNOUNCEMENT_PENDING', {
      title: 'Announcement to approve', message: row.title,
      titleAr: 'إعلان مستني موافقتك', messageAr: row.titleAr ?? row.title, relatedId: row.id,
    })
  } else if (row.publishedAt <= new Date()) {
    await deliver(row.id)
  }
  return row
}

/** Make the recipient rows and send the notification once (when it is published and its time has come). */
export async function deliver(id: string): Promise<number> {
  const a = await prisma.announcement.findUnique({ where: { id } })
  if (!a || a.deliveredAt || a.status !== 'PUBLISHED' || !a.isActive || !a.audiences || !a.scopeType || a.publishedAt > new Date()) return 0
  // claim it first so two sweeps never send twice
  const claimed = await prisma.announcement.updateMany({ where: { id, deliveredAt: null }, data: { deliveredAt: new Date() } })
  if (!claimed.count) return 0
  const sender = await prisma.user.findUnique({ where: { id: a.createdBy }, select: { id: true, role: true } })
  const places = sender && sender.role !== 'TEACHER' ? await loadPlaces(sender) : undefined
  const recipients = await resolveRecipients(parseAudiences(a.audiences), a.scopeType as ScopeType, (a.scopeIds as string[] | null) ?? [], places)
  if (recipients.length) {
    await prisma.announcementRecipient.createMany({ data: recipients.map((r) => ({ announcementId: id, userId: r.userId, studentId: r.studentId, kind: r.kind })), skipDuplicates: true })
  }
  await prisma.announcement.update({ where: { id }, data: { recipientCount: recipients.length } })
  await notifyUsers(recipients.map((r) => r.userId), 'ANNOUNCEMENT', {
    title: a.requireAck ? `Important: ${a.title}` : a.title,
    message: shortCopy(a.body ?? a.content),
    titleAr: a.titleAr ? (a.requireAck ? `مهم: ${a.titleAr}` : a.titleAr) : undefined,
    messageAr: a.contentAr ? shortCopy(a.contentAr, 900) : undefined,
    relatedId: id,
  })
  return recipients.length
}

/** Announcements published for later whose time has come (daily job + the badge poll). */
let lastSweep = 0
export async function deliverDue(force = false): Promise<number> {
  if (!force && Date.now() - lastSweep < 120_000) return 0
  lastSweep = Date.now()
  const due = await prisma.announcement.findMany({ where: { status: 'PUBLISHED', isActive: true, deliveredAt: null, audiences: { not: null }, publishedAt: { lte: new Date() } }, select: { id: true }, take: 50 })
  let n = 0
  for (const d of due) n += await deliver(d.id)
  return n
}

async function managerCanSee(user: Who, a: { createdBy: string; campusId: string | null }) {
  if (a.createdBy === user.id) return true
  if (!checkPermission(user.role, 'announcements', 'approve')) return false
  const places = await loadPlaces(user)
  return places.all || (!!a.campusId && places.campusIds.includes(a.campusId))
}

export async function decide(user: Who, id: string, action: 'approve' | 'reject', reason?: string | null) {
  if (!checkPermission(user.role, 'announcements', 'approve')) throw new AnnouncementError('You cannot approve announcements')
  const a = await prisma.announcement.findUnique({ where: { id } })
  if (!a || a.status !== 'PENDING') throw new AnnouncementError('Nothing to decide')
  if (!(await managerCanSee(user, a))) throw new AnnouncementError('This announcement is not in your places')
  if (action === 'approve') {
    // the approver must be allowed to reach that scope too
    const problem = await scopeProblem(user, a.scopeType as ScopeType, (a.scopeIds as string[] | null) ?? [])
    if (problem && user.role !== 'SUPER_ADMIN') throw new AnnouncementError(problem)
    await prisma.announcement.update({ where: { id }, data: { status: 'PUBLISHED', approvedById: user.id, approvedAt: new Date(), ...(a.publishedAt < new Date() && { publishedAt: new Date() }) } })
    await deliver(id)
  } else {
    await prisma.announcement.update({ where: { id }, data: { status: 'REJECTED', approvedById: user.id, approvedAt: new Date(), rejectedReason: reason?.slice(0, 300) || null } })
  }
  await notifyUsers([a.createdBy], 'ANNOUNCEMENT_DECIDED', action === 'approve'
    ? { title: 'Your announcement was approved', message: a.title, titleAr: 'إعلانك اتوافق عليه', messageAr: a.titleAr ?? a.title, relatedId: id }
    : { title: 'Your announcement was not approved', message: `${a.title}${reason ? ` — ${reason}` : ''}`, titleAr: 'إعلانك ماتوافقش عليه', messageAr: `${a.titleAr ?? a.title}${reason ? ` — ${reason}` : ''}`, relatedId: id })
}

/** The reader's announcements: the ones sent to them + the old ones (by role), pinned first. */
export async function feedFor(user: Who, limit = 50) {
  await deliverDue().catch(() => 0)
  const now = new Date()
  const live = { isActive: true, status: 'PUBLISHED', publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
  const [mine, legacy] = await Promise.all([
    prisma.announcementRecipient.findMany({ where: { userId: user.id, announcement: live }, include: { announcement: true }, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.announcement.findMany({ where: { ...live, audiences: null, AND: [{ OR: [{ targetRole: null }, { targetRole: user.role as never }] }] }, orderBy: { publishedAt: 'desc' }, take: 20 }),
  ])
  const shape = (a: (typeof legacy)[number], r?: { readAt: Date | null; ackAt: Date | null }) => ({
    id: a.id, title: a.title, titleAr: a.titleAr, body: a.body ?? a.content, contentAr: a.contentAr,
    attachmentUrl: a.attachmentUrl, attachmentName: a.attachmentName, pinned: a.pinned, requireAck: a.requireAck,
    publishedAt: a.publishedAt, expiresAt: a.expiresAt, readAt: r?.readAt ?? null, ackAt: r?.ackAt ?? null, legacy: !r,
  })
  const items = [...mine.map((m) => shape(m.announcement, m)), ...legacy.map((a) => shape(a))]
  return items.sort((x, y) => Number(y.pinned) - Number(x.pinned) || +new Date(y.publishedAt) - +new Date(x.publishedAt))
}

/** Read (opened) and optionally "I read it". */
export async function markRead(user: Who, id: string, ack: boolean) {
  const r = await prisma.announcementRecipient.findUnique({ where: { announcementId_userId: { announcementId: id, userId: user.id } } })
  if (!r) return false
  const now = new Date()
  await prisma.announcementRecipient.update({ where: { id: r.id }, data: { readAt: r.readAt ?? now, ...(ack && !r.ackAt && { ackAt: now }) } })
  return true
}

/** How many "I read it" confirmations this person still owes (staff / instructor task, portal banner). */
export const pendingAcks = (userId: string) => prisma.announcementRecipient.count({
  where: { userId, ackAt: null, announcement: { requireAck: true, isActive: true, status: 'PUBLISHED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
})

/** Sender / approver list with reach numbers. tab = sent | pending. */
export async function manageList(user: Who, tab: 'sent' | 'pending') {
  const places = await loadPlaces(user)
  const canApprove = checkPermission(user.role, 'announcements', 'approve')
  const inPlaces: Prisma.AnnouncementWhereInput = places.all ? {} : { OR: [{ campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }, { createdBy: user.id }] }
  const where: Prisma.AnnouncementWhereInput = {
    audiences: { not: null },
    ...(tab === 'pending' ? { status: 'PENDING' } : { status: { not: 'PENDING' } }),
    ...(canApprove ? inPlaces : { createdBy: user.id }),
  }
  const rows = await prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  const stats = rows.length ? await prisma.announcementRecipient.groupBy({ by: ['announcementId'], where: { announcementId: { in: rows.map((r) => r.id) } }, _count: { _all: true, readAt: true, ackAt: true } }) : []
  const senders = await staffNames(rows.map((r) => r.createdBy))
  return rows.map((a) => {
    const s = stats.find((x) => x.announcementId === a.id)
    const total = s?._count._all ?? 0
    return {
      id: a.id, title: a.title, titleAr: a.titleAr, status: a.status, isActive: a.isActive, pinned: a.pinned, requireAck: a.requireAck,
      audiences: parseAudiences(a.audiences), scopeType: a.scopeType, scopeCount: ((a.scopeIds as string[] | null) ?? []).length,
      publishedAt: a.publishedAt, expiresAt: a.expiresAt, delivered: !!a.deliveredAt, rejectedReason: a.rejectedReason,
      sender: senders.get(a.createdBy) ?? '', mine: a.createdBy === user.id,
      total, read: s?._count.readAt ?? 0, acked: s?._count.ackAt ?? 0,
    }
  })
}

/** One announcement for the sender / approver: text + every recipient with read / confirmed. */
export async function detailFor(user: Who, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id } })
  if (!a || !(await managerCanSee(user, a))) return null
  const recipients = await prisma.announcementRecipient.findMany({ where: { announcementId: id }, orderBy: { createdAt: 'asc' } })
  const userIds = recipients.map((r) => r.userId)
  const [staff, guardians, studentUsers, students] = await Promise.all([
    staffNames(userIds),
    prisma.guardian.findMany({ where: { userId: { in: userIds } }, select: { userId: true, firstName: true, lastName: true, phoneNumber: true } }),
    prisma.student.findMany({ where: { userId: { in: userIds } }, select: { userId: true, firstName: true, lastName: true } }),
    prisma.student.findMany({ where: { id: { in: recipients.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
  ])
  const u = new Map<string, { name: string; phone: string | null }>([...staff].map(([id, name]) => [id, { name, phone: null }]))
  for (const g of guardians) u.set(g.userId, { name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber })
  for (const x of studentUsers) u.set(x.userId, { name: `${x.firstName} ${x.lastName}`.trim(), phone: null })
  const st = new Map(students.map((x) => [x.id, `${x.firstName} ${x.lastName}`]))
  return {
    announcement: { ...a, audiences: parseAudiences(a.audiences), scopeIds: (a.scopeIds as string[] | null) ?? [] },
    reach: reach(recipients, a.requireAck),
    recipients: recipients.map((r) => ({ userId: r.userId, name: u.get(r.userId)?.name ?? '', phone: u.get(r.userId)?.phone ?? null, kind: r.kind, student: r.studentId ? st.get(r.studentId) ?? null : null, readAt: r.readAt, ackAt: r.ackAt })),
  }
}

/** A follow-up (contact log, due today) for each parent who has not read / confirmed. */
export async function followUpUnread(user: Who, id: string) {
  const d = await detailFor(user, id)
  if (!d) throw new AnnouncementError('Not found')
  const open = await prisma.announcementRecipient.findMany({
    where: { announcementId: id, kind: 'PARENT', studentId: { not: null }, ...(d.announcement.requireAck ? { ackAt: null } : { readAt: null }) },
    select: { userId: true, studentId: true },
  })
  const guardians = new Map((await prisma.guardian.findMany({ where: { userId: { in: open.map((o) => o.userId) } }, select: { id: true, userId: true } })).map((g) => [g.userId, g.id]))
  let n = 0
  for (const o of open) {
    await logContact({
      studentId: o.studentId!, guardianId: guardians.get(o.userId) ?? null, channel: 'CALL', reason: 'OTHER',
      summary: `Did not ${d.announcement.requireAck ? 'confirm' : 'read'} the announcement "${d.announcement.title}" — please call.`,
      followUpAt: new Date(), userId: user.id,
    })
    n++
  }
  return n
}
