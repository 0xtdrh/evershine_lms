import { describe, expect, it } from 'vitest'
import { decideApplies, type AppliesFacts } from '@/lib/groups/applies'

const base: AppliesFacts = {
  campusKind: 'MAIN', unnamedHeadcount: null, modesFrom: 'DEFAULT', modes: ['BRANCH', 'ONLINE', 'RECORDED'], slotModes: ['BRANCH'],
  deliveryMode: 'PHYSICAL', videoBlocks: 0, entry: 'NOW', awaitingCount: 0, startDate: '2026-11-01', cancelledAt: null,
  status: 'ACTIVE', minStudents: null, currentCycleNumber: 1,
}

describe('group window shows only the parts that fit the group (owner 21/11)', () => {
  it('a normal branch group in month 1: no partner, online, videos, waiting, start or months parts', () => {
    expect(decideApplies(base)).toMatchObject({ partnerPlace: false, otherModes: false, videos: false, awaiting: false, beforeStart: false, months: false })
  })
  it('partner place (or a no-names class already on) → children count + who cancelled', () => {
    expect(decideApplies({ ...base, campusKind: 'PARTNER' }).partnerPlace).toBe(true)
    expect(decideApplies({ ...base, unnamedHeadcount: 12 }).partnerPlace).toBe(true)
  })
  it('online / hybrid only when allowed on purpose, an online place, or a session already set another way', () => {
    expect(decideApplies({ ...base, modesFrom: 'LEVEL', modes: ['BRANCH', 'ONLINE'] }).otherModes).toBe(true)
    expect(decideApplies({ ...base, modesFrom: 'LEVEL', modes: ['BRANCH'] }).otherModes).toBe(false)
    expect(decideApplies({ ...base, campusKind: 'ONLINE' }).otherModes).toBe(true)
    expect(decideApplies({ ...base, slotModes: ['BRANCH', 'ONLINE'] }).otherModes).toBe(true)
  })
  it('videos, waiting-for-payment, before the start, months', () => {
    expect(decideApplies({ ...base, videoBlocks: 3 }).videos).toBe(true)
    expect(decideApplies({ ...base, entry: 'AFTER_PAYMENT' }).awaiting).toBe(true)
    expect(decideApplies({ ...base, awaitingCount: 1 }).awaiting).toBe(true)
    expect(decideApplies({ ...base, startDate: null }).beforeStart).toBe(true)
    expect(decideApplies({ ...base, startDate: null, cancelledAt: '2026-11-02' }).beforeStart).toBe(false)
    expect(decideApplies({ ...base, currentCycleNumber: 2 }).months).toBe(true)
  })
})
