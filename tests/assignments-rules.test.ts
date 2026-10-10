import { describe, expect, it } from 'vitest'
import {
  assignmentDataSchema, canSubmit, finalScore, gradeQuestion, gradeQuestions, manualMax, normalizeText, penaltyFor,
  resolvePolicy, rubricScore, stripForStudent, totalMax, POLICY_DEFAULTS, type Question,
} from '@/lib/assignments/rules'

const q = (over: Partial<Question>): Question => ({ id: 'q', type: 'SINGLE', textEn: '', textAr: '', options: [], correct: [], points: 1, ...over })

describe('LMS L3 — automatic grading of questions', () => {
  it('single / multiple choice and true-false', () => {
    expect(gradeQuestion(q({ correct: ['b'] }), 'b').correct).toBe(true)
    expect(gradeQuestion(q({ correct: ['b'] }), 'a').points).toBe(0)
    expect(gradeQuestion(q({ type: 'MULTI', correct: ['a', 'c'], points: 2 }), ['c', 'a']).points).toBe(2)
    expect(gradeQuestion(q({ type: 'MULTI', correct: ['a', 'c'] }), ['a']).correct).toBe(false)
    expect(gradeQuestion(q({ type: 'MULTI', correct: ['a', 'c'] }), ['a', 'b', 'c']).correct).toBe(false)
    expect(gradeQuestion(q({ type: 'TRUE_FALSE', correct: ['false'] }), 'false').correct).toBe(true)
  })

  it('numbers with tolerance, Arabic digits and comma decimals', () => {
    expect(gradeQuestion(q({ type: 'NUMBER', correct: [5] }), '5').correct).toBe(true)
    expect(gradeQuestion(q({ type: 'NUMBER', correct: [5] }), '٥').correct).toBe(true)
    expect(gradeQuestion(q({ type: 'NUMBER', correct: [3.14], tolerance: 0.01 }), '3,15').correct).toBe(true)
    expect(gradeQuestion(q({ type: 'NUMBER', correct: [3.14], tolerance: 0.001 }), '3.15').correct).toBe(false)
  })

  it('short answers ignore case, spaces, Arabic letter forms', () => {
    expect(normalizeText('  أحمد  ')).toBe('احمد')
    expect(gradeQuestion(q({ type: 'SHORT', correct: ['LED', 'ليد'] }), ' led ').correct).toBe(true)
    expect(gradeQuestion(q({ type: 'SHORT', correct: ['مدرسة'] }), 'مدرسه').correct).toBe(true)
    expect(gradeQuestion(q({ type: 'SHORT', correct: ['LED'] }), '').points).toBe(0)
  })

  it('totals the questions', () => {
    const r = gradeQuestions([q({ id: 'a', correct: ['x'], points: 2 }), q({ id: 'b', correct: ['y'], points: 3 })], { a: 'x', b: 'z' })
    expect([r.score, r.max]).toEqual([2, 5])
  })
})

describe('LMS L3 — assignment settings and scores', () => {
  const criteria = [
    { id: 'idea', titleEn: 'Idea', titleAr: '', levels: [{ labelEn: 'A', labelAr: '', points: 4, descEn: '', descAr: '' }, { labelEn: 'B', labelAr: '', points: 2, descEn: '', descAr: '' }] },
    { id: 'build', titleEn: 'Build', titleAr: '', levels: [{ labelEn: 'A', labelAr: '', points: 6, descEn: '', descAr: '' }, { labelEn: 'B', labelAr: '', points: 3, descEn: '', descAr: '' }] },
  ]
  it('rubric needs every line; max = sum of the best levels', () => {
    expect(rubricScore(criteria, { idea: 0, build: 1 })).toEqual({ ok: true, points: 7, max: 10 })
    expect(rubricScore(criteria, { idea: 0 }).ok).toBe(false)
  })

  it('max score = questions + instructor part (points / rubric / stars)', () => {
    const base = assignmentDataSchema.parse({ kinds: ['PHOTO'], maxPoints: 10, questions: [q({ id: 'a', correct: ['x'], points: 2 })] })
    expect(totalMax(base)).toBe(12)
    expect(manualMax({ ...base, scale: 'STARS' })).toBe(3)
    expect(manualMax({ ...base, kinds: [] })).toBe(0)
    expect(totalMax({ ...base, scale: 'RUBRIC', rubric: { nameEn: '', nameAr: '', criteria, kidStars: false } })).toBe(12)
  })

  it('refuses impossible settings', () => {
    expect(assignmentDataSchema.safeParse({ kinds: [], questions: [] }).success).toBe(false)
    expect(assignmentDataSchema.safeParse({ kinds: ['PHOTO'], gradingMode: 'AUTO' }).success).toBe(false)
    expect(assignmentDataSchema.safeParse({ kinds: ['PHOTO'], scale: 'RUBRIC' }).success).toBe(false)
  })

  it('students never get the correct answers', () => {
    const a = assignmentDataSchema.parse({ kinds: [], questions: [q({ id: 'a', correct: ['x'], tolerance: 1 })] })
    const s = stripForStudent(a)
    expect('correct' in s.questions[0]).toBe(false)
    expect('tolerance' in s.questions[0]).toBe(false)
  })

  it('late penalty and rounding', () => {
    expect(finalScore(4, 6, 0)).toBe(10)
    expect(finalScore(4, 6, 20)).toBe(8)
    expect(finalScore(1, 1, 150)).toBe(0)
    expect(penaltyFor(true, { ...POLICY_DEFAULTS, latePenaltyPct: 10 })).toBe(10)
    expect(penaltyFor(true, { ...POLICY_DEFAULTS, late: 'ALLOWED', latePenaltyPct: 10 })).toBe(0)
    expect(penaltyFor(false, { ...POLICY_DEFAULTS, latePenaltyPct: 10 })).toBe(0)
  })
})

describe('LMS L3 — handing in rules', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const past = new Date('2026-10-09T12:00:00Z')
  it('policy: group > level > company > defaults', () => {
    expect(resolvePolicy({ maxAttempts: 3 }, { late: 'CLOSED' }, { latePenaltyPct: 5 })).toMatchObject({ maxAttempts: 3, late: 'CLOSED', latePenaltyPct: 5, resubmit: true })
  })
  it('late: marked / closed', () => {
    expect(canSubmit({ now, dueAt: past, policy: POLICY_DEFAULTS, status: null, attempt: 0 })).toMatchObject({ ok: true, late: true })
    expect(canSubmit({ now, dueAt: past, policy: { ...POLICY_DEFAULTS, late: 'CLOSED' }, status: null, attempt: 0 }).code).toBe('CLOSED')
    expect(canSubmit({ now, dueAt: null, policy: POLICY_DEFAULTS, status: null, attempt: 0 })).toMatchObject({ ok: true, late: false })
  })
  it('handing in again: allowed tries, returned work always', () => {
    expect(canSubmit({ now, dueAt: null, policy: POLICY_DEFAULTS, status: 'SUBMITTED', attempt: 1 }).ok).toBe(true)
    expect(canSubmit({ now, dueAt: null, policy: POLICY_DEFAULTS, status: 'GRADED', attempt: 2 }).code).toBe('NO_ATTEMPTS')
    expect(canSubmit({ now, dueAt: null, policy: { ...POLICY_DEFAULTS, resubmit: false }, status: 'GRADED', attempt: 1 }).code).toBe('NO_RESUBMIT')
    expect(canSubmit({ now, dueAt: null, policy: { ...POLICY_DEFAULTS, resubmit: false }, status: 'RETURNED', attempt: 5 }).ok).toBe(true)
  })
})
