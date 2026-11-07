/**
 * Security part 3 (2026-11-07): the old template screens (LEGACY_ITEMS in lib/navigation/sections.ts) are kept,
 * not deleted, but only the Super Admin can open them, by link as well as from the menu. Their APIs are locked
 * the same way. Only APIs that NO active screen uses are listed here (checked 2026-11-07); APIs the active screens
 * share with the old ones (campuses, classes, class-sections, academic-years, promotions, students …) keep their own rules.
 * Pure (no imports): middleware.ts runs it at the edge.
 */

/** Old pages: exact path, or the path and everything under it. */
const PAGES_EXACT = ['/dashboard/admin']
const PAGES = [
  '/dashboard/admin/role-assumptions', '/dashboard/admin/attendance-import', '/dashboard/classes', '/dashboard/attendance/legacy',
  '/dashboard/teachers/attendance', '/dashboard/exams', '/dashboard/results', '/dashboard/report-cards', '/dashboard/promotions',
  '/dashboard/timetable', '/dashboard/queries', '/dashboard/calendar', '/dashboard/enrollment',
  '/dashboard/teacher/tasks', '/dashboard/teacher/daily-scores', '/dashboard/teacher/grade-entry', '/dashboard/teacher/grading',
  '/dashboard/teacher/targets', '/dashboard/teacher/results', '/dashboard/teacher/monthly-monitoring', '/dashboard/teacher/leaves',
]

/** APIs only the old screens call. A trailing `$` = that exact path only (its other sub-paths are used by active screens). */
export const LEGACY_APIS = [
  '/api/academic-upgrades/daily-performance', '/api/academic-upgrades/date-sheets', '/api/academic-years/rollover', '/api/academic/bootstrap', '/api/academic/migrate',
  '/api/admin/attendance/import', '/api/admin/role-assumptions', '/api/calendar', '/api/elective-groups', '/api/exam-sessions',
  '/api/exams', '/api/grading-schemes', '/api/promotions/bulk', '/api/queries', '/api/results',
  '/api/student-portal/attendance', '/api/student-portal/electives', '/api/student-portal/enrollment',
  '/api/student-portal/roll-number-slip', '/api/student-portal/targets', '/api/subject-enrollments', '/api/subject-offerings',
  '/api/teacher-portal/attendance$', '/api/teacher-portal/attendance/export', '/api/teacher-portal/monthly-monitoring', '/api/teacher-portal/result-card-config',
  '/api/teacher-portal/result-sessions', '/api/teacher-portal/results', '/api/teacher-portal/student-leaves',
  '/api/teacher-portal/targets', '/api/teacher-portal/tasks', '/api/teacher-portal/timetable-requests',
  '/api/teachers/attendance', '/api/timetable',
]

const under = (path: string, p: string) => (p.endsWith('$') ? path === p.slice(0, -1) : path === p || path.startsWith(p + '/'))

export function isLegacyPage(path: string) {
  const x = path.replace(/\/+$/, '') || '/'
  return PAGES_EXACT.includes(x) || PAGES.some((p) => under(x, p))
}
export function isLegacyApi(path: string) {
  const x = path.replace(/\/+$/, '')
  return LEGACY_APIS.some((p) => under(x, p))
}

/** What the guard does for this person and path. */
export function legacyGuard(path: string, role: string | undefined): 'OK' | 'API_LOCKED' | 'PAGE_LOCKED' {
  if (!role || role === 'SUPER_ADMIN') return 'OK' // signed-out requests: the page / route itself answers (login / 401)
  if (isLegacyApi(path)) return 'API_LOCKED'
  if (isLegacyPage(path)) return 'PAGE_LOCKED'
  return 'OK'
}
