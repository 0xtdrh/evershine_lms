import { describe, expect, it } from 'vitest'
import { blockedAfter, gateMessage, gateMet, parseGate, type GateFacts } from '@/lib/lms/gate'
import { sessionStates } from '@/lib/lms/unlock'

const now = new Date('2026-10-18T12:00:00Z')
const facts = (p: Partial<GateFacts>): GateFacts => ({ contentDone: true, homework: [], quizzes: [], homeworkMissing: 0, ...p })
const opts = { ungradedOpensAfterDays: null, now }

describe('session gate (2026-10-18)', () => {
  it('parse: empty / nonsense = no gate; min % only kept when it applies', () => {
    expect(parseGate(null)).toBeNull()
    expect(parseGate({ content: false })).toBeNull()
    expect(parseGate({ homework: 'SUBMITTED', minHomeworkPct: 70, quiz: true, minQuizPct: 120 })).toEqual({ content: false, homework: 'SUBMITTED', minHomeworkPct: null, quiz: true, minQuizPct: 100 })
  })
  it('homework handed in', () => {
    const g = parseGate({ homework: 'SUBMITTED' })
    expect(gateMet(g, facts({ homeworkMissing: 1 }), opts)).toEqual({ met: false, missing: ['HOMEWORK'] })
    expect(gateMet(g, facts({ homework: [{ status: 'DRAFT', pct: null, submittedAt: null }] }), opts).met).toBe(false)
    expect(gateMet(g, facts({ homework: [{ status: 'RETURNED', pct: null, submittedAt: null }] }), opts).met).toBe(false)
    expect(gateMet(g, facts({ homework: [{ status: 'SUBMITTED', pct: null, submittedAt: now }] }), opts).met).toBe(true)
  })
  it('homework graded with a lowest %, and the late-grading setting', () => {
    const g = parseGate({ homework: 'GRADED', minHomeworkPct: 60 })
    const waiting = facts({ homework: [{ status: 'SUBMITTED', pct: null, submittedAt: new Date('2026-10-15T12:00:00Z') }] })
    expect(gateMet(g, waiting, opts).missing).toEqual(['HOMEWORK_GRADE'])
    expect(gateMet(g, waiting, { ungradedOpensAfterDays: 2, now }).met).toBe(true)
    expect(gateMet(g, waiting, { ungradedOpensAfterDays: 5, now }).met).toBe(false)
    expect(gateMet(g, facts({ homework: [{ status: 'GRADED', pct: 55, submittedAt: now }] }), opts).missing).toEqual(['HOMEWORK_SCORE'])
    expect(gateMet(g, facts({ homework: [{ status: 'GRADED', pct: 60, submittedAt: now }] }), opts).met).toBe(true)
    expect(gateMet(g, facts({ homework: [{ status: 'EXCUSED', pct: null, submittedAt: null }] }), opts).met).toBe(true)
  })
  it('quiz: own pass mark unless a lowest % is set; both homework and quiz', () => {
    expect(gateMet(parseGate({ quiz: true }), facts({ quizzes: [{ bestPct: 49, passMark: 50, waitingReview: false }] }), opts).met).toBe(false)
    expect(gateMet(parseGate({ quiz: true, minQuizPct: 40 }), facts({ quizzes: [{ bestPct: 49, passMark: 50, waitingReview: false }] }), opts).met).toBe(true)
    const both = parseGate({ homework: 'SUBMITTED', quiz: true })
    expect(gateMet(both, facts({ homeworkMissing: 1, quizzes: [{ bestPct: null, passMark: 50, waitingReview: false }] }), opts).missing).toEqual(['HOMEWORK', 'QUIZ'])
    expect(gateMessage(3, ['HOMEWORK', 'QUIZ'], both).ar).toBe('بتتفتح لما تسلّم الواجب وتنجح في الامتحان في الحصة 3.')
  })
  it('no skipping: everything after the first unfinished gated session waits for it', () => {
    expect([...blockedAfter([3, 1], 4)]).toEqual([[2, 1], [3, 1], [4, 1]])
    expect(blockedAfter([], 4).size).toBe(0)
  })
  it('unlock: a gate keeps the next session shut; the instructor can open it for one student', () => {
    const base = { mode: 'ATTENDANCE' as const, totalSessions: 4, perCycle: 4, cycleNumber: 1, heldCount: 3, now }
    const st = sessionStates({ ...base, gateBlocked: new Map([[2, 1]]) })
    expect(st.map((s) => [s.number, s.open, s.reason ?? null, s.blockedBy ?? null])).toEqual([[1, true, 'HELD', null], [2, false, 'GATE', 1], [3, true, 'HELD', null], [4, false, null, null]])
    const opened = sessionStates({ ...base, gateBlocked: new Map([[2, 1]]), studentOpened: new Set([2]) })
    expect([opened[1].open, opened[1].reason]).toEqual([true, 'STUDENT_OPENED'])
  })
})
