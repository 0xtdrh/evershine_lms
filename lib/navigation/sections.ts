/**
 * Screen re-organisation (2026-10-16): the sidebar has ~13 entries ("hubs"); each opens its first page, and the pages
 * of a hub show as tabs on top of the page (components/layout/HubTabs.tsx). Keys = the English item names in
 * app/dashboard/layout-client.tsx. LEGACY = old template screens, Super Admin only ("Old screens") — not deleted.
 * A page may be in more than one hub (e.g. a report: in its own hub AND in Reports); hubOf = the first one.
 * Pure, tested in tests/nav-sections.test.ts.
 */

export const HUB_KEYS = ['home', 'admissions', 'students', 'groups', 'learning', 'certificates', 'staff', 'money', 'communication', 'places', 'reports', 'settings', 'legacy'] as const
export type HubKey = (typeof HUB_KEYS)[number]

/** Each hub and its pages, in tab order. */
export const HUBS: { key: HubKey; en: string; ar: string; items: string[] }[] = [
  { key: 'home', en: 'Home', ar: 'الرئيسية', items: ['Dashboard', 'My Calendar', 'My Schedule', 'My Substitutions', 'User Guide'] },
  { key: 'admissions', en: 'Admissions', ar: 'التسجيل', items: ['Admissions', 'Landing Leads'] },
  { key: 'students', en: 'Students', ar: 'الطلاب', items: ['Students', 'My Students', 'Waiting List', 'Follow-ups', 'Renewals', 'Absence Excuses', 'Birthdays'] },
  { key: 'groups', en: 'Groups', ar: 'الجروبات', items: ['Groups', 'Groups Schedule', 'Attendance', 'Student Attendance', 'Import Attendance', 'Holidays', 'Attendance Report'] },
  { key: 'learning', en: 'Learning', ar: 'التعليم', items: ['LMS', 'Level Results', 'LMS Results', 'Passport & Stamps', 'Session Reports', 'Course Structure', 'Grading Weights'] },
  { key: 'certificates', en: 'Certificates & documents', ar: 'الشهادات والمستندات', items: ['ID Cards', 'Certificate Designer', 'Certificate Reveal', 'Documents'] },
  { key: 'staff', en: 'Instructors & staff', ar: 'المدربين والموظفين', items: ['Staff Directory', 'Absence Requests', 'Leaves', 'Staff Salaries', 'HR & Salary', 'Instructor Performance', 'Substitute Reconciliation'] },
  { key: 'money', en: 'Money', ar: 'الفلوس', items: ['Accounting Hub', 'Fees', 'Fee Collection', 'Accounts & Cash', 'Fees & Charges', 'Wallet & Top-ups', 'Discounts', 'Refunds', 'Expense Ledger', 'Month Close', 'Financial Reports', 'Groups Financials'] },
  { key: 'communication', en: 'Communication', ar: 'التواصل', items: ['Announcements', 'My Announcements', 'Complaints', 'Referrals', 'Ratings'] },
  { key: 'places', en: 'Branches & partners', ar: 'الفروع والشركاء', items: ['Campuses', 'Partners'] },
  { key: 'reports', en: 'Reports', ar: 'التقارير', items: ['Reports Centre', 'Usage', 'Import & Export', 'Attendance Report', 'Groups Financials', 'Financial Reports', 'Month Close', 'Instructor Performance', 'Substitute Reconciliation', 'Ratings'] },
  { key: 'settings', en: 'Settings', ar: 'الإعدادات', items: ['Settings Centre', 'Import & Export', 'Platform', 'Agreements', 'Notifications', 'Permissions', 'Credential Management', 'Backups', 'Change Log', 'Data Health', 'Settings'] },
]

/** Old template screens (replaced by newer TechNova screens) — Super Admin only, never deleted here. */
export const LEGACY_ITEMS = new Set([
  'Admin Workspace', 'Role Assumptions', 'Classes (Legacy)', 'Class Attendance (Legacy)', 'Exams', 'Results', 'Report Cards', 'Promotions',
  'Timetable', 'Academic Engine', 'Academic Queries', 'Calendar', 'My Courses', 'Staff Attendance', 'Biometric Import',
  'Tasks & Marks', 'Daily Scores', 'Grade Entry', 'Student Targets', 'Exam Results', 'Monthly Monitoring', 'Student Leaves',
])

export const LEGACY_HUB = { key: 'legacy' as HubKey, en: 'Old screens', ar: 'شاشات قديمة' }

/** Portal pages (parents / students): they keep a short flat menu. */
const PORTAL_ITEMS = new Set(['User Guide', 'My Children', 'My Learning', 'My Passport', 'My Profile', 'Certificates'])

export function hubOf(name: string): HubKey {
  if (LEGACY_ITEMS.has(name)) return 'legacy'
  return HUBS.find((h) => h.items.includes(name))?.key ?? 'home'
}
export const isKnownItem = (name: string) => LEGACY_ITEMS.has(name) || PORTAL_ITEMS.has(name) || HUBS.some((h) => h.items.includes(name))

export function hubLabel(key: HubKey, ar: boolean) {
  const h = key === 'legacy' ? LEGACY_HUB : HUBS.find((x) => x.key === key)!
  return ar ? h.ar : h.en
}

/** The hubs a person sees, each with their visible pages in tab order; old screens only for Super Admin. */
export function buildHubs<T extends { name: string }>(items: T[], role: string): { key: HubKey; items: T[] }[] {
  const visible = items.filter((i) => !LEGACY_ITEMS.has(i.name) || role === 'SUPER_ADMIN')
  const order = (key: HubKey, name: string) => (HUBS.find((h) => h.key === key)?.items.indexOf(name) ?? 99)
  return [...HUB_KEYS]
    .map((key) => ({
      key,
      items: visible
        .filter((i) => (key === 'legacy' ? LEGACY_ITEMS.has(i.name) : !LEGACY_ITEMS.has(i.name) && (HUBS.find((h) => h.key === key)?.items.includes(i.name) || (key === 'home' && !HUBS.some((h) => h.items.includes(i.name))))))
        .sort((a, b) => order(key, a.name) - order(key, b.name)),
    }))
    .filter((h) => h.items.length > 0)
}

/** Menu search: matches the English or Arabic name (case-insensitive, Arabic letters normalised a little). */
export function matchesSearch(q: string, en: string, ar: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
  const n = norm(q)
  return !n || norm(en).includes(n) || norm(ar).includes(n)
}
