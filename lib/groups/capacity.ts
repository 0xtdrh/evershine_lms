/**
 * Group capacity + per-group waiting list (phase A, docs/design-phase-a.md).
 *  - ClassSection.maxStudents: most students allowed (null = no limit)
 *  - a full group refuses new students unless the user has group_capacity:approve
 *    ("add anyway"), or staff choose "put on this group's waiting list"
 *    (WaitingListEntry with classSectionId)
 *  - when a seat frees up and someone is waiting, staff are notified
 *  - waiting students can be offered other groups of the same course + level
 *    that have free seats
 * Server-only.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { pickGroupInstructorOffering } from './instructor'

type Db = Prisma.TransactionClient | typeof prisma

export interface Seats { max: number | null; count: number; free: number | null; full: boolean; waiting: number }

export async function groupSeats(classSectionId: string, db: Db = prisma): Promise<Seats> {
  const [g, count, waiting] = await Promise.all([
    db.classSection.findUnique({ where: { id: classSectionId }, select: { maxStudents: true } }),
    db.studentEnrollment.count({ where: { classSectionId, status: 'ACTIVE' } }),
    db.waitingListEntry.count({ where: { classSectionId, status: 'WAITING' } }),
  ])
  const max = g?.maxStudents ?? null
  const free = max == null ? null : Math.max(0, max - count)
  return { max, count, free, full: max != null && count >= max, waiting }
}

/** Puts a student on a full group's waiting list (no duplicates). */
export async function waitForGroup(studentId: string, classSectionId: string, userId: string, notes?: string | null) {
  const g = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { campusId: true, levelId: true, level: { select: { subjectId: true } } },
  })
  if (!g?.level) throw new Error('This group has no course/level')
  const existing = await prisma.waitingListEntry.findFirst({ where: { studentId, classSectionId, status: 'WAITING' }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const row = await prisma.waitingListEntry.create({
    data: { studentId, subjectId: g.level.subjectId, levelId: g.levelId, campusId: g.campusId, classSectionId, notes: notes ?? 'Waiting for a seat in this group', createdById: userId },
  })
  return { id: row.id, created: true }
}

/** Position of a waiting entry in its group's queue (1 = first). */
export async function queuePosition(entryId: string): Promise<number | null> {
  const e = await prisma.waitingListEntry.findUnique({ where: { id: entryId }, select: { classSectionId: true, createdAt: true, status: true } })
  if (!e?.classSectionId || e.status !== 'WAITING') return null
  const before = await prisma.waitingListEntry.count({ where: { classSectionId: e.classSectionId, status: 'WAITING', createdAt: { lt: e.createdAt } } })
  return before + 1
}

/** A seat freed up: tell staff of that branch if someone is waiting. Never throws. */
export async function notifySeatFreed(classSectionId: string) {
  try {
    const seats = await groupSeats(classSectionId)
    if (!seats.waiting || seats.full) return
    const g = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { className: true, sectionName: true, campusId: true } })
    if (!g) return
    const staff = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: 'SUPER_ADMIN' },
          { role: { in: ['ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] }, admin: { campusId: g.campusId } },
        ],
      },
      select: { id: true },
    })
    if (!staff.length) return
    const label = `${g.className} ${g.sectionName}`.trim()
    await prisma.notification.createMany({
      data: staff.map((u) => ({
        userId: u.id,
        title: 'A seat is free',
        message: `${label}: ${seats.free ?? 'a'} seat(s) free, ${seats.waiting} student(s) waiting`,
        type: 'GROUP_SEAT_FREE',
        relatedId: classSectionId,
      })),
    })
  } catch (err) {
    console.error('[SEAT_FREED_NOTIFY]', err)
  }
}

/** Groups of a level with a free seat (or no limit), for placing a waiting student. */
export async function availableGroups(levelId: string, opts: { campusId?: string; excludeId?: string } = {}) {
  const activeYearId = (await getActiveAcademicYear())?.id
  const groups = await prisma.classSection.findMany({
    where: { levelId, isActive: true, status: 'ACTIVE', ...(opts.campusId && { campusId: opts.campusId }), ...(opts.excludeId && { id: { not: opts.excludeId } }) },
    select: {
      id: true, className: true, sectionName: true, maxStudents: true, scheduleSlots: true, startDate: true,
      campus: { select: { id: true, name: true } },
      level: { select: { subjectId: true } },
      subjectOfferings: { select: { subjectId: true, academicYearId: true, teacherId: true, createdAt: true, teacher: { select: { firstName: true, lastName: true } } } },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  })
  return groups
    .map((g) => {
      const count = g._count.enrollments
      const free = g.maxStudents == null ? null : Math.max(0, g.maxStudents - count)
      const t = pickGroupInstructorOffering(g.subjectOfferings, g.level?.subjectId, activeYearId)?.teacher
      return {
        id: g.id,
        label: `${g.className} ${g.sectionName}`.trim(),
        campus: g.campus,
        scheduleSlots: g.scheduleSlots,
        started: !!g.startDate,
        teacher: t ? `${t.firstName} ${t.lastName}` : null,
        count,
        max: g.maxStudents,
        free,
      }
    })
    .filter((g) => g.free == null || g.free > 0)
    .sort((a, b) => (b.free ?? 999) - (a.free ?? 999))
}
