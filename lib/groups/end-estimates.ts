/**
 * Estimated end dates of a group, shown on the Groups page (owner, 2026-09-29):
 *  - cycleEnd: when the CURRENT cycle (this group) should finish
 *  - levelEnd: when the whole LEVEL should finish (this cycle + the cycles left)
 *
 * Projected from the sessions actually recorded in this cycle and the group's
 * weekly schedule (scheduleSlots). Without a schedule, falls back to
 * "one month per cycle". Display only — teacher schedules and substitute
 * suggestions do not use these dates.
 *
 * Replaces the stored ClassSection.expectedEndDate, which was
 * start + ALL the level's months even for the 2nd, 3rd... cycle (so the level
 * end drifted later every month).
 */

import { cairoToday } from '@/lib/dates/cairo'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cyclesInLevel, sessionsPerCycle } from './cycle-rules'
import { cleanSlots, upcomingSessions } from './schedule-calendar'
import { groupExceptions, type GroupExceptions } from './calendar-exceptions'

export interface GroupForEstimate {
  id: string
  status: string
  completedAt: Date | null
  currentCycleNumber: number
  currentCycleStartDate: Date | null
  startDate: Date | null
  scheduleSlots: unknown
  cycleSessions?: number | null
  level: { numberOfSessions: number; numberOfMonths: number; pricingType: string } | null
}

export interface GroupEndEstimate {
  cycleEnd: string | null
  levelEnd: string | null
  sessionsDoneInCycle: number
  sessionsPerCycle: number
  cycleNumber: number
  cyclesInLevel: number
  basis: 'SCHEDULE' | 'ONE_MONTH_PER_CYCLE' | 'COMPLETED' | 'UNKNOWN'
}

const day = (d: Date) => d.toISOString().slice(0, 10)

function addMonths(d: Date, months: number) {
  const x = new Date(d)
  x.setUTCMonth(x.getUTCMonth() + months)
  return x
}

/** What the estimate needs from the database for one group (loaded for many groups at once by `loadEndFacts`). */
export interface EndFacts {
  /** distinct attendance dates of the group (any order) */
  attendanceDates: Date[]
  /** first HELD session of a class without names (GroupSessionLog) */
  firstLog: Date | null
  exceptions: GroupExceptions
}

const NO_EXCEPTIONS: GroupExceptions = { holidays: [], extras: [], branchHolidays: [], onlineHolidays: [], modeOverrides: {} }

/**
 * Load-test 22/11: the Groups list ran ~6 queries PER group (993 for 160 groups). This loads the same facts for every
 * group in 3–4 queries in all. Same rules as before (resolveCycleStart + distinct attendance dates + holidays/extras).
 */
export async function loadEndFacts(groups: { id: string; campusId?: string | null; scheduleSlots?: unknown; currentCycleStartDate: Date | null; startDate: Date | null }[]): Promise<Map<string, EndFacts>> {
  const out = new Map<string, EndFacts>()
  if (!groups.length) return out
  const ids = groups.map((g) => g.id)
  const needLog = groups.filter((g) => !g.currentCycleStartDate && !g.startDate).map((g) => g.id)
  const withSlots = groups.filter((g) => cleanSlots(g.scheduleSlots).length > 0)
  const campusMissing = withSlots.filter((g) => !g.campusId).map((g) => g.id)
  const [dates, logs, campuses] = await Promise.all([
    prisma.$queryRaw<{ g: string; d: Date }[]>`
      SELECT se.classSectionId AS g, ear.attendanceDate AS d
      FROM EnrollmentAttendanceRecord ear JOIN StudentEnrollment se ON se.id = ear.studentEnrollmentId
      WHERE se.classSectionId IN (${Prisma.join(ids)})
      GROUP BY se.classSectionId, ear.attendanceDate`,
    needLog.length
      ? prisma.groupSessionLog.groupBy({ by: ['classSectionId'], where: { classSectionId: { in: needLog }, status: 'HELD' }, _min: { sessionDate: true } })
      : Promise.resolve([] as { classSectionId: string; _min: { sessionDate: Date | null } }[]),
    campusMissing.length ? prisma.classSection.findMany({ where: { id: { in: campusMissing } }, select: { id: true, campusId: true } }) : Promise.resolve([] as { id: string; campusId: string }[]),
  ])
  const campusOf = new Map<string, string>([...groups.filter((g) => g.campusId).map((g) => [g.id, g.campusId as string] as [string, string]), ...campuses.map((c) => [c.id, c.campusId] as [string, string])])
  const exc = await groupExceptions(withSlots.filter((g) => campusOf.has(g.id)).map((g) => ({ id: g.id, campusId: campusOf.get(g.id)! })))
  const byGroup = new Map<string, Date[]>()
  for (const r of dates) byGroup.set(r.g, [...(byGroup.get(r.g) ?? []), new Date(r.d)])
  const firstLog = new Map(logs.map((l) => [l.classSectionId, l._min.sessionDate ?? null]))
  for (const id of ids) out.set(id, { attendanceDates: byGroup.get(id) ?? [], firstLog: firstLog.get(id) ?? null, exceptions: exc.get(id) ?? NO_EXCEPTIONS })
  return out
}

/** Pure: the estimate from the facts (same rules as before). */
export function projectEnds(group: GroupForEstimate, f: EndFacts, today: string = cairoToday()): GroupEndEstimate {
  const base: GroupEndEstimate = {
    cycleEnd: null, levelEnd: null, sessionsDoneInCycle: 0, sessionsPerCycle: 0,
    cycleNumber: group.currentCycleNumber, cyclesInLevel: 0, basis: 'UNKNOWN',
  }
  if (!group.level) return base
  const per = sessionsPerCycle(group.level, group.cycleSessions)
  const totalCycles = cyclesInLevel(group.level)
  base.sessionsPerCycle = per
  base.cyclesInLevel = totalCycles
  const times = f.attendanceDates.map((d) => d.getTime())

  if (group.status === 'COMPLETED') {
    const last = times.length ? new Date(Math.max(...times)) : null
    const end = last ?? group.completedAt
    return { ...base, cycleEnd: end ? day(end) : null, levelEnd: end && group.currentCycleNumber >= totalCycles ? day(end) : null, basis: 'COMPLETED' }
  }

  // resolveCycleStart: stored dates, else the first session (attendance or a no-names session log)
  const firsts = [times.length ? Math.min(...times) : null, f.firstLog ? f.firstLog.getTime() : null].filter((x): x is number => x !== null)
  const cycleStart = group.currentCycleStartDate ?? group.startDate ?? (firsts.length ? new Date(Math.min(...firsts)) : null)
  const done = cycleStart ? times.filter((t) => t >= cycleStart.getTime()).length : 0
  base.sessionsDoneInCycle = done

  const remainingThisCycle = Math.max(0, per - done)
  const cyclesAfterThis = Math.max(0, totalCycles - group.currentCycleNumber)
  const slots = cleanSlots(group.scheduleSlots)
  if (slots.length > 0) {
    const { holidays, extras, branchHolidays, onlineHolidays, modeOverrides } = f.exceptions
    const nth = (n: number) => {
      if (n <= 0) return null
      const list = upcomingSessions({ slots, from: today, count: n, holidays, extras, branchHolidays, onlineHolidays, modeOverrides })
      return list.length === n ? list[n - 1].date : null
    }
    const cycleEnd = remainingThisCycle > 0 ? nth(remainingThisCycle) : null
    const levelEnd = nth(remainingThisCycle + cyclesAfterThis * per)
    return { ...base, cycleEnd: cycleEnd ?? today, levelEnd: levelEnd ?? cycleEnd ?? today, basis: 'SCHEDULE' }
  }
  if (!cycleStart) return base
  return { ...base, cycleEnd: day(addMonths(cycleStart, 1)), levelEnd: day(addMonths(cycleStart, 1 + cyclesAfterThis)), basis: 'ONE_MONTH_PER_CYCLE' }
}

/** Many groups at once (the Groups list, wallet alerts). */
export async function estimateGroupEndsMany<G extends GroupForEstimate & { campusId?: string | null }>(groups: G[]): Promise<Map<string, GroupEndEstimate>> {
  const facts = await loadEndFacts(groups)
  const today = cairoToday()
  return new Map(groups.map((g) => [g.id, projectEnds(g, facts.get(g.id)!, today)]))
}

export async function estimateGroupEnds(group: GroupForEstimate & { campusId?: string | null }): Promise<GroupEndEstimate> {
  return (await estimateGroupEndsMany([group])).get(group.id)!
}
