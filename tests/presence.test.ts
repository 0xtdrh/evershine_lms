import { describe, expect, it } from 'vitest'
import { presenceFields, presenceText } from '@/lib/attendance/presence'

describe('attendance detail (a02 batch 5)', () => {
  it('online minutes below 70 % make a present student "partial"; enough minutes = plain present', () => {
    expect(presenceFields({ status: 'PRESENT', mode: 'ONLINE', minutes: 40, sessionMinutes: 90 })).toEqual({ mode: 'ONLINE', presenceDetail: 'PARTIAL', minutes: 40 })
    expect(presenceFields({ status: 'PRESENT', mode: 'ONLINE', minutes: 70, sessionMinutes: 90 })).toEqual({ mode: 'ONLINE', presenceDetail: null, minutes: 70 })
  })
  it('camera off is kept online; details that do not fit the way are dropped', () => {
    expect(presenceFields({ status: 'PRESENT', mode: 'ONLINE', detail: 'CAMERA_OFF', sessionMinutes: 90 }).presenceDetail).toBe('CAMERA_OFF')
    expect(presenceFields({ status: 'PRESENT', mode: 'BRANCH', detail: 'CAMERA_OFF', minutes: 30, sessionMinutes: 90 })).toEqual({ mode: 'BRANCH', presenceDetail: null, minutes: null })
    expect(presenceFields({ status: 'ABSENT', mode: 'ONLINE', detail: 'PARTIAL', sessionMinutes: 90 }).presenceDetail).toBeNull()
  })
  it('a recorded session marked present = watched', () => {
    expect(presenceFields({ status: 'PRESENT', mode: 'RECORDED', sessionMinutes: 90 }).presenceDetail).toBe('WATCHED')
  })
  it('words for families', () => {
    expect(presenceText('PRESENT', 'ONLINE', 'PARTIAL', 'ar')).toBe('حضر أونلاين — حضور جزئي')
    expect(presenceText('PRESENT', 'BRANCH', null, 'en')).toBeNull()
    expect(presenceText('ABSENT', 'ONLINE', null, 'en')).toBeNull()
  })
})
