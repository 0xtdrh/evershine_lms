import { describe, expect, it } from 'vitest'
import { inventorTitle, levelStars, percent, timeline, whatIsLeft } from '@/lib/profile/journey'

describe("the inventor's journey", () => {
  it('stars come only from a final, passed result', () => {
    expect(levelStars({ finalScore: 95, passed: true })).toBe(3)
    expect(levelStars({ finalScore: 80, passed: true })).toBe(2)
    expect(levelStars({ finalScore: 60, passed: true })).toBe(1)
    expect(levelStars({ finalScore: 95, passed: null })).toBe(0)
    expect(levelStars({ finalScore: 40, passed: false })).toBe(0)
  })
  it('the title grows with finished levels', () => {
    expect(inventorTitle(0).en).toBe('New inventor')
    expect(inventorTitle(1).en).toBe('Young engineer')
    expect(inventorTitle(3).en).toBe('Innovator')
    expect(inventorTitle(6).en).toBe('Expert inventor')
  })
  it("what's left never goes below zero", () => {
    expect(whatIsLeft({ totalSessions: 8, heldSessions: 5, homeworkSet: 4, homeworkHanded: 3, resultFinal: false })).toEqual({ sessions: 3, homework: 1, finalResult: true })
    expect(whatIsLeft({ totalSessions: 8, heldSessions: 10, homeworkSet: 1, homeworkHanded: 2, resultFinal: true })).toEqual({ sessions: 0, homework: 0, finalResult: false })
  })
  it('the timeline is in date order, without repeats', () => {
    const t = timeline([
      { at: '2026-03-01T00:00:00Z', kind: 'LEVEL_DONE', en: 'b', ar: 'b' },
      { at: '2026-01-01T00:00:00Z', kind: 'JOINED', en: 'a', ar: 'a' },
      { at: '2026-03-01T10:00:00Z', kind: 'LEVEL_DONE', en: 'b', ar: 'b' },
      { at: 'bad', kind: 'STAMP', en: 'x', ar: 'x' },
    ])
    expect(t.map((e) => e.en)).toEqual(['a', 'b'])
  })
  it('percent of nothing is nothing', () => {
    expect(percent(3, 4)).toBe(75)
    expect(percent(0, 0)).toBeNull()
  })
})
