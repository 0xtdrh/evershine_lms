import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkPermission } from '@/lib/rbac'
import { SETTING_CARDS, SETTINGS_GROUPS, matchesCard, visibleCards } from '@/lib/settings/registry'
import { REPORT_CARDS, REPORT_GROUPS } from '@/lib/reports/registry'
import { TASKS, TASK_KEYS, tasksFor } from '@/lib/today/catalog'

/** "/dashboard/wallet?tab=settings#x" → app/dashboard/wallet/page.tsx exists */
const pageExists = (href: string) => existsSync(join('app', href.split(/[?#]/)[0], 'page.tsx'))

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (f === 'route.ts') out.push(p.replace(/\\/g, '/'))
  }
  return out
}

describe('settings centre / reports centre / today (5-C)', () => {
  for (const [name, cards, groups] of [['settings', SETTING_CARDS, SETTINGS_GROUPS], ['reports', REPORT_CARDS, REPORT_GROUPS]] as const) {
    it(`${name}: every card opens a real page, has Arabic, a known group and a unique key`, () => {
      const keys = new Set<string>()
      for (const c of cards) {
        expect(pageExists(c.href), `${c.key} → ${c.href}`).toBe(true)
        expect(c.ar && c.descAr, `${c.key} Arabic`).toBeTruthy()
        expect(groups.some((g) => g.key === c.group), `${c.key} group`).toBe(true)
        expect(keys.has(c.key), `${c.key} twice`).toBe(false)
        keys.add(c.key)
      }
    })
  }

  it('every settings API has a card in the settings centre (owner rule: one system)', () => {
    // API folder → a piece of the card href that manages it. A NEW settings API must be added here AND get a card.
    const API_TO_CARD: Record<string, string> = {
      'app/api/admin/finance-settings/route.ts': '/dashboard/admin/finance-settings',
      'app/api/announcements/settings/route.ts': '/dashboard/announcements',
      'app/api/lessons/settings/route.ts': '/dashboard/admin/lms',
      'app/api/notifications/settings/route.ts': '/dashboard/admin/notifications',
      'app/api/passport/settings/route.ts': '/dashboard/admin/passport',
      'app/api/platform/settings/route.ts': '/dashboard/admin/platform',
      'app/api/profile/settings/route.ts': '/dashboard/admin/passport',
      'app/api/referrals/settings/route.ts': '/dashboard/referrals',
      'app/api/renewals/settings/route.ts': '/dashboard/renewals',
      'app/api/session-reports/settings/route.ts': '/dashboard/session-reports',
      'app/api/teachers/performance/settings/route.ts': '/dashboard/teacher-performance',
      'app/api/wallet/settings/route.ts': '/dashboard/wallet',
    }
    const apis = walk('app/api').filter((p) => /\/settings\/route\.ts$|-settings\/route\.ts$/.test(p))
    for (const api of apis) {
      const href = API_TO_CARD[api]
      expect(href, `${api} has no settings-centre card (add one to lib/settings/registry.ts and map it here)`).toBeTruthy()
      expect(SETTING_CARDS.some((c) => c.href.startsWith(href)), `${api} → card ${href}`).toBe(true)
    }
  })

  it('cards follow roles and permissions', () => {
    const can = (role: string) => (r: Parameters<typeof checkPermission>[1], a: Parameters<typeof checkPermission>[2]) => checkPermission(role, r, a)
    const sa = visibleCards(SETTING_CARDS, 'SUPER_ADMIN', can('SUPER_ADMIN')).map((c) => c.key)
    const sec = visibleCards(SETTING_CARDS, 'SECRETARY', can('SECRETARY')).map((c) => c.key)
    expect(sa).toContain('backups')
    expect(sec).not.toContain('backups')
    expect(sec).not.toContain('permissions')
    expect(visibleCards(REPORT_CARDS, 'SECRETARY', can('SECRETARY')).map((c) => c.key)).not.toContain('financial')
  })

  it('search works in Arabic and English', () => {
    const wallet = SETTING_CARDS.find((c) => c.key === 'wallet')!
    expect(matchesCard('محفظه', wallet)).toBe(true)
    expect(matchesCard('top-up', wallet)).toBe(true)
    expect(matchesCard('xyz', wallet)).toBe(false)
  })

  it('today: one definition per task key, real pages, Arabic', () => {
    expect(TASKS.map((t) => t.key).sort()).toEqual([...TASK_KEYS].sort())
    for (const t of TASKS) {
      expect(pageExists(t.href), `${t.key} → ${t.href}`).toBe(true)
      expect(t.ar, `${t.key} Arabic`).toBeTruthy()
    }
  })

  it('today: each role gets its own jobs', () => {
    const keys = (role: string) => tasksFor(role, (r, a) => checkPermission(role, r, a)).map((t) => t.key)
    expect(keys('TEACHER')).toEqual(expect.arrayContaining(['mySessionsToday', 'myMissingAttendance', 'homeworkToGrade', 'substituteRequests']))
    expect(keys('TEACHER')).not.toContain('refunds')
    expect(keys('SECRETARY')).toEqual(expect.arrayContaining(['followUps', 'excuses', 'admissions']))
    expect(keys('SECRETARY')).not.toContain('refunds') // secretaries cannot approve refunds
    expect(keys('ACCOUNTANT')).toEqual(expect.arrayContaining(['topUps', 'withdrawals', 'proofs']))
    expect(keys('ACCOUNTANT')).not.toContain('partnerStatements') // accountants cannot approve statements
    expect(keys('BRANCH_MANAGER')).toEqual(expect.arrayContaining(['refunds', 'complaintsLate', 'groupsToAdvance', 'noSubstitute']))
  })
})
