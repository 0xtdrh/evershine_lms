import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildHubs, HUBS, isKnownItem, LEGACY_ITEMS, matchesSearch } from '@/lib/navigation/sections'
import { NAV_AR } from '@/lib/i18n/nav'

describe('sidebar hubs', () => {
  it('every menu item in the layout belongs somewhere and has an Arabic name', () => {
    const src = readFileSync('app/dashboard/layout-client.tsx', 'utf8')
    const names = [...src.matchAll(/\{ name: '([^']+)',\s+href:/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(60)
    for (const n of names) {
      expect(isKnownItem(n), `${n} has no hub`).toBe(true)
      expect(NAV_AR[n], `Arabic name for ${n}`).toBeTruthy()
    }
  })
  it('about a dozen entries for an admin', () => {
    expect(HUBS.length).toBeLessThanOrEqual(13)
  })
  it('pages go into their hub in tab order; old screens only for Super Admin', () => {
    const items = [{ name: 'Refunds' }, { name: 'Fees' }, { name: 'Exams' }, { name: 'Groups' }]
    expect(buildHubs(items, 'ADMIN').map((h) => [h.key, h.items.map((i) => i.name)])).toEqual([['groups', ['Groups']], ['money', ['Fees', 'Refunds']]])
    expect(buildHubs(items, 'SUPER_ADMIN').map((h) => h.key)).toEqual(['groups', 'money', 'legacy'])
    expect(LEGACY_ITEMS.has('Timetable')).toBe(true)
  })
  it('a report is in its own hub AND in Reports', () => {
    const hubs = buildHubs([{ name: 'Attendance Report' }, { name: 'Groups' }], 'ADMIN')
    expect(hubs.map((h) => [h.key, h.items.map((i) => i.name)])).toEqual([['groups', ['Groups', 'Attendance Report']], ['reports', ['Attendance Report']]])
  })
  it('search matches English or Arabic', () => {
    expect(matchesSearch('wallet', 'Wallet & Top-ups', 'المحفظة والشحن')).toBe(true)
    expect(matchesSearch('محفظه', 'Wallet & Top-ups', 'المحفظة والشحن')).toBe(true)
    expect(matchesSearch('xyz', 'Groups', 'المجموعات')).toBe(false)
  })
})
