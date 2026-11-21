import { describe, expect, it } from 'vitest'
import { arCount, AR_NOUN } from '@/lib/i18n/plural'

describe('Arabic counts', () => {
  it('1 / 2 / 3-10 / 11+', () => {
    expect(arCount(1, AR_NOUN.student)).toBe('1 طالب')
    expect(arCount(2, AR_NOUN.student)).toBe('2 طالبين')
    expect(arCount(6, AR_NOUN.student)).toBe('6 طلاب')
    expect(arCount(10, AR_NOUN.session)).toBe('10 حصص')
    expect(arCount(11, AR_NOUN.student)).toBe('11 طالب')
    expect(arCount(30, AR_NOUN.day)).toBe('30 يوم')
    expect(arCount(0, AR_NOUN.student)).toBe('0 طالب')
  })
})
