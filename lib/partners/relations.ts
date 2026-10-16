/**
 * Partners part 1-B2 — people at a partner (contacts) and the activity log (calls, meetings, visits) with follow-ups.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'

export const CONTACT_ROLES = ['DECISION_MAKER', 'FINANCE', 'ACADEMIC', 'PLACE_MANAGER', 'OTHER'] as const
export const ACTIVITY_KINDS = ['CALL', 'MEETING', 'VISIT', 'MESSAGE', 'OTHER'] as const

export interface ContactInput { name: string; role: string; jobTitle?: string | null; phone?: string | null; email?: string | null; isPrimary?: boolean; notes?: string | null }
export interface ActivityInput { kind: string; happenedAt: string; summary: string; followUpAt?: string | null }

const clean = (v: string | null | undefined) => v?.trim() || null

export const listContacts = (partnerId: string) => prisma.partnerContact.findMany({ where: { partnerId }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] })

export async function saveContact(partnerId: string, id: string | null, c: ContactInput) {
  const data = { name: c.name.trim(), role: c.role, jobTitle: clean(c.jobTitle), phone: clean(c.phone), email: clean(c.email), isPrimary: !!c.isPrimary, notes: clean(c.notes) }
  return prisma.$transaction(async (tx) => {
    // one main contact per partner
    if (data.isPrimary) await tx.partnerContact.updateMany({ where: { partnerId, ...(id ? { id: { not: id } } : {}) }, data: { isPrimary: false } })
    return id ? tx.partnerContact.update({ where: { id }, data }) : tx.partnerContact.create({ data: { ...data, partnerId } })
  })
}

export const listActivities = (partnerId: string) => prisma.partnerActivity.findMany({ where: { partnerId }, orderBy: { happenedAt: 'desc' }, take: 200 })

export async function saveActivity(userId: string, partnerId: string, id: string | null, a: ActivityInput & { followUpDone?: boolean }) {
  const data = {
    kind: a.kind, happenedAt: new Date(a.happenedAt), summary: a.summary.trim(), followUpAt: a.followUpAt ? new Date(a.followUpAt) : null,
    ...(a.followUpDone !== undefined && { followUpDoneAt: a.followUpDone ? new Date() : null }),
  }
  return id ? prisma.partnerActivity.update({ where: { id }, data }) : prisma.partnerActivity.create({ data: { ...data, partnerId, createdById: userId } })
}

/** Follow-ups due up to `until` that are not done yet. */
export async function dueFollowUps(until: Date) {
  return prisma.partnerActivity.findMany({
    where: { followUpAt: { lte: until }, followUpDoneAt: null, partner: { isActive: true } },
    orderBy: { followUpAt: 'asc' },
    take: 50,
    include: { partner: { select: { id: true, name: true } } },
  })
}
