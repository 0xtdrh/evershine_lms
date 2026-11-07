import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { browserProtectionHeaders, cspPolicy, readCspReports } from '@/lib/security/csp'
import { isLegacyApi, isLegacyPage, legacyGuard, LEGACY_APIS } from '@/lib/security/legacy'
import { SETTING_CARDS } from '@/lib/settings/registry'
import { REPORT_CARDS } from '@/lib/reports/registry'

describe('browser protection', () => {
  it('watch mode by default, blocks only with CSP_ENFORCE=1', () => {
    const watch = browserProtectionHeaders({})
    expect(watch.map((h) => h.key)).toContain('Content-Security-Policy-Report-Only')
    expect(watch.find((h) => h.key === 'Strict-Transport-Security')?.value).toContain('max-age=63072000')
    expect(browserProtectionHeaders({ CSP_ENFORCE: '1' }).map((h) => h.key)).toContain('Content-Security-Policy')
  })
  it('the policy allows what the screens use and nothing loose for scripts', () => {
    const p = cspPolicy(false)
    expect(p).toContain("object-src 'none'")
    expect(p).toContain('https://cdn.jsdelivr.net') // ffmpeg + pyodide
    expect(p).toContain('connect-src \'self\' https://api.cloudinary.com')
    expect(p).not.toContain("'unsafe-eval'")
    expect(cspPolicy(true)).toContain("'unsafe-eval'") // only next dev
    expect(p).toContain('report-uri /api/security/csp-report')
  })
  it('reads both report formats and keeps only the place (no query strings / tokens)', () => {
    const old = readCspReports({ 'csp-report': { 'document-uri': 'https://x.app/dashboard/students/clxabcdefghijklmnopqrstu?tab=1', 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/a.js?token=secret' } })
    expect(old).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example', page: '/dashboard/students/[id]' }])
    const neu = readCspReports([{ type: 'csp-violation', body: { documentURL: 'https://x.app/login', effectiveDirective: 'script-src', blockedURL: 'inline' } }, { type: 'deprecation', body: {} }])
    expect(neu).toEqual([{ directive: 'script-src', blocked: 'inline', page: '/login' }])
    expect(readCspReports('junk')).toEqual([])
    expect(readCspReports(Array(50).fill({ type: 'csp-violation', body: { effectiveDirective: 'img-src', documentURL: 'https://x/a' } })).length).toBe(20)
  })
})

describe('old template screens: Super Admin only', () => {
  it('locks old pages and APIs for everyone but the Super Admin', () => {
    expect(legacyGuard('/api/timetable/slots', 'ADMIN')).toBe('API_LOCKED')
    expect(legacyGuard('/api/exams/abc', 'TEACHER')).toBe('API_LOCKED')
    expect(legacyGuard('/api/teacher-portal/attendance', 'TEACHER')).toBe('API_LOCKED')
    expect(legacyGuard('/dashboard/teacher/grade-entry', 'TEACHER')).toBe('PAGE_LOCKED')
    expect(legacyGuard('/dashboard/admin', 'ADMIN')).toBe('PAGE_LOCKED')
    expect(legacyGuard('/dashboard/timetable', 'SUPER_ADMIN')).toBe('OK')
    expect(legacyGuard('/api/exams', undefined)).toBe('OK') // signed out: the route says 401
  })
  it('never locks the active screens or shared APIs', () => {
    for (const p of ['/dashboard/admin/security', '/dashboard/admin/notifications', '/dashboard/teacher', '/dashboard/teacher/level-results', '/dashboard/schedule', '/dashboard/learning', '/dashboard/results-x'])
      expect(isLegacyPage(p), p).toBe(false)
    for (const a of ['/api/class-sections', '/api/academic-years', '/api/campuses', '/api/classes', '/api/promotions', '/api/promotions/suggest', '/api/teacher-portal/sections', '/api/teacher-portal/subject-offerings', '/api/teachers/for-selection', '/api/level-results', '/api/student-portal/results', '/api/academic/x', '/api/groups/schedule', '/api/enrollment-attendance/roster', '/api/rooms/settings', '/api/academic-upgrades/results', '/api/teacher-portal/attendance/import/student', '/api/admin/attendance/templates/student'])
      expect(isLegacyApi(a), a).toBe(false)
  })
  it('no active screen calls a locked API', () => {
    const legacyDirs = ['admin/role-assumptions', 'admin/attendance-import', 'classes', 'attendance/legacy', 'academic', 'teachers/attendance', 'exams', 'results', 'report-cards', 'promotions', 'timetable', 'queries', 'calendar', 'enrollment', 'teacher/tasks', 'teacher/daily-scores', 'teacher/grade-entry', 'teacher/grading', 'teacher/targets', 'teacher/results', 'teacher/monthly-monitoring', 'teacher/leaves'].map((d) => path.join('app', 'dashboard', d) + path.sep)
    const bad: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name)
        if (f.isDirectory()) { if (p !== path.join('app', 'api')) walk(p); continue }
        if (!/\.tsx?$/.test(f.name) || legacyDirs.some((d) => p.startsWith(d)) || p === path.join('app', 'dashboard', 'admin', 'page.tsx')) continue
        const t = fs.readFileSync(p, 'utf8')
        for (const m of t.matchAll(/['"`](\/api\/[a-zA-Z0-9\-/]+)/g)) if (isLegacyApi(m[1].replace(/\/$/, ''))) bad.push(`${p}: ${m[1]}`)
      }
    }
    for (const r of ['app', 'components', 'hooks']) walk(r)
    expect(bad).toEqual([])
    expect(LEGACY_APIS.length).toBeGreaterThan(20)
  })
  it('no settings or report card points at a locked page', () => {
    const hrefs = [...SETTING_CARDS, ...REPORT_CARDS].map((c) => (c as { href: string }).href.split('?')[0])
    expect(hrefs.filter(isLegacyPage)).toEqual([])
  })
})
