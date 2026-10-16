/**
 * 5-C reports centre (2026-10-17): EVERY report / export of TechNova, one card each, grouped
 * (app/dashboard/reports-center). Reports that live inside a page (complaints month, discounts, LMS analytics…)
 * are linked with `?tab=` (hooks/use-url-tab.ts). RULE (owner 2026-10-17): a new feature with a report or an
 * export adds its card here; tests/hub-registries.test.ts checks every card points at a real page.
 * Pure: no React, no Prisma. Shares visibleCards / matchesCard with the settings centre.
 */

import type { AcademicResource as Resource, Action } from '@/lib/rbac'

export type ReportGroup = 'students' | 'money' | 'staff' | 'learning' | 'partners' | 'communication'

export interface ReportCard {
  key: string
  group: ReportGroup
  en: string
  ar: string
  descEn: string
  descAr: string
  href: string
  /** what you can take out of it */
  formats?: ('excel' | 'pdf' | 'print')[]
  roles?: string[]
  perm?: [Resource, Action]
}

export const REPORT_GROUPS: { key: ReportGroup; en: string; ar: string }[] = [
  { key: 'students', en: 'Students & attendance', ar: 'الطلاب والحضور' },
  { key: 'money', en: 'Money', ar: 'الفلوس' },
  { key: 'staff', en: 'Instructors & staff', ar: 'المدربين والموظفين' },
  { key: 'learning', en: 'Learning', ar: 'التعليم' },
  { key: 'partners', en: 'Partners', ar: 'الشركاء' },
  { key: 'communication', en: 'Communication & families', ar: 'التواصل وأولياء الأمور' },
]

const MANAGERS = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']
const OFFICE = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY']
const ADMINS = ['SUPER_ADMIN', 'ADMIN']

export const REPORT_CARDS: ReportCard[] = [
  // students & attendance
  { key: 'attendance', group: 'students', en: 'Attendance report', ar: 'تقرير الحضور', descEn: 'Attendance per group, student and month', descAr: 'الحضور لكل جروب وطالب وشهر', href: '/dashboard/reports/attendance', formats: ['excel', 'print'], roles: OFFICE },
  { key: 'students', group: 'students', en: 'Students list', ar: 'قايمة الطلاب', descEn: 'All students with filters, to Excel', descAr: 'كل الطلاب بالفلاتر، وتصدير Excel', href: '/dashboard/students', formats: ['excel'], roles: [...OFFICE, 'ACCOUNTANT'], perm: ['students', 'read'] },
  { key: 'student-reports', group: 'students', en: 'Student monthly / level reports', ar: 'تقارير الطالب الشهرية والمستوى', descEn: 'Open a student → Reports (printable, sent to parents)', descAr: 'افتح الطالب ← التقارير (بتتطبع وبتتبعت لولي الأمر)', href: '/dashboard/students', formats: ['print'], roles: [...OFFICE, 'ACCOUNTANT'], perm: ['students', 'read'] },
  { key: 'admissions', group: 'students', en: 'Admissions & leads', ar: 'طلبات التسجيل والعملاء المحتملين', descEn: 'New applications and website leads, to Excel', descAr: 'طلبات التسجيل وعملاء الموقع، وتصدير Excel', href: '/dashboard/leads', formats: ['excel'], roles: [...OFFICE, 'MARKETING'], perm: ['admissions', 'read'] },
  { key: 'waiting-list', group: 'students', en: 'Waiting list', ar: 'قايمة الانتظار', descEn: 'Who is waiting for which level / group, who finished and did not continue', descAr: 'مين مستني أنهي مستوى / جروب، ومين خلّص ومكمّلش', href: '/dashboard/waiting-list', roles: OFFICE, perm: ['waiting_list', 'read'] },
  { key: 'renewals', group: 'students', en: 'Renewals & churn', ar: 'التجديد وأسباب الترك', descEn: 'Who continues next month and why students leave', descAr: 'مين مكمّل الشهر الجاي وليه الطلاب بتمشي', href: '/dashboard/renewals', roles: [...OFFICE, 'ACCOUNTANT'], perm: ['renewals', 'read'] },
  { key: 'excuses', group: 'students', en: 'Absence excuses', ar: 'أعذار الغياب', descEn: 'Excuses sent by parents and what was decided', descAr: 'الأعذار اللي أولياء الأمور بعتوها واتعمل فيها إيه', href: '/dashboard/absence-excuses', roles: [...OFFICE, 'ACCOUNTANT', 'TEACHER'], perm: ['absence_excuses', 'read'] },
  { key: 'birthdays', group: 'students', en: 'Birthdays', ar: 'أعياد الميلاد', descEn: 'Birthdays today and this month', descAr: 'أعياد الميلاد النهارده والشهر ده', href: '/dashboard/birthdays', perm: ['birthdays', 'read'] },

  // money
  { key: 'financial', group: 'money', en: 'Financial reports (profit & loss)', ar: 'التقارير المالية (الأرباح والخسائر)', descEn: 'Income, refunds, expenses and profit per month / place', descAr: 'الدخل والاسترداد والمصاريف والربح لكل شهر / مكان', href: '/dashboard/accountant/reports', formats: ['excel', 'print'], roles: [...MANAGERS, 'ACCOUNTANT'], perm: ['financial_reports', 'read'] },
  { key: 'groups-financials', group: 'money', en: 'Groups financials', ar: 'ماليات الجروبات', descEn: 'Collected, unpaid and instructor pay per group', descAr: 'المحصّل والمتبقي وأجر المدرب لكل جروب', href: '/dashboard/reports/groups-financials', roles: MANAGERS },
  { key: 'defaulters', group: 'money', en: 'Unpaid & paid invoices', ar: 'الفواتير المتأخرة والمدفوعة', descEn: 'Who has not paid, who paid — to Excel', descAr: 'مين مدفعش ومين دفع — تصدير Excel', href: '/dashboard/accountant/fees', formats: ['excel'], perm: ['fee_collection', 'export'] },
  { key: 'discounts', group: 'money', en: 'Discounts report', ar: 'تقرير الخصومات', descEn: 'Discounts given by type, branch and month', descAr: 'الخصومات حسب النوع والفرع والشهر', href: '/dashboard/discounts?tab=report', perm: ['discounts', 'read'] },
  { key: 'refunds', group: 'money', en: 'Refunds', ar: 'الاسترداد', descEn: 'All refunds, cash or wallet, and who approved', descAr: 'كل عمليات الاسترداد، كاش ولا محفظة، ومين وافق', href: '/dashboard/refunds?tab=all', perm: ['refunds', 'read'] },
  { key: 'wallet', group: 'money', en: 'Wallet top-ups & withdrawals', ar: 'شحن وسحب المحفظة', descEn: 'Receipts to check, withdrawals, student statements', descAr: 'إيصالات للمراجعة، طلبات السحب، كشف حساب الطالب', href: '/dashboard/wallet?tab=withdrawals', perm: ['wallet', 'read'] },
  { key: 'expenses', group: 'money', en: 'Expenses', ar: 'المصاريف', descEn: 'Running costs per category and month, to Excel', descAr: 'مصاريف التشغيل لكل بند وشهر، وتصدير Excel', href: '/dashboard/accountant/expenses', formats: ['excel'], perm: ['expenses', 'read'] },

  // instructors & staff
  { key: 'instructor-performance', group: 'staff', en: 'Instructor performance', ar: 'أداء المدربين', descEn: 'Attendance, results, ratings and reports of each instructor', descAr: 'حضور ونتايج وتقييمات وتقارير كل مدرب', href: '/dashboard/teacher-performance', roles: MANAGERS },
  { key: 'substitutes', group: 'staff', en: 'Substitute pay', ar: 'حساب البدلاء', descEn: 'Bonus for substitutes, deduction for absent instructors', descAr: 'مكافأة البديل والخصم من المدرب الغايب', href: '/dashboard/reports/substitute-reconciliation', roles: [...MANAGERS, 'ACCOUNTANT'] },
  { key: 'salaries', group: 'staff', en: 'Staff salaries', ar: 'مرتبات الموظفين', descEn: 'Salary slips and instructor group pay', descAr: 'قسايم المرتبات وأجر المدربين من الجروبات', href: '/dashboard/salaries', formats: ['print'], roles: [...MANAGERS, 'ACCOUNTANT'], perm: ['salaries', 'read'] },
  { key: 'staff', group: 'staff', en: 'Instructors & staff list', ar: 'قايمة المدربين والموظفين', descEn: 'All instructors and staff with their places', descAr: 'كل المدربين والموظفين وأماكنهم', href: '/dashboard/teachers', roles: OFFICE, perm: ['teachers', 'read'] },

  // learning
  { key: 'lms-analytics', group: 'learning', en: 'Learning analytics', ar: 'تحليلات التعليم', descEn: 'Lessons opened, homework, quizzes, weak groups, hardest questions', descAr: 'الدروس المفتوحة والواجبات والكويزات والجروبات الضعيفة وأصعب الأسئلة', href: '/dashboard/lms', roles: [...MANAGERS, 'TEACHER'], perm: ['curriculum', 'read'] },
  { key: 'level-results', group: 'learning', en: 'Level results', ar: 'نتائج المستوى', descEn: 'Scores, pass / fail and certificates per group', descAr: 'الدرجات والنجاح والرسوب والشهادات لكل جروب', href: '/dashboard/teacher/level-results', formats: ['excel'], roles: MANAGERS, perm: ['grading_engine', 'read'] },
  { key: 'session-reports', group: 'learning', en: 'Session reports', ar: 'تقارير الحصص', descEn: 'What was done in each session, sent to families', descAr: 'اتعمل إيه في كل حصة، واتبعت لأولياء الأمور', href: '/dashboard/session-reports', formats: ['print'], roles: OFFICE, perm: ['session_reports', 'read'] },

  // partners
  { key: 'partners', group: 'partners', en: 'Partners overview & balances', ar: 'ملخص الشركاء والأرصدة', descEn: 'Each partner: places, students, balance; statements to Excel', descAr: 'كل شريك: أماكنه وطلابه ورصيده، وكشوف الحساب Excel', href: '/dashboard/partners', formats: ['excel', 'print'], roles: ADMINS, perm: ['partners', 'read'] },

  // communication & families
  { key: 'complaints', group: 'communication', en: 'Complaints month report', ar: 'تقرير الشكاوى الشهري', descEn: 'By topic, branch, type; time to solve; "solved" rate', descAr: 'حسب الموضوع والفرع والنوع، ووقت الحل، ونسبة «اتحلّت»', href: '/dashboard/complaints?tab=report', perm: ['complaints', 'export'] },
  { key: 'ratings', group: 'communication', en: 'Ratings', ar: 'التقييمات', descEn: 'What parents think of sessions, instructors and TechNova (NPS)', descAr: 'رأي أولياء الأمور في الحصص والمدربين وTechNova', href: '/dashboard/ratings', perm: ['ratings', 'read'] },
  { key: 'referrals', group: 'communication', en: 'Referrals', ar: 'الإحالات', descEn: 'Who referred whom, top referrers, rewards', descAr: 'مين جاب مين، وأكتر ناس جابوا طلاب، والمكافآت', href: '/dashboard/referrals', perm: ['referrals', 'read'] },
  { key: 'follow-ups', group: 'communication', en: 'Contact log & follow-ups', ar: 'سجل التواصل والمتابعات', descEn: 'Calls and messages with parents, follow-ups due', descAr: 'المكالمات والرسايل مع أولياء الأمور، والمتابعات المطلوبة', href: '/dashboard/follow-ups', perm: ['contact_logs', 'read'] },
]
