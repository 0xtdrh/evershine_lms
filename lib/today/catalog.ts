/**
 * 5-C "Your work today" (2026-10-17): every job someone may have to do today, ONE list for all roles.
 * Each task is shown to a person only when (roles match AND the permission is allowed) AND its count > 0; counts are
 * limited to the person's places (M0). Counting lives in lib/today/server.ts (a counter per key — TypeScript makes
 * sure every task here has one). RULE (owner 2026-10-17): a new feature where someone must act adds its task here.
 * Pure: no React, no Prisma (tested in tests/hub-registries.test.ts).
 */

import type { AcademicResource as Resource, Action } from '@/lib/rbac'

export const TASK_KEYS = [
  // office / managers
  'admissions', 'leads', 'followUps', 'proofs', 'topUps', 'withdrawals', 'refunds', 'discounts', 'excuses',
  'complaintsLate', 'complaintsMine', 'absenceRequests', 'noSubstitute', 'leaves', 'missingAttendance',
  'groupsToAdvance', 'renewalsUnanswered', 'waitingList', 'overdueInvoices', 'birthdays',
  // partners / learning
  'partnerStatements', 'partnerContracts', 'curriculumReview', 'announcementsToApprove', 'announcementsToConfirm',
  'cashCountsToApprove', 'transfersToApprove', 'cashBoxesNotCounted', 'moneyNotPlaced', 'budgetOver', 'cashForecastLow', 'bankNotReconciled', 'monthNotClosed', 'sessionsWithoutRoom',
  // instructors
  'mySessionsToday', 'myMissingAttendance', 'homeworkToGrade', 'substituteRequests',
] as const
export type TaskKey = (typeof TASK_KEYS)[number]

export interface TaskDef {
  key: TaskKey
  en: string
  ar: string
  href: string
  /** red = should be done today; normal = good to know */
  urgent?: boolean
  roles?: string[]
  perm?: [Resource, Action]
}

const OFFICE = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY']
const MANAGERS = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']
const STAFF = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING']

export const TASKS: TaskDef[] = [
  { key: 'mySessionsToday', en: 'Your sessions today', ar: 'حصصك النهارده', href: '/dashboard/schedule', roles: ['TEACHER'] },
  { key: 'myMissingAttendance', en: 'Your sessions without attendance', ar: 'حصص ليك الحضور فيها مش متسجل', href: '/dashboard/teacher/attendance', urgent: true, roles: ['TEACHER'] },
  { key: 'substituteRequests', en: 'Substitute requests to answer', ar: 'طلبات بديل مستنية ردك', href: '/dashboard/teacher/my-substitutions', urgent: true, roles: ['TEACHER'] },
  { key: 'homeworkToGrade', en: 'Homework to grade', ar: 'واجبات محتاجة تصحيح', href: '/dashboard/assignments', roles: ['TEACHER'] },

  { key: 'proofs', en: 'Payment receipts to check', ar: 'إيصالات دفع محتاجة مراجعة', href: '/dashboard/fees', urgent: true, perm: ['fees', 'update'], roles: STAFF },
  { key: 'topUps', en: 'Wallet top-up receipts to check', ar: 'إيصالات شحن محفظة محتاجة مراجعة', href: '/dashboard/wallet?tab=approve', urgent: true, perm: ['wallet', 'approve'] },
  { key: 'withdrawals', en: 'Wallet withdrawals to decide', ar: 'طلبات سحب من المحفظة مستنية قرار', href: '/dashboard/wallet?tab=withdrawals', urgent: true, perm: ['wallet', 'approve'] },
  { key: 'refunds', en: 'Refund requests to approve', ar: 'طلبات استرداد مستنية موافقة', href: '/dashboard/refunds?tab=requests', urgent: true, perm: ['refunds', 'approve'] },
  { key: 'discounts', en: 'Discounts waiting for approval', ar: 'خصومات مستنية موافقة', href: '/dashboard/discounts?tab=requests', urgent: true, perm: ['discount_approvals', 'approve'] },
  { key: 'admissions', en: 'New applications to review', ar: 'طلبات تسجيل جديدة محتاجة مراجعة', href: '/dashboard/admissions', urgent: true, perm: ['admissions', 'update'], roles: [...OFFICE, 'MARKETING'] },
  { key: 'leads', en: 'New website leads', ar: 'عملاء جداد من الموقع', href: '/dashboard/leads', perm: ['admissions', 'read'], roles: [...OFFICE, 'MARKETING'] },
  { key: 'followUps', en: 'Parents to call today', ar: 'أولياء أمور لازم تكلّمهم النهارده', href: '/dashboard/follow-ups', urgent: true, perm: ['contact_logs', 'read'] },
  { key: 'excuses', en: 'Absence excuses to review', ar: 'أعذار غياب محتاجة مراجعة', href: '/dashboard/absence-excuses', urgent: true, perm: ['absence_excuses', 'approve'] },
  { key: 'complaintsLate', en: 'Complaints past their reply time', ar: 'شكاوى عدّى ميعاد الرد عليها', href: '/dashboard/complaints', urgent: true, perm: ['complaints', 'update'] },
  { key: 'complaintsMine', en: 'Open complaints you are responsible for', ar: 'شكاوى مفتوحة إنت المسؤول عنها', href: '/dashboard/complaints', perm: ['complaints', 'update'] },
  { key: 'absenceRequests', en: 'Instructor absence requests to decide', ar: 'طلبات غياب مدربين مستنية قرار', href: '/dashboard/absence-requests', urgent: true, perm: ['teacher_absences', 'approve'], roles: OFFICE },
  { key: 'noSubstitute', en: 'Coming sessions of an absent instructor with no substitute', ar: 'حصص جاية لمدرب غايب ومفيش بديل', href: '/dashboard/absence-requests', urgent: true, perm: ['teacher_absences', 'approve'], roles: OFFICE },
  { key: 'leaves', en: 'Staff leave requests to decide', ar: 'طلبات إجازة موظفين مستنية قرار', href: '/dashboard/leaves', perm: ['leaves', 'approve'] },
  { key: 'missingAttendance', en: "Yesterday's sessions without attendance", ar: 'حصص امبارح من غير حضور', href: '/dashboard/schedule', urgent: true, roles: OFFICE },
  { key: 'groupsToAdvance', en: 'Groups that finished their month (advance them)', ar: 'جروبات خلّصت الشهر (محتاجة ترحيل)', href: '/dashboard/groups', urgent: true, perm: ['class_sections', 'update'], roles: MANAGERS },
  { key: 'renewalsUnanswered', en: 'Parents who did not answer "continuing?"', ar: 'أولياء أمور مردّوش على «مكمّل؟»', href: '/dashboard/renewals', perm: ['renewals', 'update'] },
  { key: 'waitingList', en: 'Students on the waiting list', ar: 'طلاب في قايمة الانتظار', href: '/dashboard/waiting-list', perm: ['waiting_list', 'read'], roles: OFFICE },
  { key: 'overdueInvoices', en: 'Overdue invoices', ar: 'فواتير متأخرة', href: '/dashboard/accountant/fees', perm: ['fees', 'read'], roles: [...MANAGERS, 'ACCOUNTANT', 'SECRETARY'] },
  { key: 'partnerStatements', en: 'Partner statements waiting for approval', ar: 'كشوف حساب شركاء مستنية اعتماد', href: '/dashboard/partners', perm: ['partner_finance', 'approve'] },
  { key: 'partnerContracts', en: 'Partner contracts ending soon', ar: 'عقود شركاء قرّبت تخلص', href: '/dashboard/partners', perm: ['partners', 'read'] },
  { key: 'curriculumReview', en: 'Curriculum versions waiting for review', ar: 'نسخ منهج مستنية مراجعة', href: '/dashboard/curriculum', perm: ['curriculum', 'approve'] },
  { key: 'announcementsToApprove', en: 'Announcements waiting for your approval', ar: 'إعلانات مستنية موافقتك', href: '/dashboard/announcements?tab=pending', urgent: true, perm: ['announcements', 'approve'] },
  { key: 'announcementsToConfirm', en: 'Important announcements to confirm you read', ar: 'إعلانات مهمة محتاجة تأكيد إنك قريتها', href: '/dashboard/announcements', urgent: true, roles: [...STAFF, 'TEACHER'] },
  { key: 'cashCountsToApprove', en: 'Cash count differences to approve', ar: 'فروق جرد خزنة مستنية موافقة', href: '/dashboard/treasury?tab=counts', urgent: true, perm: ['treasury', 'approve'] },
  { key: 'transfersToApprove', en: 'Transfers between accounts to approve', ar: 'تحويلات بين الحسابات مستنية موافقة', href: '/dashboard/treasury?tab=transfers', urgent: true, perm: ['treasury', 'approve'] },
  { key: 'cashBoxesNotCounted', en: 'Cash boxes not counted today', ar: 'خزن لسه ماتقفلتش النهارده', href: '/dashboard/treasury?tab=counts', urgent: true, perm: ['treasury', 'create'] },
  { key: 'moneyNotPlaced', en: 'Money not placed in an account (set the payment method account)', ar: 'فلوس مش متسجلة على حساب (حدد حساب طريقة الدفع)', href: '/dashboard/admin/finance-settings#accounts', perm: ['treasury', 'update'] },
  { key: 'budgetOver', en: 'Expense categories over their budget this month', ar: 'بنود مصاريف عدّت ميزانيتها الشهر ده', href: '/dashboard/treasury?tab=budget', urgent: true, perm: ['expenses', 'read'], roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { key: 'cashForecastLow', en: 'Next 30 days: expected money may not cover the usual spending', ar: 'الـ 30 يوم الجايين: الفلوس المتوقعة ممكن ماتغطيش المصاريف العادية', href: '/dashboard/treasury?tab=cashflow', urgent: true, perm: ['treasury', 'approve'], roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { key: 'bankNotReconciled', en: 'Bank / e-wallet movements older than a week not matched with the statement', ar: 'حركات بنك / محافظ عدّى عليها أسبوع ومش متطابقة مع الكشف', href: '/dashboard/treasury?tab=reconcile', perm: ['treasury', 'approve'], roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { key: 'monthNotClosed', en: 'Last month is not closed yet (check it, then close it)', ar: 'الشهر اللي فات لسه متقفلش (راجعه واقفله)', href: '/dashboard/month-close', perm: ['month_close', 'create'], roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'] },
  { key: 'sessionsWithoutRoom', en: 'Branch sessions with no room yet (set it in the group schedule)', ar: 'حصص في الفرع لسه ملهاش قاعة (حددها من مواعيد الجروب)', href: '/reports/rooms', roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: ['class_sections', 'update'] },
  { key: 'birthdays', en: 'Student birthdays today', ar: 'أعياد ميلاد طلاب النهارده', href: '/dashboard/birthdays', perm: ['birthdays', 'read'], roles: OFFICE },
]

/** Tasks a person may see (before counting). */
export function tasksFor(role: string, can: (r: Resource, a: Action) => boolean): TaskDef[] {
  return TASKS.filter((t) => (!t.roles || t.roles.includes(role)) && (!t.perm || can(t.perm[0], t.perm[1])))
}
