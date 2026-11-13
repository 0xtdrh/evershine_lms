import { describe, expect, it } from 'vitest'
import { recordedAttendanceAction, sessionWatchedPercent } from '@/lib/attendance/recorded-watch-rules'

const base = { mode: 'RECORDED', percent: 85, threshold: 80, sessionDate: '2026-11-10', today: '2026-11-13', maxDays: 14, existing: null }

describe('six phases 2-B: recorded session attendance from watching', () => {
  it('session percent = all its videos together', () => {
    expect(sessionWatchedPercent([{ watchedSec: 600, durationSec: 600 }, { watchedSec: 0, durationSec: 600 }])).toBe(50)
    expect(sessionWatchedPercent([{ watchedSec: 900, durationSec: 600 }])).toBe(100)
    expect(sessionWatchedPercent([])).toBe(0)
    expect(sessionWatchedPercent([{ watchedSec: 10, durationSec: 0 }])).toBe(0)
  })
  it('no record → created present — watched', () => {
    expect(recordedAttendanceAction(base)).toBe('CREATE')
  })
  it('only for a RECORDED way of attending', () => {
    expect(recordedAttendanceAction({ ...base, mode: 'BRANCH' })).toBeNull()
    expect(recordedAttendanceAction({ ...base, mode: 'ONLINE' })).toBeNull()
  })
  it('below the percent → nothing', () => {
    expect(recordedAttendanceAction({ ...base, percent: 79 })).toBeNull()
    expect(recordedAttendanceAction({ ...base, percent: 80 })).toBe('CREATE')
  })
  it('a session that has not come yet → nothing', () => {
    expect(recordedAttendanceAction({ ...base, sessionDate: '2026-11-14' })).toBeNull()
    expect(recordedAttendanceAction({ ...base, sessionDate: '2026-11-13' })).toBe('CREATE')
  })
  it('too long after the session → nothing; 0 = no limit', () => {
    expect(recordedAttendanceAction({ ...base, sessionDate: '2026-10-20' })).toBeNull()
    expect(recordedAttendanceAction({ ...base, sessionDate: '2026-10-30' })).toBe('CREATE')
    expect(recordedAttendanceAction({ ...base, sessionDate: '2026-01-01', maxDays: 0 })).toBe('CREATE')
  })
  it('absent / excused → upgraded; present without detail → detail; watched → left', () => {
    expect(recordedAttendanceAction({ ...base, existing: { status: 'ABSENT', presenceDetail: null } })).toBe('UPGRADE')
    expect(recordedAttendanceAction({ ...base, existing: { status: 'EXCUSED', presenceDetail: null } })).toBe('UPGRADE')
    expect(recordedAttendanceAction({ ...base, existing: { status: 'PRESENT', presenceDetail: null } })).toBe('DETAIL')
    expect(recordedAttendanceAction({ ...base, existing: { status: 'LATE', presenceDetail: null } })).toBe('DETAIL')
    expect(recordedAttendanceAction({ ...base, existing: { status: 'PRESENT', presenceDetail: 'WATCHED' } })).toBeNull()
  })
})
