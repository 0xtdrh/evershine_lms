import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  enrollmentAttendanceRecord: { findMany: vi.fn(), findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { estimateGroupEnds } from '@/lib/groups/end-estimates'

const monthlyLevel = { numberOfSessions: 8, numberOfMonths: 2, pricingType: 'MONTHLY' } // 4 sessions per cycle, 2 cycles

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-01T09:00:00Z')) // Thursday
})
afterEach(() => vi.useRealTimers())

const group = (over: Partial<Parameters<typeof estimateGroupEnds>[0]> = {}) => ({
  id: 'g1', status: 'ACTIVE', completedAt: null, currentCycleNumber: 1,
  currentCycleStartDate: new Date('2026-09-27T00:00:00Z'), startDate: new Date('2026-09-27T00:00:00Z'),
  scheduleSlots: [{ dayOfWeek: 0, time: '17:00' }, { dayOfWeek: 3, time: '17:00' }], // Sun + Wed
  level: monthlyLevel,
  ...over,
})

describe('estimateGroupEnds', () => {
  it('projects the cycle end and the level end on the weekly schedule', async () => {
    db.enrollmentAttendanceRecord.findMany.mockResolvedValue([{}, {}]) // 2 of 4 sessions done
    const e = await estimateGroupEnds(group())
    // remaining in cycle: 2 -> Sun 4 Oct, Wed 7 Oct
    expect(e.cycleEnd).toBe('2026-10-07')
    // + 1 more cycle of 4 -> Sun 11, Wed 14, Sun 18, Wed 21
    expect(e.levelEnd).toBe('2026-10-21')
    expect(e).toMatchObject({ sessionsDoneInCycle: 2, sessionsPerCycle: 4, cycleNumber: 1, cyclesInLevel: 2, basis: 'SCHEDULE' })
  })

  it('in the last cycle, the level ends with the cycle', async () => {
    db.enrollmentAttendanceRecord.findMany.mockResolvedValue([{}])
    const e = await estimateGroupEnds(group({ currentCycleNumber: 2 }))
    expect(e.cycleEnd).toBe(e.levelEnd)
  })

  it('without a schedule: one month per cycle', async () => {
    db.enrollmentAttendanceRecord.findMany.mockResolvedValue([])
    const e = await estimateGroupEnds(group({ scheduleSlots: null }))
    expect(e).toMatchObject({ cycleEnd: '2026-10-27', levelEnd: '2026-11-27', basis: 'ONE_MONTH_PER_CYCLE' })
  })

  it('a completed group shows its last session date', async () => {
    db.enrollmentAttendanceRecord.findFirst.mockResolvedValue({ attendanceDate: new Date('2026-10-18T00:00:00Z') })
    const e = await estimateGroupEnds(group({ status: 'COMPLETED', completedAt: new Date('2026-10-19T00:00:00Z') }))
    expect(e).toMatchObject({ cycleEnd: '2026-10-18', levelEnd: null, basis: 'COMPLETED' })
  })
})
