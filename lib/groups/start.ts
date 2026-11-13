/**
 * Six phases E2 (2026-11-13): a group with a minimum count (server only).
 * groupStart()      — state, count, missing, expected start, first session.
 * checkReady()      — the minimum is reached: the start is confirmed and families, the instructor and staff are told.
 * attendanceBlock() — attendance waits while the group waits for its minimum (or was cancelled).
 * postpone / startAnyway / cancelGroup — staff decisions (permission group_start: update / approve / delete).
 * startAlerts() + nextMonthDeadlines() — daily job.
 * Who counts: "after payment" groups count the students IN the group (they joined by paying, or staff let them in);
 * otherwise everyone (or only those who paid enough, when the policy says so).
 */

import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { notifyFamilies, notifyUsers } from '@/lib/notifications/events'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { createYearEnrollmentForStudent } from '@/lib/academic/enrollment'
import { approveRefund } from '@/lib/refunds/engine'
import { currentInvoice, holdUntilPaid, policyForGroup } from './entry'
import { paidEnough } from './policy'
import { canTakeAttendance, nextMonthStage, nextSlotDate, startAlertDue, startState, type StartState } from './start-rules'

export class StartError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const fmt = (d: string | null, ar: boolean) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }) : '')

async function groupRow(groupId: string) {
  return prisma.classSection.findUnique({
    where: { id: groupId },
    select: { id: true, className: true, campusId: true, kind: true, status: true, scheduleSlots: true, startDate: true, expectedStartDate: true, startConfirmedAt: true, startForced: true, startAlertedAt: true, cancelledAt: true, installmentsAllowed: true },
  })
}

export async function groupStart(groupId: string) {
  const g = await groupRow(groupId)
  if (!g) throw new StartError('NOT_FOUND', 'Group not found', 404)
  const p = await policyForGroup(groupId)
  let count = 0
  if (p.minStudents && g.kind === 'GROUP') {
    const enr = await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: { in: p.entry === 'AFTER_PAYMENT' || p.countPaidOnly ? ['ACTIVE'] : ['ACTIVE', 'AWAITING_PAYMENT'] } }, select: { studentId: true } })
    if (p.countPaidOnly && p.entry !== 'AFTER_PAYMENT') {
      for (const e of enr) {
        const inv = await currentInvoice(e.studentId, groupId)
        if (paidEnough(inv ? { totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status } : null, g.installmentsAllowed, p.minPartPercent)) count++
      }
    } else count = enr.length
  }
  const state: StartState = g.kind !== 'GROUP' ? (g.startDate ? 'STARTED' : 'NO_MINIMUM') : startState({ minStudents: p.minStudents, count, startDate: g.startDate, cancelledAt: g.cancelledAt, startConfirmedAt: g.startConfirmedAt, startForced: g.startForced })
  const today = cairoToday()
  const expected = day(g.expectedStartDate)
  const from = expected && expected > today ? expected : today
  return {
    groupId, name: g.className, campusId: g.campusId, state, min: p.minStudents, count, missing: p.minStudents ? Math.max(0, p.minStudents - count) : 0,
    expectedStartDate: expected, firstSession: g.startDate ? day(g.startDate) : nextSlotDate(g.scheduleSlots, from),
    startAnywayAllowed: p.startAnyway, alertDays: p.alertDays, alerted: !!g.startAlertedAt, entry: p.entry,
  }
}
export type GroupStart = Awaited<ReturnType<typeof groupStart>>

/** Families of everyone holding a seat in the group (in it or waiting to pay). */
async function seatHolders(groupId: string) {
  return (await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } }, select: { studentId: true } })).map((e) => e.studentId)
}

async function instructorUserIds(groupId: string) {
  const offers = await prisma.subjectOffering.findMany({ where: { classSectionId: groupId, teacherId: { not: null } }, select: { teacher: { select: { userId: true } } } })
  return offers.map((o) => o.teacher?.userId).filter(Boolean) as string[]
}

async function officeOf(campusId: string) {
  const users = await prisma.user.findMany({ where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] } }, select: { id: true, role: true } })
  const out: string[] = []
  for (const u of users) if (u.role === 'SUPER_ADMIN' || allowsCampus(await loadPlaces(u), campusId)) out.push(u.id)
  return out
}

/** The minimum was reached: confirm the start once and tell everyone the first session. Returns true when it was confirmed now. */
export async function checkReady(groupId: string): Promise<boolean> {
  const s = await groupStart(groupId).catch(() => null)
  if (!s || s.state !== 'READY' || !s.min) return false
  const g = await groupRow(groupId)
  if (!g || g.startConfirmedAt) return false
  const upd = await prisma.classSection.updateMany({ where: { id: groupId, startConfirmedAt: null }, data: { startConfirmedAt: new Date() } })
  if (!upd.count) return false
  await tellStart(s, 'READY')
  return true
}

async function tellStart(s: GroupStart, why: 'READY' | 'FORCED' | 'POSTPONED') {
  const en = fmt(s.firstSession ?? s.expectedStartDate, false)
  const ar = fmt(s.firstSession ?? s.expectedStartDate, true)
  const title = why === 'POSTPONED' ? { en: `${s.name}: the start moved to ${fmt(s.expectedStartDate, false)}`, ar: `${s.name}: ميعاد البداية اتغير لـ ${fmt(s.expectedStartDate, true)}` }
    : { en: `${s.name} starts ${en || 'soon'}`, ar: `${s.name} هيبدأ ${ar || 'قريب'}` }
  const msg = why === 'POSTPONED' ? { en: 'We are waiting for the group to be complete; we will tell you the first session.', ar: 'مستنيين الجروب يكمل، وهنبلغك بأول حصة.' }
    : { en: 'The group is complete. See the sessions in the portal.', ar: 'الجروب كمل. الحصص في البوابة.' }
  await notifyFamilies(await seatHolders(s.groupId), 'BOOKING_UPDATE', () => ({ title: title.en, message: msg.en, titleAr: title.ar, messageAr: msg.ar, relatedId: s.groupId }), { includeStudent: true }).catch(() => 0)
  if (why !== 'POSTPONED') {
    await notifyUsers([...(await instructorUserIds(s.groupId)), ...(await officeOf(s.campusId))], 'BOOKING_NEW', { title: title.en, message: `${s.count} ${why === 'FORCED' ? '(started below the minimum)' : 'students'}`, titleAr: title.ar, messageAr: `${s.count} ${why === 'FORCED' ? '(بدأ تحت الحد الأدنى)' : 'طالب'}`, relatedId: s.groupId }).catch(() => 0)
  }
}

/** Attendance may not be taken while the group waits for its minimum (or after it was cancelled). */
export async function attendanceBlock(groupId: string): Promise<string | null> {
  const s = await groupStart(groupId).catch(() => null)
  if (!s || canTakeAttendance(s.state)) return null
  return s.state === 'CANCELLED'
    ? 'This group was cancelled · الجروب ده اتلغى'
    : `This group waits for its minimum (${s.count}/${s.min}). It starts when complete, or staff with the permission start it anyway · الجروب مستني اكتمال العدد (${s.count}/${s.min}). بيبدأ لما يكمل، أو الموظف اللي عنده الصلاحية يبدأه برضه`
}

export async function setExpected(groupId: string, date: string, reason: string | null) {
  const g = await groupRow(groupId)
  if (!g) throw new StartError('NOT_FOUND', 'Group not found', 404)
  if (g.startDate || g.cancelledAt) throw new StartError('STARTED', 'The group already started or was cancelled · الجروب بدأ أو اتلغى', 409)
  await prisma.classSection.update({ where: { id: groupId }, data: { expectedStartDate: new Date(`${date}T00:00:00Z`), startAlertedAt: null } })
  const s = await groupStart(groupId)
  if (g.expectedStartDate) await tellStart({ ...s, name: reason ? `${s.name} (${reason})` : s.name }, 'POSTPONED')
  return s
}

export async function startAnyway(groupId: string) {
  const s = await groupStart(groupId)
  if (s.state !== 'WAITING_COUNT') throw new StartError('NOT_WAITING', 'The group is not waiting for its minimum · الجروب مش مستني العدد', 409)
  if (!s.startAnywayAllowed) throw new StartError('NOT_ALLOWED', 'Starting below the minimum is switched off (group policies) · البداية تحت الحد الأدنى مقفولة (سياسة الجروبات)', 403)
  await prisma.classSection.update({ where: { id: groupId }, data: { startForced: true, startConfirmedAt: new Date() } })
  const after = await groupStart(groupId)
  await tellStart(after, 'FORCED')
  return after
}

export type CancelChoice = { studentId: string; action: 'MOVE' | 'WAIT' | 'LEAVE'; toGroupId?: string | null }

/**
 * Cancels a group that has not started: paid money back to each family's wallet (approved refund, method WALLET), unpaid
 * invoices cancelled, each student moved to another group (the wallet pays the new invoice by itself), put on the waiting
 * list, or out; open bookings closed; families, the instructor and staff told.
 */
export async function cancelGroup(staff: { id: string; role: string }, groupId: string, reason: string, choices: CancelChoice[]) {
  const s = await groupStart(groupId)
  if (s.state === 'STARTED') throw new StartError('STARTED', 'A group that started is closed with the normal steps, not cancelled · الجروب اللي بدأ بيتقفل بالطريقة العادية مش بيتلغي', 409)
  if (s.state === 'CANCELLED') throw new StartError('CANCELLED', 'Already cancelled · اتلغى قبل كده', 409)
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { levelId: true, campusId: true, className: true, level: { select: { subjectId: true } } } })
  const holders = await seatHolders(groupId)
  const result: { studentId: string; refunded: number; action: string; toGroup: string | null }[] = []
  for (const studentId of holders) {
    const choice = choices.find((c) => c.studentId === studentId) ?? { studentId, action: 'WAIT' as const }
    // 1. money back to the wallet, unpaid invoices cancelled
    let refunded = 0
    const invoices = await prisma.feeInvoice.findMany({ where: { studentId, classSectionId: groupId, status: { not: 'CANCELLED' } }, select: { id: true, paidAmount: true, refundedAmount: true } })
    for (const inv of invoices) {
      const net = Math.round((Number(inv.paidAmount) - Number(inv.refundedAmount)) * 100) / 100
      if (net > 0) {
        const r = await prisma.refund.create({ data: { invoiceId: inv.id, studentId, suggestedAmount: net, amount: net, method: 'WALLET', reason: `Group cancelled: ${reason} · الجروب اتلغى`, calc: { groupCancelled: groupId }, requestedById: staff.id } })
        const out = await approveRefund(r.id, staff.id)
        if (out.ok) refunded += net
      } else {
        await prisma.feeInvoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED', notes: 'Group cancelled · الجروب اتلغى' } })
      }
    }
    // 2. out of this group
    await prisma.studentEnrollment.updateMany({ where: { studentId, classSectionId: groupId, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } }, data: { status: 'WITHDRAWN', withdrawalReason: 'GROUP_CANCELLED' } })
    // 3. where to
    let toGroup: string | null = null
    if (choice.action === 'MOVE' && choice.toGroupId) {
      const t = await prisma.classSection.findFirst({ where: { id: choice.toGroupId, status: 'ACTIVE', isActive: true, kind: 'GROUP', cancelledAt: null }, select: { id: true, className: true, campusId: true } })
      if (t && allowsCampus(await loadPlaces(staff), t.campusId)) {
        const year = await getActiveAcademicYear()
        const old = await prisma.studentEnrollment.findFirst({ where: { studentId, classSectionId: t.id }, select: { id: true } })
        if (old) await prisma.studentEnrollment.update({ where: { id: old.id }, data: { status: 'ACTIVE', withdrawalReason: null } })
        else if (year) {
          const reg = (await prisma.student.findUnique({ where: { id: studentId }, select: { registrationNumber: true } }))?.registrationNumber ?? studentId
          await createYearEnrollmentForStudent({ studentId, academicYearId: year.id, classSectionId: t.id, rollNumber: reg.replace(/\//g, '-') })
        }
        const { generateMissingCycleInvoices } = await import('./generate-invoices')
        await generateMissingCycleInvoices(t.id, staff.id, studentId).catch((e) => console.error('[CANCEL_GROUP] new invoice', e))
        await holdUntilPaid(studentId, t.id, { tellFamily: false }).catch(() => false)
        await checkReady(t.id).catch(() => false)
        toGroup = t.className
      }
    }
    if (choice.action === 'WAIT' || (choice.action === 'MOVE' && !toGroup)) {
      if (g?.level) await prisma.waitingListEntry.create({ data: { studentId, subjectId: g.level.subjectId, levelId: g.levelId, campusId: g.campusId, notes: `Group ${g.className} was cancelled · الجروب اتلغى`, createdById: staff.id } })
    }
    await prisma.courseBooking.updateMany({ where: { studentId, classSectionId: groupId, status: { in: ['REVIEW', 'PLACEMENT', 'HOLD', 'WAITING', 'CONFIRMED'] } }, data: { status: 'CANCELLED', reason: `The group was cancelled${toGroup ? `; moved to ${toGroup}` : ''} · الجروب اتلغى${toGroup ? `؛ اتنقل لـ ${toGroup}` : ''}`, holdUntil: null } })
    result.push({ studentId, refunded, action: toGroup ? 'MOVE' : choice.action === 'LEAVE' ? 'LEAVE' : 'WAIT', toGroup })
  }
  await prisma.classSection.update({ where: { id: groupId }, data: { cancelledAt: new Date(), cancelReason: reason, cancelledById: staff.id, status: 'COMPLETED', completedAt: new Date() } })
  for (const r of result) {
    const where = r.action === 'MOVE' ? { en: `moved to ${r.toGroup}`, ar: `اتنقل لـ ${r.toGroup}` } : r.action === 'WAIT' ? { en: 'on the waiting list for the next group', ar: 'في قايمة الانتظار للجروب الجاي' } : { en: 'out of the course', ar: 'خرج من الكورس' }
    const money = r.refunded > 0 ? { en: ` ${r.refunded} EGP went back to your wallet.`, ar: ` ${r.refunded} ج.م رجعت لمحفظتك.` } : { en: '', ar: '' }
    await notifyFamilies([r.studentId], 'BOOKING_UPDATE', (st) => ({
      title: `${g?.className ?? 'The group'} was cancelled — ${st.firstName} is ${where.en}`, message: `${reason}.${money.en}`,
      titleAr: `${g?.className ?? 'الجروب'} اتلغى — ${st.firstName} ${where.ar}`, messageAr: `${reason}.${money.ar}`, relatedId: groupId,
    })).catch(() => 0)
  }
  await notifyUsers(await instructorUserIds(groupId), 'BOOKING_NEW', { title: `${g?.className} was cancelled`, message: reason, titleAr: `${g?.className} اتلغى`, messageAr: reason, relatedId: groupId }).catch(() => 0)
  return { cancelled: true, students: result }
}

/** Daily: staff are told about groups close to their expected start that still miss students. */
export async function startAlerts() {
  const groups = await prisma.classSection.findMany({ where: { kind: 'GROUP', status: 'ACTIVE', isActive: true, startDate: null, cancelledAt: null, startConfirmedAt: null, startAlertedAt: null, expectedStartDate: { not: null } }, select: { id: true }, take: 300 })
  const today = cairoToday()
  let sent = 0
  for (const { id } of groups) {
    const s = await groupStart(id).catch(() => null)
    if (!s) continue
    if (s.state === 'READY') { await checkReady(id); continue }
    if (!startAlertDue(s.state, s.expectedStartDate, today, s.alertDays, s.alerted)) continue
    await prisma.classSection.update({ where: { id }, data: { startAlertedAt: new Date() } })
    await notifyUsers(await officeOf(s.campusId), 'BOOKING_NEW', {
      title: `${s.name}: ${s.missing} more student(s) needed before ${fmt(s.expectedStartDate, false)}`, message: 'Postpone, move the students, start anyway (if allowed) or cancel — on the group page.',
      titleAr: `${s.name}: ناقص ${s.missing} قبل ${fmt(s.expectedStartDate, true)}`, messageAr: 'أجّل، أو انقل الطلاب، أو ابدأ برضه (لو مسموح)، أو الغي — من صفحة الجروب.', relatedId: id,
    }).catch(() => 0)
    sent++
  }
  return { sent }
}

/**
 * Daily: next month in "after payment" groups (cycle 2+): continuing students with an unpaid invoice are reminded 3 days before
 * and on the day of the first session, then locked (AWAITING_PAYMENT) until they pay; after `nextMonthKeepDays` the seat is
 * given up only when someone waits for this group.
 */
export async function nextMonthDeadlines() {
  const today = cairoToday()
  const groups = await prisma.classSection.findMany({ where: { kind: 'GROUP', status: 'ACTIVE', isActive: true, cancelledAt: null, currentCycleNumber: { gt: 1 } }, select: { id: true, className: true, scheduleSlots: true, startDate: true, createdAt: true, installmentsAllowed: true }, take: 500 })
  let reminded = 0
  let locked = 0
  let freed = 0
  for (const g of groups) {
    const p = await policyForGroup(g.id)
    if (p.entry !== 'AFTER_PAYMENT') continue
    const first = g.startDate ? day(g.startDate) : nextSlotDate(g.scheduleSlots, day(g.createdAt)!)
    const enr = await prisma.studentEnrollment.findMany({ where: { classSectionId: g.id, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } }, select: { id: true, studentId: true, status: true, payNoticeStage: true, awaitingSince: true } })
    for (const e of enr) {
      const inv = await currentInvoice(e.studentId, g.id)
      if (paidEnough(inv ? { totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status } : null, g.installmentsAllowed, p.minPartPercent)) continue
      if (e.status === 'AWAITING_PAYMENT') {
        // seat kept N days after the lock; given up only if someone waits for this group
        if (e.awaitingSince && Date.now() - e.awaitingSince.getTime() > p.nextMonthKeepDays * 86_400_000) {
          const waiting = await prisma.waitingListEntry.count({ where: { classSectionId: g.id, status: 'WAITING' } })
          if (waiting) { const { removeAwaiting } = await import('./entry'); if (await removeAwaiting(g.id, e.studentId)) freed++ }
        }
        continue
      }
      const stage = nextMonthStage(first, today, e.payNoticeStage)
      if (stage === e.payNoticeStage) continue
      const amount = inv ? Number(inv.totalAmount) - Number(inv.paidAmount) : null
      if (stage === 3) {
        await prisma.studentEnrollment.update({ where: { id: e.id }, data: { payNoticeStage: 3, status: 'AWAITING_PAYMENT', awaitingSince: new Date() } })
        locked++
      } else {
        await prisma.studentEnrollment.update({ where: { id: e.id }, data: { payNoticeStage: stage } })
        reminded++
      }
      const keepUntil = new Date(Date.now() + p.nextMonthKeepDays * 86_400_000).toISOString().slice(0, 10)
      await notifyFamilies([e.studentId], 'INVOICE_NEW', (st) => stage === 3 ? ({
        title: `${st.firstName} is paused in ${g.className} until the invoice is paid`, message: `${amount ?? ''} EGP. The seat is kept until ${fmt(keepUntil, false)}.`,
        titleAr: `${st.firstName} واقف في ${g.className} لحد ما الفاتورة تتدفع`, messageAr: `${amount ?? ''} ج.م. المكان محجوز لحد ${fmt(keepUntil, true)}.`, relatedId: g.id,
      }) : ({
        title: `Next month of ${g.className}: pay before the first session (${fmt(first, false)})`, message: `${amount ?? ''} EGP for ${st.firstName}.`,
        titleAr: `الشهر الجاي في ${g.className}: ادفع قبل أول حصة (${fmt(first, true)})`, messageAr: `${amount ?? ''} ج.م لـ ${st.firstName}.`, relatedId: g.id,
      }), { includeStudent: stage === 3 }).catch(() => 0)
    }
  }
  return { reminded, locked, freed }
}
