import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { computeRefundSuggestion } from '@/lib/refunds/engine'

const FIXED = (v: number) => ({ adminFeeType: 'FIXED' as const, adminFeeValue: v })
const PCT = (v: number) => ({ adminFeeType: 'PERCENT' as const, adminFeeValue: v })

describe('computeRefundSuggestion (paid - consumed sessions - admin fee)', () => {
  it('nothing attended, no fee: everything back', () => {
    expect(computeRefundSuggestion({ netPaid: 850, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 0, rule: FIXED(0) }).suggested).toBe(850)
  })
  it('one session attended out of 4 is deducted', () => {
    const r = computeRefundSuggestion({ netPaid: 850, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 1, rule: FIXED(0) })
    expect(r.perSession).toBe(212.5)
    expect(r.deduction).toBe(212.5)
    expect(r.suggested).toBe(637.5)
  })
  it('fixed admin fee', () => {
    expect(computeRefundSuggestion({ netPaid: 850, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 1, rule: FIXED(50) }).suggested).toBe(587.5)
  })
  it('percent admin fee is a % of what was paid', () => {
    const r = computeRefundSuggestion({ netPaid: 800, invoiceTotal: 800, sessionsInCycle: 4, sessionsCounted: 0, rule: PCT(10) })
    expect(r.adminFee).toBe(80)
    expect(r.suggested).toBe(720)
  })
  it('price per session uses the invoice total after discount', () => {
    const r = computeRefundSuggestion({ netPaid: 665, invoiceTotal: 665, sessionsInCycle: 4, sessionsCounted: 2, rule: FIXED(0) })
    expect(r.perSession).toBe(166.25)
    expect(r.suggested).toBe(332.5)
  })
  it('half paid: the deduction can never exceed what was paid', () => {
    const r = computeRefundSuggestion({ netPaid: 200, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 3, rule: FIXED(0) })
    expect(r.deduction).toBe(200)
    expect(r.suggested).toBe(0)
  })
  it('all sessions attended: nothing back', () => {
    expect(computeRefundSuggestion({ netPaid: 850, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 4, rule: FIXED(50) }).suggested).toBe(0)
  })
  it('admin fee never makes the refund negative', () => {
    const r = computeRefundSuggestion({ netPaid: 100, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 0, rule: FIXED(500) })
    expect(r.adminFee).toBe(100)
    expect(r.suggested).toBe(0)
  })
  it('invoice not linked to a group (no sessions): only the fee is taken', () => {
    expect(computeRefundSuggestion({ netPaid: 500, invoiceTotal: 500, sessionsInCycle: null, sessionsCounted: 0, rule: FIXED(25) }).suggested).toBe(475)
  })
  it('already partly refunded: works on the net paid', () => {
    expect(computeRefundSuggestion({ netPaid: 300, invoiceTotal: 850, sessionsInCycle: 4, sessionsCounted: 0, rule: FIXED(0) }).suggested).toBe(300)
  })
})
