import { describe, expect, it } from 'vitest'
import { countedAttempts, skillScores, strongWeak, topPhrase } from '@/lib/skills/calc'

const skills = [{ id: 'loops', nameEn: 'Loops', nameAr: 'التكرار' }, { id: 'vars', nameEn: 'Variables', nameAr: 'المتغيرات' }, { id: 'ifs', nameEn: 'Conditions', nameAr: 'الشروط' }]

describe('skillScores', () => {
  it('points earned / possible per skill; an item counts for every skill it is tagged with', () => {
    const r = skillScores([
      { skillIds: ['loops'], points: 2, max: 2 },
      { skillIds: ['loops', 'vars'], points: 1, max: 2 },
      { skillIds: ['vars'], points: 0, max: 1 },
    ], skills)
    expect(r.map((s) => [s.id, s.percent, s.items])).toEqual([['loops', 75, 2], ['vars', 33, 2], ['ifs', null, 0]])
  })
  it('ignores unknown skills, empty items and points above the max', () => {
    const r = skillScores([{ skillIds: ['other'], points: 1, max: 1 }, { skillIds: ['ifs'], points: 5, max: 0 }, { skillIds: ['ifs', 'ifs'], points: 9, max: 3 }], skills)
    expect(r.find((s) => s.id === 'ifs')).toMatchObject({ percent: 100, items: 1 })
    expect(r.find((s) => s.id === 'loops')?.percent).toBeNull()
  })
})

describe('countedAttempts', () => {
  const a = (score: number, at: string) => ({ score, maxScore: 10, createdAt: new Date(at) })
  const tries = [a(4, '2026-10-01'), a(9, '2026-10-02'), a(6, '2026-10-03')]
  it('best / last / average like the quiz score', () => {
    expect(countedAttempts(tries, 'BEST').map((x) => x.score)).toEqual([9])
    expect(countedAttempts(tries, 'LAST').map((x) => x.score)).toEqual([6])
    expect(countedAttempts(tries, 'AVERAGE')).toHaveLength(3)
    expect(countedAttempts([{ score: null, maxScore: 10, createdAt: new Date() }], 'BEST')).toEqual([])
  })
})

describe('strongWeak + topPhrase', () => {
  it('strong >= 75, weak < 50, unmeasured skipped', () => {
    const r = strongWeak(skillScores([{ skillIds: ['loops'], points: 9, max: 10 }, { skillIds: ['vars'], points: 2, max: 10 }], skills))
    expect(r.strong.map((s) => s.id)).toEqual(['loops'])
    expect(r.weak.map((s) => s.id)).toEqual(['vars'])
  })
  it('most used phrase (once per report)', () => {
    expect(topPhrase([['a', 'b'], ['b', 'b'], null, ['c']])).toBe('b')
    expect(topPhrase([])).toBeNull()
  })
})
