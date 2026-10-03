/**
 * Holidays (branch or company-wide) and extra sessions for groups, as plain
 * YYYY-MM-DD strings for the calendar maths (lib/groups/schedule-calendar.ts).
 * Phase A, docs/design-phase-a.md.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toDay, type ExtraSlot } from './schedule-calendar'

type Db = Prisma.TransactionClient | typeof prisma

export interface GroupExceptions { holidays: string[]; extras: ExtraSlot[] }

export async function groupExceptions(
  groups: { id: string; campusId: string }[],
  from?: Date,
  to?: Date,
  db: Db = prisma
): Promise<Map<string, GroupExceptions>> {
  const out = new Map<string, GroupExceptions>()
  if (!groups.length) return out
  const dateRange = from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}
  const campusIds = [...new Set(groups.map((g) => g.campusId))]
  const [holidays, extras] = await Promise.all([
    db.holiday.findMany({ where: { ...dateRange, OR: [{ campusId: null }, { campusId: { in: campusIds } }] }, select: { date: true, campusId: true } }),
    db.extraSession.findMany({ where: { ...dateRange, classSectionId: { in: groups.map((g) => g.id) } }, select: { classSectionId: true, date: true, time: true } }),
  ])
  for (const g of groups) {
    out.set(g.id, {
      holidays: [...new Set(holidays.filter((h) => !h.campusId || h.campusId === g.campusId).map((h) => toDay(h.date)))],
      extras: extras.filter((e) => e.classSectionId === g.id).map((e) => ({ date: toDay(e.date), time: e.time })),
    })
  }
  return out
}

export async function exceptionsForGroup(classSectionId: string, db: Db = prisma): Promise<GroupExceptions> {
  const g = await db.classSection.findUnique({ where: { id: classSectionId }, select: { id: true, campusId: true } })
  if (!g) return { holidays: [], extras: [] }
  return (await groupExceptions([g], undefined, undefined, db)).get(g.id) ?? { holidays: [], extras: [] }
}
