import { describe, expect, it } from 'vitest'
import { buildGroupRules, rulesFingerprintText, type GroupRuleInput } from '@/lib/rules/group-rules'

const base = (x: Partial<GroupRuleInput> = {}): GroupRuleInput => ({
  group: { requireFullPaymentToStart: true, partialPaymentCounts: false, installmentsAllowed: false, maxStudents: 8, scheduleSlots: [{ dayOfWeek: 4, time: '17:00' }, { dayOfWeek: 0, time: '17:00' }], unnamedHeadcount: null },
  price: 850, pricingType: 'MONTHLY', sessionsPerCycle: 8,
  refund: { allowed: true, adminFeeType: 'FIXED', adminFeeValue: 50, deductBasis: 'ATTENDED' },
  excuse: { autoApprove: true, daysAfter: 2 },
  written: [],
  ...x,
})

describe('group rules', () => {
  it('automatic rules come from the group settings', () => {
    const r = buildGroupRules(base())
    const en = r.map((x) => x.en).join(' ')
    expect(en).toContain('Sunday 17:00, Thursday 17:00')
    expect(en).toContain('Fee: 850 EGP per month (8 sessions)')
    expect(en).toContain('full fee must be paid before the group starts')
    expect(en).toContain('instalments is not allowed')
    expect(en).toContain('At most 8 students')
    expect(en).toContain('administration fee of 50 EGP')
    expect(r.every((x) => x.ar.length > 0)).toBe(true)
  })
  it('no refunds / instalments allowed / review of excuses', () => {
    const en = buildGroupRules(base({ group: { ...base().group, requireFullPaymentToStart: false, partialPaymentCounts: true, installmentsAllowed: true }, refund: { allowed: false, adminFeeType: 'FIXED', adminFeeValue: 0, deductBasis: 'ATTENDED' }, excuse: { autoApprove: false, daysAfter: 3 } })).map((x) => x.en).join(' ')
    expect(en).toContain('Paying part of the fee is enough')
    expect(en).toContain('instalments is allowed')
    expect(en).toContain('not refunded')
    expect(en).toContain('reviewed by TechNova')
  })
  it('a class without names has no fee / payment rules', () => {
    const en = buildGroupRules(base({ group: { ...base().group, unnamedHeadcount: 20 } })).map((x) => x.en).join(' ')
    expect(en).not.toContain('Fee:')
    expect(en).not.toContain('instalments')
  })
  it('written rules add up: company, place, level, group', () => {
    const r = buildGroupRules(base({ written: [
      { scope: 'GROUP', textEn: 'Bring the laptop.', textAr: 'هات اللابتوب.', sortOrder: 0 },
      { scope: 'GLOBAL', textEn: 'Be on time.', textAr: 'خليك في المعاد.', sortOrder: 0 },
      { scope: 'LEVEL', textEn: 'Kits stay at the centre.', textAr: 'الكيتات بتفضل في السنتر.', sortOrder: 0 },
    ] }))
    expect(r.filter((x) => x.source !== 'AUTO').map((x) => x.source)).toEqual(['GLOBAL', 'LEVEL', 'GROUP'])
  })
  it('the fingerprint changes when a rule changes', () => {
    expect(rulesFingerprintText(buildGroupRules(base()))).not.toBe(rulesFingerprintText(buildGroupRules(base({ price: 900 }))))
  })
})
