import { describe, expect, it } from 'vitest'
import { cleanMeetingUrl, joinWindow } from '@/lib/online/rules'

describe('joinWindow', () => {
  const start = new Date('2026-10-12T15:00:00Z')
  it('opens 10 minutes before and closes 30 minutes after the planned end', () => {
    expect(joinWindow(start, 90, new Date('2026-10-12T14:49:00Z'))).toMatchObject({ open: false, upcoming: true })
    expect(joinWindow(start, 90, new Date('2026-10-12T14:50:00Z')).open).toBe(true)
    expect(joinWindow(start, 90, new Date('2026-10-12T17:00:00Z')).open).toBe(true)
    expect(joinWindow(start, 90, new Date('2026-10-12T17:01:00Z'))).toMatchObject({ open: false, upcoming: false })
  })
  it('unknown duration = 90 minutes', () => {
    expect(joinWindow(start, null, new Date('2026-10-12T16:59:00Z')).open).toBe(true)
  })
})

describe('cleanMeetingUrl', () => {
  it('accepts https links, empty = no link', () => {
    expect(cleanMeetingUrl('https://us02web.zoom.us/j/123?pwd=x')).toMatchObject({ ok: true })
    expect(cleanMeetingUrl('  ')).toEqual({ ok: true, url: null })
  })
  it('refuses http, spaces and junk', () => {
    expect(cleanMeetingUrl('http://meet.google.com/abc').ok).toBe(false)
    expect(cleanMeetingUrl('https://meet google.com').ok).toBe(false)
    expect(cleanMeetingUrl('not a link').ok).toBe(false)
  })
})
