/**
 * Holidays (branch or company-wide) and extra sessions for groups, as plain
 * YYYY-MM-DD strings for the calendar maths (lib/groups/schedule-calendar.ts).
 * Phase A, docs/design-phase-a.md.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toDay, type ExtraSlot } from './schedule-calendar'
import type { Mode } from '@/lib/delivery/modes'

type Db = Prisma.TransactionClient | typeof prisma

export interface GroupExceptions {
  holidays: string[]
  extras: ExtraSlot[]
  /** a02: holiday dates that are for the branch only (online / recorded sessions still happen) */
  branchHolidays: string[]
  /** a02 M3: holiday dates for online sessions only (branch sessions still happen) */
  onlineHolidays: string[]
  /** a02: one-off way of a session on a date (SessionModeOverride) */
  modeOverrides: Record<string, Mode>
}

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
  const [holidays, extras, overrides] = await Promise.all([
    db.holiday.findMany({ where: { ...dateRange, OR: [{ campusId: null }, { campusId: { in: campusIds } }] }, select: { date: true, campusId: true, appliesTo: true } }),
    db.extraSession.findMany({ where: { ...dateRange, classSectionId: { in: groups.map((g) => g.id) } }, select: { classSectionId: true, date: true, time: true } }),
    db.sessionModeOverride.findMany({ where: { ...dateRange, classSectionId: { in: groups.map((g) => g.id) } }, select: { classSectionId: true, date: true, mode: true } }).catch(() => []),
  ])
  const kinds = new Map((await db.classSection.findMany({ where: { id: { in: groups.map((g) => g.id) } }, select: { id: true, kind: true } })).map((g) => [g.id, g.kind]))
  for (const g of groups) {
    const mine = holidays.filter((h) => !h.campusId || h.campusId === g.campusId)
    // who is off that day, for this group (a02 M3: the holiday may say who)
    const off = new Map<string, { branch: boolean; online: boolean }>()
    for (const h of mine) {
      const d = toDay(h.date)
      const cur = off.get(d) ?? { branch: false, online: false }
      const ways = Array.isArray(h.appliesTo) ? (h.appliesTo as string[]) : null
      if (!ways) { cur.branch = true; cur.online = cur.online || !h.campusId }
      else if (kinds.get(g.id) === 'ONE_TO_ONE') { if (ways.includes('ONE_TO_ONE')) { cur.branch = true; cur.online = true } }
      else { cur.branch = cur.branch || ways.includes('BRANCH'); cur.online = cur.online || ways.includes('ONLINE') }
      if (cur.branch || cur.online) off.set(d, cur)
    }
    out.set(g.id, {
      holidays: [...off.keys()],
      extras: extras.filter((e) => e.classSectionId === g.id).map((e) => ({ date: toDay(e.date), time: e.time })),
      branchHolidays: [...off].filter(([, o]) => o.branch && !o.online).map(([d]) => d),
      onlineHolidays: [...off].filter(([, o]) => o.online && !o.branch).map(([d]) => d),
      modeOverrides: Object.fromEntries(overrides.filter((o) => o.classSectionId === g.id).map((o) => [toDay(o.date), o.mode as Mode])),
    })
  }
  return out
}

export async function exceptionsForGroup(classSectionId: string, db: Db = prisma): Promise<GroupExceptions> {
  const g = await db.classSection.findUnique({ where: { id: classSectionId }, select: { id: true, campusId: true } })
  const none: GroupExceptions = { holidays: [], extras: [], branchHolidays: [], onlineHolidays: [], modeOverrides: {} }
  if (!g) return none
  return (await groupExceptions([g], undefined, undefined, db)).get(g.id) ?? none
}
