import { describe, expect, it } from 'vitest'
import { ageOn, buildMap, checkUpload, goalProgress, goalSchema, recapWeek, PROFILE_DEFAULTS, type MapTrack } from '@/lib/profile/rules'

const d = (s: string) => new Date(s)

describe('goals', () => {
  it('system goal counts from the baseline', () => {
    expect(goalProgress({ kind: 'SYSTEM', metric: 'SESSIONS', target: 10, baseline: 5, progress: 0 }, 12)).toEqual({ value: 7, target: 10, percent: 70, done: false })
    expect(goalProgress({ kind: 'SYSTEM', metric: 'STAMPS', target: 3, baseline: 0, progress: 0 }, 4)).toMatchObject({ percent: 100, done: true, value: 3 })
  })
  it('level goal and free goal', () => {
    expect(goalProgress({ kind: 'SYSTEM', metric: 'LEVEL', target: null, baseline: null, progress: 0 }, null, true).done).toBe(true)
    expect(goalProgress({ kind: 'FREE', metric: null, target: null, baseline: null, progress: 140 }, null)).toMatchObject({ percent: 100, done: true })
  })
  it('schema', () => {
    expect(goalSchema.safeParse({ title: 'Attend', kind: 'SYSTEM', metric: 'SESSIONS' }).success).toBe(false)
    expect(goalSchema.safeParse({ title: 'Attend', kind: 'SYSTEM', metric: 'SESSIONS', target: 20 }).success).toBe(true)
    expect(goalSchema.safeParse({ title: 'Level', kind: 'SYSTEM', metric: 'LEVEL' }).success).toBe(false)
    expect(goalSchema.safeParse({ title: 'Dancing robot', kind: 'FREE' }).success).toBe(true)
  })
})

describe('buildMap', () => {
  const tracks: MapTrack[] = [
    { id: 'J', name: 'Junior', minAge: 7, maxAge: 11, courses: [
      { id: 'scratch', name: 'Scratch', order: 2, levels: [{ id: 's1', name: 'L1', order: 1 }, { id: 's2', name: 'L2', order: 2 }] },
      { id: 'robo', name: 'Robotics', order: 1, levels: [{ id: 'r1', name: 'L1', order: 1 }, { id: 'r2', name: 'L2', order: 2 }] },
    ] },
    { id: 'T', name: 'Teens', minAge: 12, maxAge: 17, courses: [{ id: 'py', name: 'Python', order: 1, levels: [{ id: 'p1', name: 'L1', order: 1 }] }] },
  ]
  it('continue the course: next level after the last finished one', () => {
    const m = buildMap(tracks, new Set(['r1']), new Set(), 9)
    expect(m.next).toMatchObject({ levelId: 'r2', reason: 'CONTINUE' })
    expect(m.islands[0].courses[0].levels.map((l) => l.state)).toEqual(['DONE', 'NEXT'])
  })
  it('in a level now: it is CURRENT and nothing else is pushed', () => {
    const m = buildMap(tracks, new Set(['r1']), new Set(['r2']), 9)
    expect(m.next).toBeNull()
    expect(m.islands[0].courses[0].levels[1].state).toBe('CURRENT')
  })
  it('course finished → next course of the track (track order)', () => {
    expect(buildMap(tracks, new Set(['r1', 'r2']), new Set(), 9).next).toMatchObject({ levelId: 's1', reason: 'NEXT_COURSE' })
  })
  it('the map shows only the student tracks (in / finished), not the suggested one', () => {
    expect(buildMap(tracks, new Set(['r1']), new Set(['r2']), 9).islands.map((i) => i.id)).toEqual(['J'])
    expect(buildMap(tracks, new Set(), new Set(), 13).islands).toEqual([])
  })
  it('nothing yet → a track that fits the age', () => {
    expect(buildMap(tracks, new Set(), new Set(), 13).next).toMatchObject({ levelId: 'p1', reason: 'NEW_TRACK' })
    expect(buildMap(tracks, new Set(), new Set(), 8).next?.levelId).toBe('r1')
  })
})

describe('uploads, age, recap', () => {
  const folder = 'tn/profile/s1'
  it('checks folder, type, size and video length', () => {
    expect(checkUpload({ publicId: 'tn/profile/s1/a', resourceType: 'image', bytes: 1000 }, folder, PROFILE_DEFAULTS).ok).toBe(true)
    expect(checkUpload({ publicId: 'tn/other/a', resourceType: 'image' }, folder, PROFILE_DEFAULTS).ok).toBe(false)
    expect(checkUpload({ publicId: 'tn/profile/s1/v', resourceType: 'video', duration: 75 }, folder, PROFILE_DEFAULTS).ok).toBe(false)
    expect(checkUpload({ publicId: 'tn/profile/s1/v', resourceType: 'video', bytes: 60 * 1024 * 1024 }, folder, PROFILE_DEFAULTS).ok).toBe(false)
  })
  it('age and the recap week', () => {
    expect(ageOn(d('2014-10-13'), d('2026-10-12'))).toBe(11)
    expect(recapWeek(d('2024-10-10'), d('2026-10-12'))).toBe(2)
    expect(recapWeek(d('2024-10-01'), d('2026-10-12'))).toBeNull()
    expect(recapWeek(d('2026-01-01'), d('2026-10-12'))).toBeNull()
  })
})
