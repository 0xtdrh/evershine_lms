import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { groupIntoSections, LEGACY_ITEMS, matchesSearch, sectionOf } from '@/lib/navigation/sections'
import { NAV_AR } from '@/lib/i18n/nav'

describe('sidebar sections (5-A)', () => {
  it('every menu item in the layout has a section and an Arabic name', () => {
    const src = readFileSync('app/dashboard/layout-client.tsx', 'utf8')
    const names = [...src.matchAll(/\{ name: '([^']+)',\s+href:/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(60)
    const known = new Set(['home', 'students', 'teaching', 'staff', 'money', 'places', 'reports', 'settings', 'legacy'])
    for (const n of names) {
      expect(known.has(sectionOf(n)), n).toBe(true)
      expect(NAV_AR[n], `Arabic name for ${n}`).toBeTruthy()
    }
  })
  it('old screens only for Super Admin, in the closed legacy section', () => {
    const items = [{ name: 'Groups' }, { name: 'Exams' }, { name: 'Fees' }]
    expect(groupIntoSections(items, 'ADMIN').map((s) => s.key)).toEqual(['teaching', 'money'])
    expect(groupIntoSections(items, 'SUPER_ADMIN').map((s) => s.key)).toEqual(['teaching', 'money', 'legacy'])
    expect(LEGACY_ITEMS.has('Timetable')).toBe(true)
  })
  it('search matches English or Arabic', () => {
    expect(matchesSearch('wallet', 'Wallet & Top-ups', 'المحفظة والشحن')).toBe(true)
    expect(matchesSearch('محفظه', 'Wallet & Top-ups', 'المحفظة والشحن')).toBe(true)
    expect(matchesSearch('xyz', 'Groups', 'المجموعات')).toBe(false)
  })
})
