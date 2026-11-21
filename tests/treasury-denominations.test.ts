import { describe, expect, it } from 'vitest'
import { countDifference, denominationTotal } from '@/lib/treasury/denominations'

describe('daily cash count by notes', () => {
  it('adds the notes and coins', () => {
    expect(denominationTotal({ '200': 3, '100': '2', '50': 1, '5': 4, '0.5': 3 })).toBe(871.5)
  })
  it('ignores empty, bad and negative counts and keeps whole pieces', () => {
    expect(denominationTotal({ '200': '', '100': 'x', '50': -2, '20': 2.7 })).toBe(40)
  })
  it('difference: positive = more cash than expected', () => {
    expect(countDifference(1000, 950)).toBe(-50)
    expect(countDifference(100.1, 100.3)).toBe(0.2)
  })
})
