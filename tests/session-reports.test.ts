import { describe, expect, it } from 'vitest'
import { cleanPhrases, computeSendAt, homeworkLine, missingPieces, quizLine, settingsSchema, DEFAULT_PHRASES, SESSION_REPORT_DEFAULTS } from '@/lib/session-reports/rules'

const d = (s: string) => new Date(s)

describe('computeSendAt', () => {
  const now = d('2026-10-11T16:00:00Z')
  it('session end + hours', () => {
    expect(computeSendAt({ mode: 'AUTO', hours: 3, sessionEnd: d('2026-10-11T15:30:00Z'), now })?.toISOString()).toBe('2026-10-11T18:30:00.000Z')
  })
  it('the instructor always has 30 minutes (attendance saved late)', () => {
    expect(computeSendAt({ mode: 'AUTO', hours: 3, sessionEnd: d('2026-10-11T08:00:00Z'), now })?.toISOString()).toBe('2026-10-11T16:30:00.000Z')
  })
  it('no schedule time → from now', () => {
    expect(computeSendAt({ mode: 'AUTO', hours: 2, sessionEnd: null, now })?.toISOString()).toBe('2026-10-11T18:00:00.000Z')
  })
  it('MANUAL = only by the instructor', () => {
    expect(computeSendAt({ mode: 'MANUAL', hours: 3, sessionEnd: now, now })).toBeNull()
  })
})

describe('homeworkLine', () => {
  const now = d('2026-10-11T12:00:00Z')
  const sub = (p: Partial<{ status: string; late: boolean; score: number | null; maxScore: number | null }>) => ({ status: 'GRADED', late: false, score: 8, maxScore: 10, ...p })
  it('graded and allowed → grade shown', () => {
    expect(homeworkLine({ sub: sub({}), dueAt: now, now, gradesVisible: true })).toEqual({ state: 'DONE', grade: 'SHOWN', score: 8, maxScore: 10 })
  })
  it('handed in but not graded → grading in progress', () => {
    expect(homeworkLine({ sub: sub({ status: 'SUBMITTED', late: true }), dueAt: now, now, gradesVisible: true })).toMatchObject({ state: 'LATE', grade: 'GRADING', score: null })
  })
  it('grade hidden by the release rule → later, no score', () => {
    expect(homeworkLine({ sub: sub({}), dueAt: now, now, gradesVisible: false })).toMatchObject({ grade: 'LATER', score: null })
  })
  it('missing only after the due date; a draft is not handed in', () => {
    expect(homeworkLine({ sub: null, dueAt: d('2026-10-10T00:00:00Z'), now, gradesVisible: true }).state).toBe('MISSING')
    expect(homeworkLine({ sub: sub({ status: 'DRAFT' }), dueAt: d('2026-10-12T00:00:00Z'), now, gradesVisible: true }).state).toBe('NOT_DUE')
  })
  it('returned for changes', () => {
    expect(homeworkLine({ sub: sub({ status: 'RETURNED' }), dueAt: now, now, gradesVisible: true }).grade).toBe('RETURNED')
  })
})

describe('quizLine', () => {
  const a = (status: string, score: number | null, at = '2026-10-11') => ({ status, score, maxScore: 10, createdAt: d(at) })
  it('result by the quiz scoring + pass mark', () => {
    expect(quizLine([a('GRADED', 4), a('GRADED', 7, '2026-10-12')], 'BEST', 60)).toEqual({ state: 'DONE', percent: 70, passed: true })
    expect(quizLine([a('GRADED', 4)], 'BEST', 60).passed).toBe(false)
  })
  it('a code answer waiting → grading; nothing → not taken', () => {
    expect(quizLine([a('SUBMITTED', null)], 'BEST', 50).state).toBe('GRADING')
    expect(quizLine([], 'BEST', 50).state).toBe('NOT_TAKEN')
  })
})

describe('phrases, settings, missing pieces', () => {
  it('keeps only known phrase ids, once', () => {
    expect(cleanPhrases(['focus', 'nope', 'focus', 'helped'], DEFAULT_PHRASES)).toEqual(['focus', 'helped'])
  })
  it('off by default; the defaults pass the schema', () => {
    expect(SESSION_REPORT_DEFAULTS.enabled).toBe(false)
    expect(settingsSchema.safeParse(SESSION_REPORT_DEFAULTS).success).toBe(true)
    expect(settingsSchema.safeParse({ ...SESSION_REPORT_DEFAULTS, hours: 100 }).success).toBe(false)
  })
  it('missing pieces', () => {
    expect(missingPieces({ ungradedHomework: 2, quizReview: 0 })).toEqual(['HOMEWORK_UNGRADED'])
    expect(missingPieces({ ungradedHomework: 0, quizReview: 0 })).toEqual([])
  })
})
