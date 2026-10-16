/**
 * Screen re-organisation 5-A (2026-10-16): the sidebar sections and which menu item goes where.
 * Keys = the English item names in app/dashboard/layout-client.tsx. Items in LEGACY are old template screens: they are
 * hidden from everyone except Super Admin (closed "Old screens" section) — not deleted. Pure, tested in tests/nav-sections.test.ts.
 */

export const SECTIONS = ['home', 'students', 'teaching', 'staff', 'money', 'places', 'reports', 'settings', 'legacy'] as const
export type SectionKey = (typeof SECTIONS)[number]

export const SECTION_LABELS: Record<SectionKey, { en: string; ar: string }> = {
  home: { en: 'Home', ar: 'الرئيسية' },
  students: { en: 'Students & admissions', ar: 'الطلاب والتسجيل' },
  teaching: { en: 'Groups & learning', ar: 'الجروبات والتعليم' },
  staff: { en: 'Instructors & staff', ar: 'المدربين والموظفين' },
  money: { en: 'Money', ar: 'الفلوس' },
  places: { en: 'Branches & partners', ar: 'الفروع والشركاء' },
  reports: { en: 'Reports', ar: 'التقارير' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  legacy: { en: 'Old screens', ar: 'شاشات قديمة' },
}

/** Old template screens (replaced by newer TechNova screens) — Super Admin only, never deleted here. */
export const LEGACY_ITEMS = new Set([
  'Admin Workspace', 'Role Assumptions', 'Classes (Legacy)', 'Class Attendance (Legacy)', 'Exams', 'Results', 'Report Cards', 'Promotions',
  'Timetable', 'Academic Engine', 'Academic Queries', 'Calendar', 'My Courses', 'Staff Attendance', 'Biometric Import',
  'Tasks & Marks', 'Daily Scores', 'Grade Entry', 'Student Targets', 'Exam Results', 'Monthly Monitoring', 'Student Leaves',
])

const ITEM_SECTION: Record<string, SectionKey> = {
  // home
  'Dashboard': 'home', 'My Calendar': 'home', 'My Schedule': 'home', 'My Substitutions': 'home',
  'My Children': 'home', 'My Learning': 'home', 'My Passport': 'home', 'My Profile': 'home', 'Certificates': 'home',
  // students & admissions
  'Admissions': 'students', 'Landing Leads': 'students', 'Students': 'students', 'Waiting List': 'students', 'Follow-ups': 'students',
  'Renewals': 'students', 'Absence Excuses': 'students', 'Complaints': 'students', 'Referrals': 'students', 'Birthdays': 'students',
  // groups & learning
  'Groups': 'teaching', 'Groups Schedule': 'teaching', 'Attendance': 'teaching', 'Holidays': 'teaching', 'LMS': 'teaching',
  'Passport & Stamps': 'teaching', 'Session Reports': 'teaching', 'Course Structure': 'teaching', 'Grading Weights': 'teaching',
  'Certificate Designer': 'teaching', 'Certificate Reveal': 'teaching', 'Documents': 'teaching', 'Announcements': 'teaching',
  'My Students': 'teaching', 'Student Attendance': 'teaching', 'Import Attendance': 'teaching', 'My Announcements': 'teaching', 'Level Results': 'teaching',
  // instructors & staff
  'Staff Directory': 'staff', 'Absence Requests': 'staff', 'Leaves': 'staff', 'Staff Salaries': 'staff', 'HR & Salary': 'staff',
  // money
  'Fees': 'money', 'Accounting Hub': 'money', 'Fee Collection': 'money', 'Wallet & Top-ups': 'money', 'Discounts': 'money',
  'Refunds': 'money', 'Expense Ledger': 'money', 'Financial Reports': 'money',
  // branches & partners
  'Campuses': 'places', 'Partners': 'places',
  // reports
  'Attendance Report': 'reports', 'Groups Financials': 'reports', 'Substitute Reconciliation': 'reports', 'Instructor Performance': 'reports', 'Ratings': 'reports',
  // settings
  'Settings Centre': 'settings', 'Platform': 'settings', 'Agreements': 'settings', 'Notifications': 'settings', 'Permissions': 'settings',
  'Credential Management': 'settings', 'Backups': 'settings', 'Settings': 'settings',
}

export function sectionOf(name: string): SectionKey {
  if (LEGACY_ITEMS.has(name)) return 'legacy'
  return ITEM_SECTION[name] ?? 'home'
}

/** Groups items into sections in the fixed order; legacy only for Super Admin. Small menus (the portal) stay flat. */
export function groupIntoSections<T extends { name: string }>(items: T[], role: string): { key: SectionKey; items: T[] }[] {
  const visible = items.filter((i) => !LEGACY_ITEMS.has(i.name) || role === 'SUPER_ADMIN')
  return SECTIONS.map((key) => ({ key, items: visible.filter((i) => sectionOf(i.name) === key) })).filter((s) => s.items.length > 0)
}

/** Menu search: matches the English or Arabic name (case-insensitive, Arabic letters normalised a little). */
export function matchesSearch(q: string, en: string, ar: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
  const n = norm(q)
  return !n || norm(en).includes(n) || norm(ar).includes(n)
}
