import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const createCycleInvoice = vi.fn(async (_a?: unknown) => ({ id: 'inv-new' }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classSection: { findUnique: vi.fn(async () => ({ id: 'g1', campusId: 'c1', priceOverride: null, currentCycleNumber: 1, levelId: 'l1', level: { pricingType: 'MONTHLY', name: 'Level 1', subject: { name: 'Course' } }, enrollments: [{ studentId: 's1' }] })) },
    feeInvoice: { findFirst: (a: unknown) => findFirst(a) },
  },
}))
vi.mock('@/lib/pricing/group-price', () => ({ cyclePrice: vi.fn(async () => 850) }))
vi.mock('@/lib/academic/engine', () => ({ getActiveAcademicYear: vi.fn(async () => ({ id: 'y1', name: '2025-2026' })) }))
vi.mock('@/lib/groups/sync-progress', () => ({ createCycleInvoice: (a: unknown) => createCycleInvoice(a) }))

import { generateMissingCycleInvoices } from '@/lib/groups/generate-invoices'

describe('generateMissingCycleInvoices and cancelled invoices (final test C10)', () => {
  beforeEach(() => { findFirst.mockReset(); createCycleInvoice.mockClear() })

  it('only a live invoice counts as "already billed": the lookup ignores CANCELLED ones', async () => {
    findFirst.mockResolvedValue(null)
    await generateMissingCycleInvoices('g1', 'u1')
    expect(findFirst).toHaveBeenCalledWith({ where: { studentId: 's1', classSectionId: 'g1', cycleNumber: 1, status: { not: 'CANCELLED' } } })
  })

  it('a student who only has a cancelled invoice gets a new one', async () => {
    findFirst.mockResolvedValue(null) // the cancelled one is filtered out by the query
    const r = await generateMissingCycleInvoices('g1', 'u1')
    expect(r.generated).toBe(1)
    expect(createCycleInvoice).toHaveBeenCalledTimes(1)
  })

  it('a student with a live invoice is skipped, never billed twice', async () => {
    findFirst.mockResolvedValue({ id: 'inv-live' })
    const r = await generateMissingCycleInvoices('g1', 'u1')
    expect(r).toEqual({ generated: 0, skipped: 1 })
    expect(createCycleInvoice).not.toHaveBeenCalled()
  })
})
