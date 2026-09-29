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

import { prisma } from '@/lib/prisma'
import { resolveCycleStart } from './cycle-start'
import { cyclesInLevel, sessionsPerCycle } from './cycle-rules'

export interface GroupForEstimate {
  id: string
  status: string
  completedAt: Date | null
  currentCycleNumber: number
  currentCycleStartDate: Date | null
  startDate: Date | null
  scheduleSlots: unknown
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

/** Date of the n-th upcoming session (n >= 1) on the weekly schedule, starting today. */
function nthScheduledSession(slots: { dayOfWeek: number }[], n: number, from = new Date()): Date | null {
  if (n <= 0 || slots.length === 0) return null
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  let count = 0
  for (let i = 0; i < 800; i++) {
    const perDay = slots.filter((s) => s.dayOfWeek === cursor.getUTCDay()).length
    if (perDay > 0) {
      count += perDay
      if (count >= n) return cursor
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return null
}

export async function estimateGroupEnds(group: GroupForEstimate): Promise<GroupEndEstimate> {
  const base: GroupEndEstimate = {
    cycleEnd: null, levelEnd: null, sessionsDoneInCycle: 0, sessionsPerCycle: 0,
    cycleNumber: group.currentCycleNumber, cyclesInLevel: 0, basis: 'UNKNOWN',
  }
  if (!group.level) return base

  const per = sessionsPerCycle(group.level)
  const totalCycles = cyclesInLevel(group.level)
  base.sessionsPerCycle = per
  base.cyclesInLevel = totalCycles

  if (group.status === 'COMPLETED') {
    const last = await prisma.enrollmentAttendanceRecord.findFirst({
      where: { studentEnrollment: { classSectionId: group.id } },
      orderBy: { attendanceDate: 'desc' },
      select: { attendanceDate: true },
    })
    const end = last?.attendanceDate ?? group.completedAt
    return {
      ...base,
      cycleEnd: end ? day(end) : null,
      levelEnd: end && group.currentCycleNumber >= totalCycles ? day(end) : null,
      basis: 'COMPLETED',
    }
  }

  const cycleStart = await resolveCycleStart(group.id, group.currentCycleStartDate, group.startDate)
  const done = cycleStart
    ? (await prisma.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollment: { classSectionId: group.id }, attendanceDate: { gte: cycleStart } },
        select: { attendanceDate: true },
        distinct: ['attendanceDate'],
      })).length
    : 0
  base.sessionsDoneInCycle = done

  const remainingThisCycle = Math.max(0, per - done)
  const cyclesAfterThis = Math.max(0, totalCycles - group.currentCycleNumber)
  const slots = Array.isArray(group.scheduleSlots)
    ? (group.scheduleSlots as { dayOfWeek: number }[]).filter((s) => Number.isInteger(s?.dayOfWeek))
    : []

  if (slots.length > 0) {
    const today = day(new Date())
    const cycleEnd = remainingThisCycle > 0 ? nthScheduledSession(slots, remainingThisCycle) : null
    const levelEnd = nthScheduledSession(slots, remainingThisCycle + cyclesAfterThis * per)
    return {
      ...base,
      cycleEnd: cycleEnd ? day(cycleEnd) : today,
      levelEnd: levelEnd ? day(levelEnd) : cycleEnd ? day(cycleEnd) : today,
      basis: 'SCHEDULE',
    }
  }

  if (!cycleStart) return base // not started and no schedule: nothing to estimate
  return {
    ...base,
    cycleEnd: day(addMonths(cycleStart, 1)),
    levelEnd: day(addMonths(cycleStart, 1 + cyclesAfterThis)),
    basis: 'ONE_MONTH_PER_CYCLE',
  }
}
