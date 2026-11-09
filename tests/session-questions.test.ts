import { describe, expect, it } from 'vitest'
import { DEFAULT_QUESTIONS, cleanPerSession, cleanQuestions, pickQuestions, questionAverages, summarize, validAnswers } from '@/lib/ratings/questions'
import { DEFAULT_CRITERIA, cleanScores, hasLowScore, visibleScores } from '@/lib/session-reports/rules'

describe('session rating questions', () => {
  it('falls back to the defaults and drops bad rows', () => {
    expect(cleanQuestions(null)).toEqual(DEFAULT_QUESTIONS)
    expect(cleanQuestions([{ id: 'a', ar: 'س' }, { id: 'a', ar: 'تاني' }, { id: '', ar: 'x' }]).map((q) => q.id)).toEqual(['a'])
    expect(cleanPerSession(99)).toBe(3)
  })
  it('asks 3 and moves on from session to session, the same for everyone in a session', () => {
    const a = pickQuestions(DEFAULT_QUESTIONS, 3, '2026-11-01').map((q) => q.id)
    expect(a).toHaveLength(3)
    expect(pickQuestions(DEFAULT_QUESTIONS, 3, '2026-11-01').map((q) => q.id)).toEqual(a)
    expect(pickQuestions(DEFAULT_QUESTIONS, 3, '2026-11-02').map((q) => q.id)).not.toEqual(a)
  })
  it('skips questions switched off', () => {
    const qs = DEFAULT_QUESTIONS.map((q, i) => ({ ...q, active: i === 0 }))
    expect(pickQuestions(qs, 3, '2026-11-01').map((q) => q.id)).toEqual(['fun'])
  })
  it('needs every question answered with 1..5', () => {
    const asked = DEFAULT_QUESTIONS.slice(0, 2)
    expect(validAnswers({ fun: 5, understood: 1 }, asked)).toBe(true)
    expect(validAnswers({ fun: 5 }, asked)).toBe(false)
    expect(validAnswers({ fun: 5, understood: 6 }, asked)).toBe(false)
    expect(validAnswers({ fun: 5, understood: 1, extra: 3 }, asked)).toBe(false)
  })
  it('keeps the old 1..4 rating and flags a low one', () => {
    expect(summarize({ a: 5, b: 5 })).toEqual({ average: 5, rating: 4, low: false })
    expect(summarize({ a: 2, b: 2 })).toEqual({ average: 2, rating: 1, low: true })
    expect(summarize({ a: 3, b: 3 }).rating).toBe(2)
    expect(summarize({ a: 4, b: 4 }).rating).toBe(3)
  })
  it('averages each question and ignores old one-tap rows', () => {
    expect(questionAverages([{ fun: 4 }, { fun: 5 }, null], DEFAULT_QUESTIONS.slice(0, 1))[0]).toMatchObject({ average: 4.5, count: 2 })
  })
})

describe('instructor rating of a student', () => {
  it('keeps only known criteria, 1..5', () => {
    expect(cleanScores({ participation: 4, nope: 3, behaviour: 9 }, DEFAULT_CRITERIA)).toEqual({ participation: 4 })
    expect(cleanScores({}, DEFAULT_CRITERIA)).toBeNull()
  })
  it('a low rating stays with the managers until released', () => {
    const s = { participation: 5, behaviour: 2 }
    expect(hasLowScore(s)).toBe(true)
    expect(visibleScores(s, DEFAULT_CRITERIA, { family: true, released: false }).map((x) => x.id)).toEqual(['participation'])
    expect(visibleScores(s, DEFAULT_CRITERIA, { family: true, released: true }).map((x) => x.id)).toEqual(['participation', 'behaviour'])
    expect(visibleScores(s, DEFAULT_CRITERIA, { family: false, released: false })).toHaveLength(2)
  })
})
