/**
 * 2026-10-18 data health check — problems in the data that cause wrong bills, missing lessons or lost parents, each with
 * the rows and a link to fix them. Limited to the person's places. Run before entering real data and any time after.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { loadPlaces, groupWhere, studentWhere, invoiceWhere, teacherWhere, type Places } from '@/lib/places/server'

type Who = { id: string; role: string }
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW'
export interface HealthItem { id: string; label: string; href: string }
export interface HealthCheck { key: string; en: string; ar: string; fixEn: string; fixAr: string; severity: Severity; count: number; items: HealthItem[] }

const SAMPLE = 50
const sName = (s: { firstName: string; lastName: string; registrationNumber?: string | null }) => `${s.firstName} ${s.lastName}`.trim() + (s.registrationNumber ? ` (${s.registrationNumber})` : '')
const gName = (g: { className: string; sectionName: string; campus?: { name: string } | null }) => `${g.className} ${g.sectionName}`.trim() + (g.campus ? ` — ${g.campus.name}` : '')

async function run(p: Places): Promise<HealthCheck[]> {
  const sw = studentWhere(p), gw = groupWhere(p)
  const activeStudent = { enrollmentStatus: 'ACTIVE' as const, ...sw }
  const activeGroup = { status: 'ACTIVE' as const, isActive: true, ...gw }
  const stuSel = { id: true, firstName: true, lastName: true, registrationNumber: true }
  const grpSel = { id: true, className: true, sectionName: true, campus: { select: { name: true } } }
  const out: HealthCheck[] = []
  const add = (c: Omit<HealthCheck, 'count' | 'items'>, count: number, items: HealthItem[]) => out.push({ ...c, count, items })

  // students
  {
    const where = { ...activeStudent, guardians: { none: {} }, parents: { none: {} } }
    const [n, rows] = await Promise.all([prisma.student.count({ where }), prisma.student.findMany({ where, select: stuSel, take: SAMPLE })])
    add({ key: 'studentNoGuardian', severity: 'HIGH', en: 'Students without a parent / guardian', ar: 'طلاب من غير ولي أمر', fixEn: 'Open the student and link a guardian (their phone is the portal login).', fixAr: 'افتح الطالب واربط ولي أمر (تليفونه هو دخول البوابة).' }, n, rows.map((s) => ({ id: s.id, label: sName(s), href: `/dashboard/students/${s.id}` })))
  }
  {
    const where = { ...activeStudent, enrollments: { none: { status: 'ACTIVE' as const } }, waitingListEntries: { none: { status: 'WAITING' as const } } }
    const [n, rows] = await Promise.all([prisma.student.count({ where }), prisma.student.findMany({ where, select: stuSel, take: SAMPLE })])
    add({ key: 'studentNoGroup', severity: 'MEDIUM', en: 'Active students who are not in a group and not on the waiting list', ar: 'طلاب نشطين مش في جروب ومش في قايمة الانتظار', fixEn: 'Add them to a group or to the waiting list — or mark them withdrawn.', fixAr: 'ضيفهم لجروب أو لقايمة الانتظار — أو اعتبرهم منسحبين.' }, n, rows.map((s) => ({ id: s.id, label: sName(s), href: `/dashboard/students/${s.id}` })))
  }
  {
    const dups = await prisma.$queryRawUnsafe<{ firstName: string; lastName: string; d: string; n: bigint }[]>(
      `SELECT firstName, lastName, DATE_FORMAT(dateOfBirth,'%Y-%m-%d') d, COUNT(*) n FROM Student WHERE enrollmentStatus='ACTIVE' GROUP BY firstName, lastName, DATE(dateOfBirth) HAVING COUNT(*) > 1 LIMIT 200`)
    const items: HealthItem[] = []
    for (const d of dups) {
      const rows = await prisma.student.findMany({ where: { ...activeStudent, firstName: d.firstName, lastName: d.lastName }, select: stuSel, take: 5 })
      for (const s of rows) if (items.length < SAMPLE) items.push({ id: s.id, label: `${sName(s)} · ${d.d}`, href: `/dashboard/students/${s.id}` })
    }
    add({ key: 'studentDuplicate', severity: 'MEDIUM', en: 'Possible duplicate students (same name and birth date)', ar: 'طلاب ممكن يكونوا متكررين (نفس الاسم وتاريخ الميلاد)', fixEn: 'Check if they are the same child; keep one and withdraw the other.', fixAr: 'اتأكد لو هما نفس الطفل؛ سيب واحد واعتبر التاني منسحب.' }, new Set(items.map((i) => i.id)).size, items)
  }

  // groups
  {
    const where = { ...activeGroup, subjectOfferings: { none: { teacherId: { not: null } } } }
    const [n, rows] = await Promise.all([prisma.classSection.count({ where }), prisma.classSection.findMany({ where, select: grpSel, take: SAMPLE })])
    add({ key: 'groupNoInstructor', severity: 'HIGH', en: 'Active groups without an instructor', ar: 'جروبات شغالة من غير مدرب', fixEn: 'Open the group and choose the instructor (students do not show for any instructor until then).', fixAr: 'افتح الجروب واختار المدرب (الطلاب مش هيظهروا لأي مدرب لحد كده).' }, n, rows.map((g) => ({ id: g.id, label: gName(g), href: `/dashboard/groups?group=${g.id}` })))
  }
  {
    const all = await prisma.classSection.findMany({ where: activeGroup, select: { ...grpSel, scheduleSlots: true, levelId: true, maxStudents: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } })
    const noSchedule = all.filter((g) => !Array.isArray(g.scheduleSlots) || !(g.scheduleSlots as unknown[]).length)
    add({ key: 'groupNoSchedule', severity: 'HIGH', en: 'Active groups without a weekly schedule', ar: 'جروبات شغالة من غير جدول أسبوعي', fixEn: 'Edit the group and add its days and times (the calendar, reminders and end dates need them).', fixAr: 'عدّل الجروب وضيف أيامه ومواعيده (الجدول والتنبيهات وتاريخ النهاية محتاجينها).' }, noSchedule.length, noSchedule.slice(0, SAMPLE).map((g) => ({ id: g.id, label: gName(g), href: `/dashboard/groups?group=${g.id}` })))
    const noLevel = all.filter((g) => !g.levelId)
    add({ key: 'groupNoLevel', severity: 'HIGH', en: 'Active groups without a level', ar: 'جروبات شغالة من غير مستوى', fixEn: 'Edit the group and choose its level (prices, lessons and certificates come from it).', fixAr: 'عدّل الجروب واختار المستوى (الأسعار والدروس والشهادات بتيجي منه).' }, noLevel.length, noLevel.slice(0, SAMPLE).map((g) => ({ id: g.id, label: gName(g), href: `/dashboard/groups?group=${g.id}` })))
    const over = all.filter((g) => g.maxStudents != null && g._count.enrollments > g.maxStudents)
    add({ key: 'groupOverFull', severity: 'LOW', en: 'Groups with more students than their limit', ar: 'جروبات فيها طلاب أكتر من الحد', fixEn: 'Raise the limit or move students to another group.', fixAr: 'زوّد الحد أو انقل طلاب لجروب تاني.' }, over.length, over.slice(0, SAMPLE).map((g) => ({ id: g.id, label: `${gName(g)} · ${g._count.enrollments}/${g.maxStudents}`, href: `/dashboard/groups?group=${g.id}` })))
  }
  {
    const where = { status: 'ACTIVE' as const, classSection: { status: 'COMPLETED' as const, ...gw } }
    const [n, rows] = await Promise.all([prisma.studentEnrollment.count({ where }), prisma.studentEnrollment.findMany({ where, select: { id: true, student: { select: stuSel }, classSection: { select: grpSel } }, take: SAMPLE })])
    add({ key: 'enrollmentInFinishedGroup', severity: 'MEDIUM', en: 'Students still active in a finished group', ar: 'طلاب لسه نشطين في جروب خلص', fixEn: 'Move them to the next group (advance cycle) or withdraw them.', fixAr: 'انقلهم للجروب اللي بعده (ترحيل الشهر) أو اعتبرهم منسحبين.' }, n, rows.map((e) => ({ id: e.id, label: `${sName(e.student)} · ${gName(e.classSection)}`, href: `/dashboard/students/${e.student.id}` })))
  }

  // money
  {
    const where = { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as ('ISSUED' | 'PARTIALLY_PAID' | 'OVERDUE')[] }, student: { enrollmentStatus: { in: ['WITHDRAWN', 'GRADUATED'] as ('WITHDRAWN' | 'GRADUATED')[] } }, ...invoiceWhere(p) }
    const [n, rows] = await Promise.all([prisma.feeInvoice.count({ where }), prisma.feeInvoice.findMany({ where, select: { id: true, challanNumber: true, student: { select: stuSel } }, take: SAMPLE })])
    add({ key: 'invoiceLeftStudent', severity: 'MEDIUM', en: 'Unpaid invoices of students who left', ar: 'فواتير مش مدفوعة لطلاب مشيوا', fixEn: 'Cancel them, or collect if the money is really owed.', fixAr: 'الغيها، أو حصّلها لو الفلوس فعلاً مستحقة.' }, n, rows.map((i) => ({ id: i.id, label: `${i.challanNumber} · ${sName(i.student)}`, href: `/dashboard/fees/${i.id}` })))
  }
  {
    const where = { isActive: true, defaultFixedAmount: null, defaultPercentOfStudentPayment: null, defaultPerSessionAmount: null, subjectOfferings: { some: { classSection: { status: 'ACTIVE' as const } } }, ...teacherWhere(p) }
    const [n, rows] = await Promise.all([prisma.teacher.count({ where }), prisma.teacher.findMany({ where, select: { id: true, firstName: true, lastName: true }, take: SAMPLE })])
    add({ key: 'teacherNoPay', severity: 'MEDIUM', en: 'Instructors teaching groups with no pay rule', ar: 'مدربين بيدرّسوا جروبات من غير قاعدة أجر', fixEn: 'Set the instructor’s pay (fixed, % or per session) — or a pay rule on each group.', fixAr: 'حدد أجر المدرب (ثابت أو نسبة أو بالحصة) — أو قاعدة أجر على كل جروب.' }, n, rows.map((t) => ({ id: t.id, label: `${t.firstName} ${t.lastName}`.trim(), href: `/dashboard/teachers/${t.id}/compensation` })))
  }
  {
    const n = await prisma.moneyMovement.count({ where: { accountId: null, ...(p.all ? {} : { campusId: { in: p.campusIds.length ? p.campusIds : ['__none__'] } }) } })
    add({ key: 'moneyNotPlaced', severity: 'LOW', en: 'Money movements not placed in a cash box / account', ar: 'حركات فلوس مش متسجلة على خزنة / حساب', fixEn: 'Link each payment method to its account in Settings → Payments.', fixAr: 'اربط كل طريقة دفع بحسابها من الإعدادات ← الدفع.' }, n, n ? [{ id: 'routes', label: `${n}`, href: '/dashboard/admin/finance-settings#accounts' }] : [])
  }
  return out
}

export async function dataHealth(user: Who) {
  const p = await loadPlaces(user)
  const checks = await run(p)
  const order: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  checks.sort((a, b) => (a.count ? 0 : 1) - (b.count ? 0 : 1) || order[a.severity] - order[b.severity])
  return { checks, problems: checks.reduce((n, c) => n + (c.count ? 1 : 0), 0) }
}
