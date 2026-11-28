import { describe, expect, it } from 'vitest'
import { autoAwards, BUILTIN_STAMPS, canGive, eventOpen, fullYears, stampSchema, tracksGraduated, type Facts } from '@/lib/passport/rules'

const d = (s: string) => new Date(s)
const facts = (p: Partial<Facts> = {}): Facts => ({
  joinedAt: d('2024-03-10'), levelsPassed: [], tracksGraduated: [], sessions: 0, perfectMonths: [], stars: 0, galleryProjects: 0,
  homeworkMonths: [], quizzesAbove90: 0, bestSkillPercent: null, referrals: 0, earlyRenewals: 0, hasActiveGroup: true, ...p,
})
const now = d('2026-10-12')
const rule = (r: string, threshold: number | null = null, repeatable = false) => ({ rule: r, threshold, repeatable })

describe('autoAwards', () => {
  it('one level stamp per passed level, in the track colour', () => {
    const f = facts({ levelsPassed: [{ levelId: 'L1', label: 'Robotics · 1', trackId: 'T1', at: now }, { levelId: 'L2', label: 'Robotics · 2', trackId: 'T1', at: now }] })
    expect(autoAwards(rule('LEVEL_PASSED', null, true), f, now, { T1: '#ff0000' })).toEqual([
      { refKey: 'L1', label: 'Robotics · 1', color: '#ff0000' }, { refKey: 'L2', label: 'Robotics · 2', color: '#ff0000' },
    ])
  })
  it('counting rules use the threshold', () => {
    expect(autoAwards(rule('SESSIONS', 50), facts({ sessions: 49 }), now)).toEqual([])
    expect(autoAwards(rule('SESSIONS', 50), facts({ sessions: 50 }), now)).toEqual([{ refKey: '' }])
    expect(autoAwards(rule('STARS', 5), facts({ stars: 5 }), now)).toHaveLength(1)
    expect(autoAwards(rule('QUIZ_MASTER', 5), facts({ quizzesAbove90: 4 }), now)).toEqual([])
    expect(autoAwards(rule('SKILL_MASTER'), facts({ bestSkillPercent: 92 }), now)).toHaveLength(1)
  })
  it('a non-repeatable stamp is given once even when there are many reasons', () => {
    const f = facts({ perfectMonths: [{ groupId: 'g1', label: 'A' }, { groupId: 'g2', label: 'B' }] })
    expect(autoAwards(rule('PERFECT_MONTH', null, false), f, now)).toEqual([{ refKey: '', label: 'A' }])
    expect(autoAwards(rule('PERFECT_MONTH', null, true), f, now)).toHaveLength(2)
  })
  it('anniversary: one stamp per full year', () => {
    expect(autoAwards(rule('ANNIVERSARY', null, true), facts(), now).map((a) => a.refKey)).toEqual(['Y1', 'Y2'])
    expect(fullYears(d('2024-10-13'), now)).toBe(1)
  })
  it('alumni only with a graduated track and no running group', () => {
    const g = [{ trackId: 'T1', name: 'Junior', at: now }]
    expect(autoAwards(rule('ALUMNI'), facts({ tracksGraduated: g, hasActiveGroup: true }), now)).toEqual([])
    expect(autoAwards(rule('ALUMNI'), facts({ tracksGraduated: g, hasActiveGroup: false }), now)).toHaveLength(1)
  })
})

describe('tracksGraduated (rule B)', () => {
  const tracks = [{ id: 'T1', name: 'Junior', courses: [{ id: 'robo', lastLevelId: 'R3' }, { id: 'scratch', lastLevelId: 'S2' }, { id: '3d', lastLevelId: 'D1' }] }]
  const passed = [{ levelId: 'R3', at: d('2026-05-01') }, { levelId: 'S2', at: d('2026-06-01') }]
  it('nothing chosen = every course needed', () => {
    expect(tracksGraduated(tracks, {}, passed)).toEqual([])
  })
  it('only the chosen courses are needed; the date is the last one finished', () => {
    expect(tracksGraduated(tracks, { T1: ['robo', 'scratch'] }, passed)).toEqual([{ trackId: 'T1', name: 'Junior', at: d('2026-06-01') }])
  })
  it('a track without levels never graduates anyone', () => {
    expect(tracksGraduated([{ id: 'T2', name: 'Empty', courses: [{ id: 'x', lastLevelId: null }] }], {}, passed)).toEqual([])
  })
})

describe('givers, events, schema, built-ins', () => {
  it('givers and event dates', () => {
    expect(canGive(['TEACHER'], 'TEACHER')).toBe(true)
    expect(canGive(['ADMIN'], 'SECRETARY')).toBe(false)
    expect(eventOpen({ eventFrom: d('2026-10-12'), eventTo: d('2026-10-12') }, d('2026-10-12T20:00:00Z'))).toBe(true)
    expect(eventOpen({ eventFrom: d('2026-10-13'), eventTo: null }, now)).toBe(false)
  })
  it('schema needs a rule (+ number) for automatic stamps and givers for the others', () => {
    expect(stampSchema.safeParse({ nameEn: 'X', kind: 'AUTO' }).success).toBe(false)
    expect(stampSchema.safeParse({ nameEn: 'X', kind: 'AUTO', rule: 'SESSIONS' }).success).toBe(false)
    expect(stampSchema.safeParse({ nameEn: 'X', kind: 'AUTO', rule: 'SESSIONS', threshold: 20 }).success).toBe(true)
    expect(stampSchema.safeParse({ nameEn: 'X', kind: 'MANUAL' }).success).toBe(false)
    expect(stampSchema.safeParse({ nameEn: 'X', kind: 'MANUAL', givers: ['TEACHER'] }).success).toBe(true)
  })
  it('built-in codes are unique and valid', () => {
    expect(new Set(BUILTIN_STAMPS.map((s) => s.code)).size).toBe(BUILTIN_STAMPS.length)
    for (const s of BUILTIN_STAMPS) expect(stampSchema.safeParse({ ...s, givers: s.givers ?? [] }).success).toBe(true)
  })
})

import { autoAwards as aa28, longestStreak } from '@/lib/passport/rules'
describe('newer automatic conditions (owner 28/11)', () => {
  const base = { joinedAt: new Date('2026-01-01'), levelsPassed: [], tracksGraduated: [], sessions: 0, perfectMonths: [], stars: 0, galleryProjects: 0, homeworkMonths: [], quizzesAbove90: 0, bestSkillPercent: null, referrals: 0, earlyRenewals: 0, hasActiveGroup: true }
  const give = (rule: string, threshold: number, extra: object) => aa28({ rule, threshold, repeatable: false }, { ...base, ...extra } as never, new Date()).length
  it('longest run without an absence (excused keeps it going)', () => {
    expect(longestStreak(['PRESENT', 'LATE', 'EXCUSED', 'PRESENT', 'ABSENT', 'PRESENT'])).toBe(3)
    expect(longestStreak([])).toBe(0)
  })
  it('each condition gives the stamp only from its number', () => {
    expect(give('STREAK', 10, { bestStreak: 9 })).toBe(0)
    expect(give('STREAK', 10, { bestStreak: 10 })).toBe(1)
    expect(give('HOMEWORK_COUNT', 10, { homeworkHandedIn: 10 })).toBe(1)
    expect(give('PERFECT_QUIZ', 1, { quizzesPerfect: 1 })).toBe(1)
    expect(give('CERTIFICATES', 2, { certificates: 1 })).toBe(0)
    expect(give('RECORDED_DONE', 1, { recordedFinished: 1 })).toBe(1)
    expect(give('EVENTS', 3, { eventStamps: 3 })).toBe(1)
    expect(give('REFERRALS', 3, { referrals: 2 })).toBe(0)
    expect(give('COLLECTOR', 10, { stampsTaken: 10 })).toBe(1)
    expect(give('LEVELS_COUNT', 3, { levelsPassed: [1, 2, 3].map((i) => ({ levelId: `l${i}`, label: '', trackId: null, at: new Date() })) })).toBe(1)
  })
})

import { nextStamp, stampProgress } from '@/lib/passport/rules'
describe('the next stamp (owner 28/11)', () => {
  const f = { joinedAt: new Date('2026-01-01'), levelsPassed: [], tracksGraduated: [], sessions: 7, perfectMonths: [], stars: 1, galleryProjects: 0, homeworkMonths: [], quizzesAbove90: 0, bestSkillPercent: null, referrals: 0, earlyRenewals: 0, hasActiveGroup: true, bestStreak: 4, homeworkHandedIn: 9 }
  it('progress is capped and only for counting rules', () => {
    expect(stampProgress({ rule: 'SESSIONS', threshold: 10 }, f as never)).toEqual({ have: 7, need: 10 })
    expect(stampProgress({ rule: 'SESSIONS', threshold: 5 }, f as never)).toEqual({ have: 5, need: 5 })
    expect(stampProgress({ rule: 'WELCOME', threshold: null }, f as never)).toBeNull()
  })
  it('picks the stamp closest to being earned, never one already reached', () => {
    const list = [{ id: 'a', rule: 'SESSIONS', threshold: 10 }, { id: 'b', rule: 'HOMEWORK_COUNT', threshold: 10 }, { id: 'c', rule: 'STREAK', threshold: 10 }, { id: 'd', rule: 'SESSIONS', threshold: 5 }]
    expect(nextStamp(list, f as never)?.id).toBe('b')
  })
})
