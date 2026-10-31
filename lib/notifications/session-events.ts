/**
 * Phase C: family notifications about sessions — cancelled, substitute
 * instructor (no name, owner 2026-10-03), holiday, makeup session. Never throws. Server-only.
 * 2026-10-17: every message in English + Arabic (the bell shows the reader's language), the holiday
 * one goes to the student too and says when the next session is (same maths as the calendar).
 */

import { prisma } from '@/lib/prisma'
import { cleanSlots, upcomingSessions } from '@/lib/groups/schedule-calendar'
import { groupExceptions } from '@/lib/groups/calendar-exceptions'
import { cairoToday } from '@/lib/dates/cairo'
import { notifyFamilies } from './events'

const day = (d: string) => new Date(`${d}T00:00:00Z`)
const fmt = (d: string) => day(d).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'short' })
const fmtAr = (d: string) => day(d).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const addDay = (d: string) => new Date(day(d).getTime() + 86_400_000).toISOString().slice(0, 10)
/** "16:00" → "4:00 PM" / "4:00 م" */
const time12 = (t: string, ar = false) => {
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return t
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM')}`
}

async function groupStudents(classSectionId: string) {
  const [g, e] = await Promise.all([
    prisma.classSection.findUnique({ where: { id: classSectionId }, select: { className: true, sectionName: true, scheduleSlots: true } }),
    prisma.studentEnrollment.findMany({ where: { classSectionId, status: 'ACTIVE' }, select: { studentId: true } }),
  ])
  return { label: g ? `${g.className} ${g.sectionName}`.trim() : '', slots: cleanSlots(g?.scheduleSlots), ids: e.map((x) => x.studentId) }
}

export async function notifySessionCancelled(classSectionId: string, date: string, reason?: string | null) {
  try {
    if (date < cairoToday()) return
    const g = await groupStudents(classSectionId)
    await notifyFamilies(g.ids, 'SESSION_CANCELLED', (s) => ({
      title: 'Session cancelled',
      message: `${s.firstName}'s ${g.label} session on ${fmt(date)} is cancelled${reason ? ` (${reason})` : ''}. It will be made up — we will tell you the new date.`,
      titleAr: 'الحصة اتلغت',
      messageAr: `حصة ${s.firstName} في ${g.label} يوم ${fmtAr(date)} اتلغت${reason ? ` (${reason})` : ''}. هتتعوّض وهنقولك الميعاد الجديد.`,
      relatedId: classSectionId,
    }))
  } catch (err) {
    console.error('[NOTIFY_SESSION_CANCELLED]', err)
  }
}

export async function notifySubstitute(classSectionId: string, date: string) {
  try {
    if (date < cairoToday()) return
    const g = await groupStudents(classSectionId)
    await notifyFamilies(g.ids, 'SESSION_SUBSTITUTE', (s) => ({
      title: 'Another instructor for one session',
      message: `${s.firstName}'s ${g.label} session on ${fmt(date)} will be given by another TechNova instructor. Same time, same place.`,
      titleAr: 'مدرب تاني لحصة واحدة',
      messageAr: `حصة ${s.firstName} في ${g.label} يوم ${fmtAr(date)} هيديها مدرب تاني من TechNova. نفس الميعاد ونفس المكان.`,
      relatedId: classSectionId,
    }))
  } catch (err) {
    console.error('[NOTIFY_SUBSTITUTE]', err)
  }
}

/**
 * Families + students of groups (in that branch, or all for a company holiday) with a session on one of the days.
 * Says when the next session is: the first session day after the holiday that is not a holiday too
 * (weekly slots + extra / makeup sessions, like the calendar).
 */
export async function notifyHoliday(campusId: string | null, days: string[], name: string) {
  try {
    const upcoming = days.filter((d) => d >= cairoToday())
    if (!upcoming.length) return
    const groups = await prisma.classSection.findMany({
      where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, ...(campusId && { campusId }) },
      select: { id: true, campusId: true, className: true, sectionName: true, scheduleSlots: true },
    })
    const exceptions = await groupExceptions(groups, day(cairoToday()))
    for (const g of groups) {
      const slots = cleanSlots(g.scheduleSlots)
      const hit = upcoming.filter((d) => slots.some((s) => s.dayOfWeek === day(d).getUTCDay()))
      if (!hit.length) continue
      const ids = (await prisma.studentEnrollment.findMany({ where: { classSectionId: g.id, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId)
      const ex = exceptions.get(g.id)
      const next = upcomingSessions({ slots, from: addDay(hit[hit.length - 1]), count: 1, holidays: ex?.holidays, extras: ex?.extras, branchHolidays: ex?.branchHolidays, modeOverrides: ex?.modeOverrides, maxDays: 120 })[0]
      const label = `${g.className} ${g.sectionName}`.trim()
      const nextEn = next ? ` The next session is ${fmt(next.date)} at ${time12(next.time)}.` : ''
      const nextAr = next ? ` الحصة الجاية ${fmtAr(next.date)} الساعة ${time12(next.time, true)}.` : ''
      await notifyFamilies(ids, 'HOLIDAY', (s) => ({
        title: `Day off: ${name}`,
        message: `No ${label} session on ${hit.map(fmt).join(', ')}. ${s.firstName}'s session is postponed, not lost.${nextEn}`,
        titleAr: `إجازة: ${name}`,
        messageAr: `مفيش حصة ${label} يوم ${hit.map(fmtAr).join('، ')}. حصة ${s.firstName} اتأجلت ومش ضايعة.${nextAr}`,
        relatedId: g.id,
      }), { includeStudent: true })
    }
  } catch (err) {
    console.error('[NOTIFY_HOLIDAY]', err)
  }
}

/** A makeup / extra session was added to a group (e.g. to make up a holiday). Families + students. */
export async function notifyMakeupSession(classSectionId: string, date: string, time: string, reason?: string | null) {
  try {
    if (date < cairoToday()) return
    const g = await groupStudents(classSectionId)
    await notifyFamilies(g.ids, 'MAKEUP_SESSION', (s) => ({
      title: 'Makeup session added',
      message: `Extra ${g.label} session for ${s.firstName} on ${fmt(date)} at ${time12(time)}${reason ? ` (${reason})` : ''}.`,
      titleAr: 'حصة تعويضية',
      messageAr: `في حصة زيادة لـ ${s.firstName} في ${g.label} يوم ${fmtAr(date)} الساعة ${time12(time, true)}${reason ? ` (${reason})` : ''}.`,
      relatedId: classSectionId,
    }), { includeStudent: true })
  } catch (err) {
    console.error('[NOTIFY_MAKEUP_SESSION]', err)
  }
}

/**
 * 2026-10-24 (live test): a family that joins a group AFTER a holiday was announced never heard of it.
 * Called when a student is put in a group (admission / add to group / transfer): tells that one family about the
 * coming holidays that fall on the group's session days (next 60 days), once per holiday day.
 */
export async function notifyJoinerHolidays(studentId: string, classSectionId: string) {
  try {
    const today = cairoToday()
    const g = await prisma.classSection.findUnique({
      where: { id: classSectionId },
      select: { id: true, campusId: true, className: true, sectionName: true, scheduleSlots: true, levelId: true, status: true },
    })
    if (!g || !g.levelId || g.status !== 'ACTIVE') return
    const slots = cleanSlots(g.scheduleSlots)
    if (!slots.length) return
    const until = new Date(day(today).getTime() + 60 * 86_400_000)
    const rows = await prisma.holiday.findMany({
      where: { date: { gte: day(today), lte: until }, OR: [{ campusId: null }, { campusId: g.campusId }] },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    })
    const hits = rows.map((h) => ({ d: h.date.toISOString().slice(0, 10), name: h.name })).filter((h) => slots.some((s) => s.dayOfWeek === day(h.d).getUTCDay()))
    if (!hits.length) return
    const st = await prisma.student.findUnique({ where: { id: studentId }, select: { userId: true } })
    const told = st ? await prisma.notification.findMany({ where: { userId: st.userId, type: 'HOLIDAY', relatedId: g.id }, select: { message: true } }) : []
    const fresh = hits.filter((h) => !told.some((t) => t.message.includes(fmt(h.d))))
    if (!fresh.length) return
    const ex = (await groupExceptions([g], day(today))).get(g.id)
    const next = upcomingSessions({ slots, from: addDay(fresh[fresh.length - 1].d), count: 1, holidays: ex?.holidays, extras: ex?.extras, branchHolidays: ex?.branchHolidays, modeOverrides: ex?.modeOverrides, maxDays: 120 })[0]
    const label = `${g.className} ${g.sectionName}`.trim()
    const names = [...new Set(fresh.map((h) => h.name))].join(' / ')
    const nextEn = next ? ` The next session is ${fmt(next.date)} at ${time12(next.time)}.` : ''
    const nextAr = next ? ` الحصة الجاية ${fmtAr(next.date)} الساعة ${time12(next.time, true)}.` : ''
    await notifyFamilies([studentId], 'HOLIDAY', (s) => ({
      title: `Day off: ${names}`,
      message: `No ${label} session on ${fresh.map((h) => fmt(h.d)).join(', ')}. ${s.firstName}'s session is postponed, not lost.${nextEn}`,
      titleAr: `إجازة: ${names}`,
      messageAr: `مفيش حصة ${label} يوم ${fresh.map((h) => fmtAr(h.d)).join('، ')}. حصة ${s.firstName} اتأجلت ومش ضايعة.${nextAr}`,
      relatedId: g.id,
    }), { includeStudent: true })
  } catch (err) {
    console.error('[NOTIFY_JOINER_HOLIDAYS]', err)
  }
}
