/**
 * 5-C settings centre (2026-10-17): EVERY setting of TechNova, one card each, grouped. The page
 * (app/dashboard/settings-center) shows the cards the person may open; search works in English or Arabic.
 * RULE (owner 2026-10-17): a new feature with settings adds its card here (tests/hub-registries.test.ts checks
 * that every card points at a real page). `?tab=` opens the settings tab of a page (hooks/use-url-tab.ts).
 * Pure: no React, no Prisma.
 */

import type { AcademicResource as Resource, Action } from '@/lib/rbac'

export type SettingsGroup = 'company' | 'money' | 'learning' | 'students' | 'communication' | 'system'

export interface SettingCard {
  key: string
  group: SettingsGroup
  en: string
  ar: string
  descEn: string
  descAr: string
  href: string
  /** any of these roles (when given) … */
  roles?: string[]
  /** … and this permission (when given) */
  perm?: [Resource, Action]
}

export const SETTINGS_GROUPS: { key: SettingsGroup; en: string; ar: string }[] = [
  { key: 'company', en: 'Company & places', ar: 'الشركة والأماكن' },
  { key: 'money', en: 'Money', ar: 'الفلوس' },
  { key: 'learning', en: 'Learning', ar: 'التعليم' },
  { key: 'students', en: 'Students & sessions', ar: 'الطلاب والحصص' },
  { key: 'communication', en: 'Communication', ar: 'التواصل' },
  { key: 'system', en: 'System & security', ar: 'النظام والأمان' },
]

const ADMINS = ['SUPER_ADMIN', 'ADMIN']
const MANAGERS = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']
const SUPER = ['SUPER_ADMIN']

export const SETTING_CARDS: SettingCard[] = [
  // company & places
  { key: 'platform', group: 'company', en: 'Modules & language', ar: 'تشغيل الأنظمة واللغة', descEn: 'Switch LMS, passport, agreements… on or off; default language', descAr: 'تشغيل وقفل الأنظمة (المنصة، الباسبور، الموافقات…) واللغة الأساسية', href: '/dashboard/admin/platform', roles: ADMINS, perm: ['platform_settings', 'read'] },
  { key: 'setup', group: 'company', en: 'Initial setup', ar: 'الإعداد الأولي', descEn: 'Main branch, tracks and levels in one step', descAr: 'الفرع الرئيسي والتراكات والمستويات في خطوة واحدة', href: '/dashboard/admin/setup', roles: SUPER },
  { key: 'branches', group: 'company', en: 'Branches', ar: 'الفروع', descEn: 'Branch details, special prices, people of each place', descAr: 'بيانات الفروع، الأسعار الخاصة، ناس كل مكان', href: '/dashboard/campuses', roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { key: 'partners', group: 'company', en: 'Partners', ar: 'الشركاء', descEn: 'Partners, contracts (alert before the end), deals, statements', descAr: 'الشركاء والعقود (تنبيه قبل النهاية) والاتفاقات وكشوف الحساب', href: '/dashboard/partners', roles: ADMINS, perm: ['partners', 'read'] },
  { key: 'course-structure', group: 'company', en: 'Tracks, courses & levels', ar: 'التراكات والكورسات والمستويات', descEn: 'Course structure, sessions, months and prices of each level', descAr: 'هيكل الكورسات، عدد الحصص والشهور وسعر كل مستوى', href: '/dashboard/course-config', roles: MANAGERS },
  { key: 'holidays', group: 'company', en: 'Holidays', ar: 'الإجازات الرسمية', descEn: 'Branch / company days off (sessions move to the next day)', descAr: 'إجازات الفرع أو الشركة (الحصص بتتأجل لليوم اللي بعده)', href: '/dashboard/holidays', perm: ['holidays', 'read'] },

  // money
  { key: 'payments', group: 'money', en: 'Payments', ar: 'الدفع', descEn: 'Accounts shown to parents, methods, due days, receipts', descAr: 'الحسابات اللي بتظهر لأولياء الأمور، طرق الدفع، ميعاد الفاتورة، الإيصالات', href: '/dashboard/admin/finance-settings', perm: ['finance_settings', 'read'] },
  { key: 'wallet', group: 'money', en: 'Wallet', ar: 'المحفظة', descEn: 'Minimum top-up, withdrawals, online fee, promos, low balance', descAr: 'أقل شحن، السحب، رسوم الدفع أونلاين، العروض، الرصيد القليل', href: '/dashboard/wallet?tab=settings', perm: ['wallet', 'read'] },
  { key: 'discounts', group: 'money', en: 'Discounts', ar: 'الخصومات', descEn: 'Discount types and rules (stacking, siblings, early renewal, birthday)', descAr: 'أنواع الخصومات وقواعدها (الجمع، الإخوات، التجديد المبكر، عيد الميلاد)', href: '/dashboard/discounts?tab=rules', perm: ['discounts', 'read'] },
  { key: 'refunds', group: 'money', en: 'Refund rules', ar: 'قواعد الاسترداد', descEn: 'Allowed or not, admin fee — per company, branch, track or level', descAr: 'مسموح ولا لأ، والرسوم الإدارية — للشركة أو الفرع أو التراك أو المستوى', href: '/dashboard/refunds?tab=rules', perm: ['refunds', 'approve'] },
  { key: 'referrals', group: 'money', en: 'Referrals', ar: 'الإحالة', descEn: 'Wallet reward, welcome discount, ambassador badge', descAr: 'مكافأة المحفظة، خصم الترحيب، شارة السفير', href: '/dashboard/referrals', perm: ['referrals', 'read'] },

  // learning
  { key: 'lms', group: 'learning', en: 'Learning platform', ar: 'المنصة التعليمية', descEn: 'How lessons open, homework rules, tools, watermark, kid mode', descAr: 'إزاي الدروس بتفتح، قواعد الواجبات، الأدوات، العلامة المائية، وضع الأطفال', href: '/dashboard/admin/lms', perm: ['curriculum', 'read'] },
  { key: 'curriculum', group: 'learning', en: 'Curriculum', ar: 'المنهج', descEn: 'Lessons for every level (versions, review, publish)', descAr: 'دروس كل مستوى (نسخ، مراجعة، نشر)', href: '/dashboard/curriculum', perm: ['curriculum', 'read'] },
  { key: 'question-bank', group: 'learning', en: 'Question bank', ar: 'بنك الأسئلة', descEn: 'Questions per course / level for quizzes', descAr: 'أسئلة كل كورس / مستوى للكويزات', href: '/dashboard/question-bank', perm: ['curriculum', 'read'] },
  { key: 'rubrics', group: 'learning', en: 'Rubrics', ar: 'جداول التصحيح', descEn: 'Reusable grading tables for homework', descAr: 'جداول تصحيح جاهزة للواجبات', href: '/dashboard/admin/rubrics', perm: ['curriculum', 'read'] },
  { key: 'grading', group: 'learning', en: 'Grading weights', ar: 'أوزان التقييم', descEn: 'Homework / task / MCQ / project weights and the pass mark', descAr: 'نسبة الواجب والمهام والامتحان والمشروع ودرجة النجاح', href: '/dashboard/grading-config', roles: MANAGERS },
  { key: 'session-reports', group: 'learning', en: 'Session reports', ar: 'تقارير الحصص', descEn: 'On / off, when they are sent, what parents see', descAr: 'تشغيل وقفل، إمتى بتتبعت، وإيه اللي ولي الأمر يشوفه', href: '/dashboard/session-reports?tab=settings', perm: ['session_reports', 'read'] },
  { key: 'passport', group: 'learning', en: 'Passport & profile', ar: 'الباسبور والبروفايل', descEn: 'Stamps library, share links, profile options', descAr: 'مكتبة الأختام، روابط المشاركة، إعدادات البروفايل', href: '/dashboard/admin/passport?tab=settings', perm: ['passport', 'update'] },
  { key: 'certificates', group: 'learning', en: 'Certificate designer', ar: 'تصميم الشهادات', descEn: 'Certificate templates and where each field goes', descAr: 'قوالب الشهادات ومكان كل بيان عليها', href: '/dashboard/certificate-templates', roles: ADMINS },
  { key: 'instructor-performance', group: 'learning', en: 'Instructor performance', ar: 'أداء المدربين', descEn: 'Whether instructors may see their own score', descAr: 'المدرب يشوف تقييمه ولا لأ', href: '/dashboard/teacher-performance', roles: ADMINS },

  // students & sessions
  { key: 'excuses', group: 'students', en: 'Absence excuses', ar: 'أعذار الغياب', descEn: 'Automatic or approval, days allowed after the session', descAr: 'تلقائي ولا بموافقة، وكام يوم بعد الحصة', href: '/dashboard/absence-excuses?tab=settings', perm: ['absence_excuses', 'read'] },
  { key: 'renewals', group: 'students', en: 'Renewals', ar: 'التجديد', descEn: 'When parents are asked "continuing next month?"', descAr: 'إمتى ولي الأمر يتسأل «مكمّل الشهر الجاي؟»', href: '/dashboard/renewals', perm: ['renewals', 'read'] },
  { key: 'agreements', group: 'students', en: 'Agreements & group rules', ar: 'الموافقات وقواعد الجروبات', descEn: 'Policies parents accept, public policy pages, written group rules', descAr: 'السياسات اللي ولي الأمر بيوافق عليها، صفحات السياسات، قواعد الجروبات', href: '/dashboard/admin/agreements', perm: ['agreements', 'read'] },

  // communication
  { key: 'notifications', group: 'communication', en: 'Notifications', ar: 'الإشعارات', descEn: 'Turn each notification on or off', descAr: 'تشغيل وقفل كل إشعار', href: '/dashboard/admin/notifications', roles: ADMINS },
  { key: 'announcements', group: 'communication', en: 'Announcements', ar: 'الإعلانات', descEn: 'Instructors may send to their groups, ask "I read it" by default (who needs approval = Permissions)', descAr: 'المدرب يبعت لجروباته، «لازم يأكّد إنه قرأ» افتراضيًا (مين محتاج موافقة = الصلاحيات)', href: '/dashboard/announcements?tab=settings', roles: ['SUPER_ADMIN', 'ADMIN'], perm: ['announcements', 'approve'] },
  { key: 'complaints', group: 'communication', en: 'Complaints', ar: 'الشكاوى', descEn: 'Reply deadline, auto-close after solved', descAr: 'ميعاد الرد، والقفل التلقائي بعد الحل', href: '/dashboard/complaints?tab=report', perm: ['complaints', 'export'] },

  // system & security
  { key: 'appearance', group: 'system', en: 'Appearance', ar: 'المظهر', descEn: 'Light / dark and the dark-mode colours (for you)', descAr: 'فاتح / غامق وألوان الوضع الغامق (ليك أنت)', href: '/dashboard/settings#appearance' },
  { key: 'permissions', group: 'system', en: 'Permissions', ar: 'الصلاحيات', descEn: 'What each role can do (+ per person / per place)', descAr: 'كل دور يقدر يعمل إيه (+ لكل شخص / لكل مكان)', href: '/dashboard/admin/permissions', roles: SUPER },
  { key: 'accounts', group: 'system', en: 'Accounts & passwords', ar: 'الحسابات وكلمات السر', descEn: 'Staff accounts, places, reset passwords, personal permissions', descAr: 'حسابات الموظفين، أماكنهم، تغيير كلمة السر، صلاحيات شخصية', href: '/dashboard/admin/credential-management', roles: SUPER },
  { key: 'login-locks', group: 'system', en: 'Login locks', ar: 'قفل الدخول', descEn: 'Unlock accounts after wrong passwords', descAr: 'فتح الحسابات المقفولة بعد كلمة سر غلط', href: '/dashboard/admin/login-locks', roles: SUPER },
  { key: 'backups', group: 'system', en: 'Backups', ar: 'النسخ الاحتياطي', descEn: 'Daily backups and downloads', descAr: 'النسخ اليومية والتنزيل', href: '/dashboard/admin/backups', roles: SUPER },
  { key: 'wipe', group: 'system', en: 'Delete test data', ar: 'مسح بيانات التجربة', descEn: 'One-time cleanup before going live (backs up first)', descAr: 'تنضيف مرة واحدة قبل التشغيل (بياخد نسخة الأول)', href: '/dashboard/admin/wipe-test-data', roles: SUPER },
]

/** Cards a person may open (roles AND permission; the permission check is passed in so overrides apply). */
export function visibleCards<T extends { roles?: string[]; perm?: [Resource, Action] }>(cards: T[], role: string, can: (r: Resource, a: Action) => boolean): T[] {
  return cards.filter((c) => (!c.roles || c.roles.includes(role)) && (!c.perm || can(c.perm[0], c.perm[1])))
}

/** Search in the English / Arabic name and description (Arabic letters normalised a little). */
export function matchesCard(q: string, c: { en: string; ar: string; descEn: string; descAr: string }): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
  const n = norm(q)
  return !n || [c.en, c.ar, c.descEn, c.descAr].some((x) => norm(x).includes(n))
}
