import { describe, expect, it } from 'vitest'
import { batchSchema, checkCode, codeBenefit, makeCode, normalizeCode } from '@/lib/site/codes'
import { ageOnDay, contactPhone, signupSchema, stepsFor } from '@/lib/site/signup'

const code = (over: Partial<Parameters<typeof checkCode>[0] & object> = {}) => ({ isActive: true, expiresAt: null, maxUses: 1, uses: 0, scope: 'ANY', scopeIds: [], ...over })
const ctx = { listing: 'robotics', today: '2026-11-12', usedByPhone: false }

describe('enrolment codes', () => {
  it('makes readable codes with the batch prefix', () => {
    let i = 0
    const c = makeCode('nile school', () => i++ % 5, 6)
    expect(c).toMatch(/^NILESCHOOL-[A-Z2-9]{6}$/)
    expect(c.split('-')[1]).not.toMatch(/[01OIL]/)
    expect(normalizeCode(' nile-ab 12 ')).toBe('NILE-AB12')
  })
  it('checks every problem in order', () => {
    expect(checkCode(null, ctx).problem).toBe('NOT_FOUND')
    expect(checkCode(code({ isActive: false }), ctx).problem).toBe('OFF')
    expect(checkCode(code({ expiresAt: '2026-11-11T23:59:59Z' }), ctx).problem).toBe('EXPIRED')
    expect(checkCode(code({ expiresAt: '2026-11-12T23:59:59Z' }), ctx).ok).toBe(true)
    expect(checkCode(code({ uses: 1 }), ctx).problem).toBe('USED_UP')
    expect(checkCode(code({ maxUses: null, uses: 99 }), ctx).ok).toBe(true)
    expect(checkCode(code({ scope: 'LISTING', scopeIds: ['arduino'] }), ctx).problem).toBe('NOT_THIS_COURSE')
    expect(checkCode(code({ scope: 'LISTING', scopeIds: ['robotics'] }), ctx).ok).toBe(true)
    expect(checkCode(code(), { ...ctx, usedByPhone: true }).problem).toBe('ALREADY_USED')
  })
  it('validates a batch', () => {
    expect(batchSchema.safeParse({ batch: 'NILE', count: 5, kind: 'PERCENT', value: 0 }).success).toBe(false)
    expect(batchSchema.safeParse({ batch: 'NILE', count: 5, kind: 'PERCENT', value: 120 }).success).toBe(false)
    expect(batchSchema.safeParse({ batch: 'NILE', count: 5, kind: 'FREE' }).success).toBe(true)
    expect(batchSchema.safeParse({ batch: 'NILE', count: 5, kind: 'AMOUNT', value: 200, scope: 'LISTING' }).success).toBe(false)
    expect(batchSchema.safeParse({ batch: 'نيل', count: 5, kind: 'FREE' }).success).toBe(false)
  })
  it('says what the code gives', () => {
    expect(codeBenefit('FREE', 100, true)).toBe('مجاني بالكامل')
    expect(codeBenefit('PERCENT', 20, false)).toBe('20% off')
    expect(codeBenefit('AMOUNT', 1500, true)).toBe('خصم 1,500 جنيه')
  })
})

describe('website sign-up', () => {
  const base = {
    listing: 'robotics', mode: 'ONLINE', who: 'PARENT', city: 'Hurghada', agree: true,
    parent: { firstName: 'Mona', lastName: 'Adel', phone: '01012345678' },
    students: [{ firstName: 'Omar', lastName: 'Adel', dob: '2017-03-01', gender: 'MALE' }],
  }
  it('accepts a parent with children and refuses a missing parent', () => {
    expect(signupSchema.safeParse(base).success).toBe(true)
    expect(signupSchema.safeParse({ ...base, parent: null }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, parent: { ...base.parent, phone: '123' } }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, agree: false }).success).toBe(false)
  })
  it('signing up alone = one student with a phone', () => {
    const self = { ...base, who: 'SELF', parent: null, selfPhone: '01112345678' }
    expect(signupSchema.safeParse(self).success).toBe(true)
    expect(signupSchema.safeParse({ ...self, students: [...base.students, ...base.students] }).success).toBe(false)
    expect(signupSchema.safeParse({ ...self, selfPhone: '' }).success).toBe(false)
  })
  it('ages and phones', () => {
    expect(ageOnDay('2008-11-12', '2026-11-12')).toBe(18)
    expect(ageOnDay('2008-11-13', '2026-11-12')).toBe(17)
    expect(contactPhone({ who: 'PARENT', parent: base.parent as never, selfPhone: null })).toBeTruthy()
  })
  it('skips steps that do not apply', () => {
    expect(stepsFor('RECORDED', 'PARENT')).not.toContain('time')
    expect(stepsFor('ONLINE', 'PARENT')).toContain('time')
    expect(stepsFor('ONLINE', 'SELF')).not.toContain('family')
  })
})
