import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [] as { g: string; d: Date }[]),
  groupSessionLog: { groupBy: vi.fn(async () => []) },
  classSection: { findMany: vi.fn(async () => []) },
  holiday: { findMany: vi.fn(async () => []) },
  extraSession: { findMany: vi.fn(async () => []) },
  sessionModeOverride: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/groups/calendar-exceptions', () => ({ groupExceptions: vi.fn(async () => new Map()) }))

import { estimateGroupEndsMany, projectEnds, type EndFacts } from '@/lib/groups/end-estimates'

const monthlyLevel = { numberOfSessions: 8, numberOfMonths: 2, pricingType: 'MONTHLY' } // 4 sessions per cycle, 2 cycles
const none: EndFacts['exceptions'] = { holidays: [], extras: [], branchHolidays: [], onlineHolidays: [], modeOverrides: {} }
const facts = (dates: string[], firstLog: string | null = null): EndFacts => ({ attendanceDates: dates.map((d) => new Date(`${d}T00:00:00Z`)), firstLog: firstLog ? new Date(firstLog) : null, exceptions: none })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-01T09:00:00Z')) // Thursday
})
afterEach(() => vi.useRealTimers())

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', status: 'ACTIVE', completedAt: null as Date | null, currentCycleNumber: 1,
  currentCycleStartDate: new Date('2026-09-27T00:00:00Z') as Date | null, startDate: new Date('2026-09-27T00:00:00Z') as Date | null,
  scheduleSlots: [{ dayOfWeek: 0, time: '17:00' }, { dayOfWeek: 3, time: '17:00' }] as unknown, // Sun + Wed
  level: monthlyLevel,
  ...over,
})

describe('group end estimates (same rules, now loaded for many groups at once — load test 22/11)', () => {
  it('projects the cycle end and the level end on the weekly schedule', () => {
    const e = projectEnds(group(), facts(['2026-09-27', '2026-09-30']), '2026-10-01') // 2 of 4 sessions done
    expect(e.cycleEnd).toBe('2026-10-07') // Sun 4, Wed 7
    expect(e.levelEnd).toBe('2026-10-21') // + Sun 11, Wed 14, Sun 18, Wed 21
    expect(e).toMatchObject({ sessionsDoneInCycle: 2, sessionsPerCycle: 4, cycleNumber: 1, cyclesInLevel: 2, basis: 'SCHEDULE' })
  })

  it('sessions before this cycle started are not counted', () => {
    expect(projectEnds(group(), facts(['2026-09-20', '2026-09-27']), '2026-10-01').sessionsDoneInCycle).toBe(1)
  })

  it('in the last cycle, the level ends with the cycle', () => {
    const e = projectEnds(group({ currentCycleNumber: 2 }), facts(['2026-09-27']), '2026-10-01')
    expect(e.cycleEnd).toBe(e.levelEnd)
  })

  it('without a schedule: one month per cycle', () => {
    expect(projectEnds(group({ scheduleSlots: null }), facts([]), '2026-10-01')).toMatchObject({ cycleEnd: '2026-10-27', levelEnd: '2026-11-27', basis: 'ONE_MONTH_PER_CYCLE' })
  })

  it('no stored start: the first session (attendance or a no-names session log) starts the cycle', () => {
    const g = group({ scheduleSlots: null, currentCycleStartDate: null, startDate: null })
    expect(projectEnds(g, facts(['2026-09-29']), '2026-10-01').cycleEnd).toBe('2026-10-29')
    expect(projectEnds(g, facts([], '2026-09-25T00:00:00Z'), '2026-10-01').cycleEnd).toBe('2026-10-25')
    expect(projectEnds(g, facts([]), '2026-10-01').basis).toBe('UNKNOWN')
  })

  it('a completed group shows its last session date', () => {
    const e = projectEnds(group({ status: 'COMPLETED', completedAt: new Date('2026-10-19T00:00:00Z') }), facts(['2026-10-11', '2026-10-18']), '2026-10-01')
    expect(e).toMatchObject({ cycleEnd: '2026-10-18', levelEnd: null, basis: 'COMPLETED' })
  })

  it('many groups: one attendance query for all of them (was ~6 queries per group)', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ g: 'g1', d: new Date('2026-09-27T00:00:00Z') }, { g: 'g2', d: new Date('2026-09-30T00:00:00Z') }, { g: 'g2', d: new Date('2026-09-27T00:00:00Z') }])
    const out = await estimateGroupEndsMany([group({ campusId: 'c1' }), group({ id: 'g2', campusId: 'c1' })])
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(out.get('g1')?.sessionsDoneInCycle).toBe(1)
    expect(out.get('g2')?.sessionsDoneInCycle).toBe(2)
  })
})
