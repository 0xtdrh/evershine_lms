import { describe, expect, it } from 'vitest'
import {
  attemptsAllowed, canStart, deadlineFor, drawFromBank, gradeQuiz, gradeQuizQuestion, isExpired, itemAnalysis, needsInstructorOpen,
  quizDataSchema, quizQuestionSchema, quizScore, shuffle, stripQuestion, type QuizQuestion,
} from '@/lib/quizzes/rules'

const Q = (o: Record<string, unknown>): QuizQuestion => quizQuestionSchema.parse({ id: 'q', points: 2, ...o })

describe('L4 — code and other question types', () => {
  it('what does it print (multi-line, spaces at line ends ignored)', () => {
    const q = Q({ type: 'CODE_OUTPUT', code: 'for i in range(3):\n  print(i*2)', correct: ['0\n2\n4'] })
    expect(gradeQuizQuestion(q, '0\n2  \n4\n').correct).toBe(true)
    expect(gradeQuizQuestion(q, '0 2 4').correct).toBe(false)
  })
  it('variable value: number with tolerance or text', () => {
    expect(gradeQuizQuestion(Q({ type: 'CODE_VALUE', correct: ['10'] }), ' 10 ').correct).toBe(true)
    expect(gradeQuizQuestion(Q({ type: 'CODE_VALUE', correct: ['hello'] }), '"hello"').correct).toBe(true)
    expect(gradeQuizQuestion(Q({ type: 'CODE_VALUE', correct: ['3.14'], tolerance: 0.01 }), '3.145').correct).toBe(true)
  })
  it('find the buggy line', () => {
    const q = Q({ type: 'FIND_BUG', code: 'a = 1\nprint(b)', correct: [2] })
    expect(gradeQuizQuestion(q, 2).correct).toBe(true)
    expect(gradeQuizQuestion(q, 1).points).toBe(0)
  })
  it('fill the blanks: partial credit, accepted alternatives', () => {
    const q = Q({ type: 'FILL_BLANK', points: 4, code: 'for i in ___(5):\n  ___(i)', correct: ['range', 'print|Print'] })
    expect(gradeQuizQuestion(q, ['range', 'print']).points).toBe(4)
    expect(gradeQuizQuestion(q, ['range', 'echo']).points).toBe(2)
  })
  it('order / Parsons: exact order only', () => {
    const q = Q({ type: 'PARSONS', items: [{ id: 'a', textEn: 'x = 1' }, { id: 'b', textEn: 'x += 1' }, { id: 'c', textEn: 'print(x)' }] })
    expect(gradeQuizQuestion(q, ['a', 'b', 'c']).correct).toBe(true)
    expect(gradeQuizQuestion(q, ['b', 'a', 'c']).correct).toBe(false)
  })
  it('match pairs: partial credit', () => {
    const q = Q({ type: 'MATCH_CODE', points: 3, pairs: [{ id: '1', left: 'print(1)', right: '1' }, { id: '2', left: 'print(2)', right: '2' }, { id: '3', left: 'print(3)', right: '3' }] })
    expect(gradeQuizQuestion(q, { 1: '1', 2: '3', 3: '2' }).points).toBe(1)
    expect(gradeQuizQuestion(q, { 1: '1', 2: '2', 3: '3' }).correct).toBe(true)
  })
  it('choose the code / picture / error meaning; basic types still work', () => {
    expect(gradeQuizQuestion(Q({ type: 'CHOOSE_CODE', correct: ['b'] }), 'b').correct).toBe(true)
    expect(gradeQuizQuestion(Q({ type: 'PICTURE', correct: ['cat'] }), 'dog').correct).toBe(false)
    expect(gradeQuizQuestion(Q({ type: 'TRUE_FALSE', correct: ['true'] }), 'true').correct).toBe(true)
  })
  it('write code: browser tests count but always need review', () => {
    const q = Q({ type: 'WRITE_CODE', points: 4, tests: [{ id: 't1', expected: '1', points: 1 }, { id: 't2', expected: '2', points: 3 }] })
    const r = gradeQuizQuestion(q, { code: 'x', results: [{ id: 't2', passed: true }] })
    expect([r.points, r.review]).toEqual([3, true])
    expect(gradeQuiz([q], {}).needsReview).toBe(true)
  })
})

describe('L4 — what the browser gets, random order, tries, timer', () => {
  it('no correct answers in the student copy; order follows the attempt seed', () => {
    const q = Q({ type: 'ORDER', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], correct: ['x'] })
    const s1 = stripQuestion(q, 'seed-1', true)
    expect('correct' in s1).toBe(false)
    expect(stripQuestion(q, 'seed-1', true).items).toEqual(s1.items)
    expect(new Set(s1.items.map((i) => i.id))).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(stripQuestion(Q({ type: 'FILL_BLANK', code: '___ and ___' }), 's', true).blanks).toBe(2)
  })
  it('seeded shuffle is stable; bank draw takes N', () => {
    expect(shuffle([1, 2, 3, 4, 5], 'x')).toEqual(shuffle([1, 2, 3, 4, 5], 'x'))
    expect(drawFromBank([1, 2, 3, 4, 5, 6], 3, 'y')).toHaveLength(3)
  })
  it('defaults: session 2 tries, final 1 try + instructor opens it', () => {
    const s = quizDataSchema.parse({ questions: [{ id: 'a', type: 'SHORT' }] })
    const f = quizDataSchema.parse({ kind: 'FINAL', questions: [{ id: 'a', type: 'SHORT' }] })
    expect([attemptsAllowed(s), attemptsAllowed(f), needsInstructorOpen(s), needsInstructorOpen(f)]).toEqual([2, 1, false, true])
    expect(quizDataSchema.safeParse({ questions: [] }).success).toBe(false)
  })
  it('start rules', () => {
    const now = new Date('2026-10-10T10:00:00Z')
    const base = { now, used: 0, allowed: 2, hasActive: false, needsOpen: false, isOpen: false, closesAt: null }
    expect(canStart(base).ok).toBe(true)
    expect(canStart({ ...base, needsOpen: true }).code).toBe('NOT_OPEN')
    expect(canStart({ ...base, used: 2 }).code).toBe('NO_ATTEMPTS')
    expect(canStart({ ...base, used: 2, hasActive: true }).resume).toBe(true)
    expect(canStart({ ...base, closesAt: new Date('2026-10-10T09:00:00Z') }).code).toBe('CLOSED')
  })
  it('deadline = time limit, never after the quiz closes; 30 s grace', () => {
    const start = new Date('2026-10-10T10:00:00Z')
    expect(deadlineFor(start, 20, null)?.toISOString()).toBe('2026-10-10T10:20:00.000Z')
    expect(deadlineFor(start, 20, new Date('2026-10-10T10:05:00Z'))?.toISOString()).toBe('2026-10-10T10:05:00.000Z')
    expect(deadlineFor(start, 0, null)).toBeNull()
    expect(isExpired(new Date('2026-10-10T10:00:00Z'), new Date('2026-10-10T10:00:20Z'))).toBe(false)
    expect(isExpired(new Date('2026-10-10T10:00:00Z'), new Date('2026-10-10T10:00:40Z'))).toBe(true)
  })
  it('quiz score: best / last / average', () => {
    const atts = [{ score: 4, maxScore: 10, createdAt: new Date(1) }, { score: 8, maxScore: 10, createdAt: new Date(2) }, { score: 6, maxScore: 10, createdAt: new Date(3) }]
    expect(quizScore(atts, 'BEST')?.percent).toBe(80)
    expect(quizScore(atts, 'LAST')?.percent).toBe(60)
    expect(quizScore(atts, 'AVERAGE')?.percent).toBe(60)
    expect(quizScore([], 'BEST')).toBeNull()
  })
  it('item analysis: hardest first, most chosen wrong answer', () => {
    const q = Q({ type: 'SINGLE', textEn: 'Pin?', options: [{ id: 'a', textEn: '13' }, { id: 'b', textEn: '7' }], correct: ['a'] })
    const row = (ans: string) => ({ questions: [q], answers: { q: ans }, detail: [gradeQuizQuestion(q, ans)] })
    const r = itemAnalysis([row('a'), row('b'), row('b')])
    expect(r[0]).toMatchObject({ answered: 3, percentCorrect: 33, commonWrong: '7' })
  })
})
