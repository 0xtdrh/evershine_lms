import { describe, expect, it } from 'vitest'
import { cyclesInLevel, sessionsPerCycle } from '@/lib/groups/cycle-rules'

describe('cycle rules (owner, 2026-09-29)', () => {
  it('MONTHLY: one cycle = one month of sessions, one cycle per month', () => {
    const level = { numberOfSessions: 8, numberOfMonths: 2, pricingType: 'MONTHLY' }
    expect(sessionsPerCycle(level)).toBe(4)
    expect(cyclesInLevel(level)).toBe(2)
  })

  it('FULL_LEVEL: one cycle = the whole level', () => {
    const level = { numberOfSessions: 8, numberOfMonths: 2, pricingType: 'FULL_LEVEL' }
    expect(sessionsPerCycle(level)).toBe(8)
    expect(cyclesInLevel(level)).toBe(1)
  })
})
