/**
 * R2 (owner 2026-10-11): "Book the next level" in the level report = a WISH for the secretaries, never a seat.
 * - The level's group is still running → the renewal answer becomes YES (Renewals page + advance cycle).
 * - The group is already closed → a waiting-list entry for the next level of the course (Waiting list page).
 * Branch staff who handle renewals get a notification. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { respondRenewal } from '@/lib/groups/renewal'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'

const NOTE = 'Parent asked for the next level from the level report.'

async function nextLevelOf(groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { id: true, status: true, campusId: true, className: true, sectionName: true, level: { select: { id: true, order: true, subjectId: true } } } })
  if (!g?.level) return null
  const next = await prisma.level.findFirst({ where: { subjectId: g.level.subjectId, order: { gt: g.level.order } }, orderBy: { order: 'asc' }, select: { id: true, name: true } })
  return { g, next }
}

/** Already asked? (shown instead of the button) */
export async function nextLevelWishState(studentId: string, groupId: string) {
  const x = await nextLevelOf(groupId)
  if (!x) return null
  const [renewal, waiting] = await Promise.all([
    prisma.renewalRequest.findUnique({ where: { classSectionId_studentId: { classSectionId: groupId, studentId } }, select: { status: true } }),
    prisma.waitingListEntry.findFirst({ where: { studentId, subjectId: x.g.level!.subjectId, levelId: x.next?.id ?? null, status: 'WAITING' }, select: { id: true } }),
  ])
  return { nextLevel: x.next?.name ?? null, asked: renewal?.status === 'YES' || !!waiting }
}

export interface WishOutcome { ok: boolean; code?: string; message?: string; via?: 'RENEWAL' | 'WAITING_LIST' }

export async function requestNextLevel(studentId: string, groupId: string, userId: string): Promise<WishOutcome> {
  const x = await nextLevelOf(groupId)
  if (!x) return { ok: false, code: 'NOT_FOUND', message: 'Group not found' }
  const enrolled = await prisma.studentEnrollment.count({ where: { studentId, classSectionId: groupId } })
  if (!enrolled) return { ok: false, code: 'NOT_FOUND', message: 'Group not found' }
  let via: 'RENEWAL' | 'WAITING_LIST'
  if (x.g.status === 'ACTIVE') {
    const req = await prisma.renewalRequest.upsert({ where: { classSectionId_studentId: { classSectionId: groupId, studentId } }, create: { classSectionId: groupId, studentId }, update: {} })
    if (req.status !== 'YES') {
      const r = await respondRenewal({ requestId: req.id, answer: 'YES', via: 'PARENT', userId })
      if (!r.ok) return { ok: false, code: 'CONFLICT', message: (r as { message?: string }).message }
    }
    via = 'RENEWAL'
  } else {
    const exists = await prisma.waitingListEntry.findFirst({ where: { studentId, subjectId: x.g.level!.subjectId, levelId: x.next?.id ?? null, status: 'WAITING' } })
    if (!exists) await prisma.waitingListEntry.create({ data: { studentId, subjectId: x.g.level!.subjectId, levelId: x.next?.id ?? null, campusId: x.g.campusId, notes: NOTE, createdById: userId } })
    via = 'WAITING_LIST'
  }
  try {
    const st = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } })
    const staff = await usersWithPermission('renewals', 'update', x.g.campusId)
    await notifyUsers(staff, 'NEXT_LEVEL_WISH', {
      title: 'Next level wanted',
      titleAr: 'طلب المستوى الجاي',
      message: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim() + `: the parent wants ${x.next?.name ?? 'the next level'} (from the level report). See ${via === 'RENEWAL' ? 'Renewals' : 'the waiting list'}.`,
      messageAr: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim() + `: ولي الأمر عايز ${x.next?.name ?? 'المستوى الجاي'} (من تقرير المستوى). شوف ${via === 'RENEWAL' ? 'التجديدات' : 'قايمة الانتظار'}.`,
      relatedId: groupId,
    })
  } catch { /* never break the request */ }
  return { ok: true, via }
}
