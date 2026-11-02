/**
 * a02 M3 batch 3 part 2 — the sessions of a One-to-One: postpone (24 h, 2 a month, settings), instructor apology (cancelled, then the
 * family or the staff choose a substitute or a new date), no-shows (paid in part, too many release the fixed time). Server-only.
 * Sessions stay in the shared calendar: a postponement = CancelledSession + ExtraSession, a substitute = the normal substitute flow.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cairoDateTimeToUtc, cairoToday } from '@/lib/dates/cairo'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { teacherFreeFor } from '@/lib/teachers/availability'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { allowsCampus, canSeeGroup, loadPlaces, requestPlaces } from '@/lib/places/server'
import { notifyFamilies, notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { OneToOneError } from './engine'
import { getOneToOneSettings } from './settings'
import { KIND_ONE_TO_ONE } from './rules'
import { holdOver, noShowDays, postponeProblem } from './request-rules'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'

type Who = { id: string; role: string; campusId?: string | null }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const date = (d: string) => new Date(`${d}T00:00:00.000Z`)
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const inDays = (d: string, n: number) => ymd(new Date(date(d).getTime() + n * 86_400_000))

async function groupOf(id: string) {
  const g = await prisma.classSection.findUnique({
    where: { id },
    select: { id: true, kind: true, status: true, campusId: true, className: true, scheduleSlots: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } }, subjectOfferings: { where: { teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { teacherId: true, teacher: { select: { userId: true } } } } },
  })
  if (!g || g.kind !== KIND_ONE_TO_ONE) throw new OneToOneError('One-to-One not found', 404)
  return g
}

/** The coming sessions of One-to-Ones. */
export async function upcomingOf(groupIds: string[], days = 75) {
  const out = new Map<string, { date: string; time: string; mode: string; minutes: number | null }[]>()
  if (!groupIds.length) return out
  const today = cairoToday()
  const lengths = await prisma.oneToOneEvent.findMany({ where: { classSectionId: { in: groupIds }, kind: 'MINUTES', date: { gte: date(today) } }, select: { classSectionId: true, date: true, minutes: true } })
  for (const g of await occurrencesFor({ groupIds }, today, inDays(today, days))) {
    const own = new Map(lengths.filter((l) => l.classSectionId === g.id).map((l) => [ymd(l.date), l.minutes]))
    out.set(g.id, // a One-to-One that has not had its first session yet shows as NOT_STARTED
      g.occurrences.filter((o) => (o.status === 'SCHEDULED' || o.status === 'NOT_STARTED') && !!o.time).map((o) => ({ date: o.date, time: o.time, mode: o.mode, minutes: own.get(o.date) ?? null })).slice(0, 8))
  }
  return out
}

const usedThisMonth = (groupId: string, day: string) => {
  const from = date(`${day.slice(0, 7)}-01`)
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
  return prisma.oneToOneEvent.count({ where: { classSectionId: groupId, kind: 'POSTPONE', countsAgainstParent: true, date: { gte: from, lt: to } } })
}

async function placeNewSession(g: Awaited<ReturnType<typeof groupOf>>, oldDate: string, newDate: string, newTime: string) {
  if (!DAY.test(newDate) || !TIME.test(newTime)) throw new OneToOneError('Choose the new date and time · اختار الميعاد الجديد')
  if (newDate <= cairoToday()) throw new OneToOneError('The new date must be in the future · الميعاد الجديد لازم يكون جاي')
  if (newDate === oldDate) throw new OneToOneError('Choose another date · اختار يوم تاني')
  const teacherId = g.subjectOfferings[0]?.teacherId
  const dayOfWeek = date(newDate).getUTCDay()
  if (teacherId && !(await teacherFreeFor(teacherId, { dayOfWeek, time: newTime, campusId: g.campusId }, g.id))) throw new OneToOneError('The instructor is not free at this time · المدرب مش فاضي في الميعاد ده', 409, 'TEACHER_PROBLEM')
  if (await prisma.extraSession.findUnique({ where: { classSectionId_date: { classSectionId: g.id, date: date(newDate) } }, select: { id: true } })) throw new OneToOneError('There is already a session that day · فيه حصة في اليوم ده', 409)
}

/** Move one coming session. Parents always within the rules; staff may override them (it then does not use up the parent's postponements). */
export async function postpone(actorId: string, groupId: string, i: { date: string; newDate: string; newTime: string; override?: boolean }) {
  const g = await groupOf(groupId)
  const s = (await upcomingOf([groupId])).get(groupId)?.find((x) => x.date === i.date)
  if (!s) throw new OneToOneError('This session is not one of the coming sessions · الحصة دي مش من الحصص الجاية', 409)
  const settings = await getOneToOneSettings()
  const hoursBefore = (cairoDateTimeToUtc(s.date, s.time).getTime() - Date.now()) / 3_600_000
  const used = await usedThisMonth(groupId, i.date)
  const problem = postponeProblem(hoursBefore, used, settings)
  if (problem && !i.override) throw new OneToOneError(problem, 409, 'POSTPONE_REFUSED')
  await placeNewSession(g, i.date, i.newDate, i.newTime)
  await prisma.$transaction([
    prisma.cancelledSession.upsert({ where: { classSectionId_date: { classSectionId: groupId, date: date(i.date) } }, create: { classSectionId: groupId, date: date(i.date), reason: 'One-to-One postponed', cancelledBy: actorId }, update: {} }),
    prisma.extraSession.create({ data: { classSectionId: groupId, date: date(i.newDate), time: i.newTime, reason: 'One-to-One postponed', createdById: actorId } }),
    prisma.oneToOneEvent.create({ data: { classSectionId: groupId, date: date(i.date), kind: 'POSTPONE', state: 'DONE', newDate: date(i.newDate), newTime: i.newTime, countsAgainstParent: !i.override, createdById: actorId } }),
  ])
  await notifyUsers([g.subjectOfferings[0]?.teacher?.userId], 'ONE_TO_ONE_OFFER', { title: 'One-to-One session moved', message: `${g.className}: ${i.date} → ${i.newDate} ${i.newTime}`, titleAr: 'حصة One-to-One اتأجلت', messageAr: `${g.className}: ${i.date} ← ${i.newDate} ${i.newTime}`, relatedId: groupId })
  await notifyFamilies(g.enrollments.map((e) => e.studentId), 'ONE_TO_ONE_SESSION', (st) => ({ title: 'One-to-One session moved', message: `${st.firstName}: ${i.date} moved to ${i.newDate} ${i.newTime}`, titleAr: 'حصة One-to-One اتأجلت', messageAr: `${st.firstName}: حصة ${i.date} بقت ${i.newDate} ${i.newTime}`, relatedId: groupId }))
  return { used: used + (i.override ? 0 : 1), left: Math.max(0, settings.postponesPerMonth - used - (i.override ? 0 : 1)) }
}

/** The instructor cannot come: the session is cancelled at once and the family chooses a substitute or a new date. */
export async function apologize(userId: string, groupId: string, day: string, reason: string) {
  const t = await getTeacherByUserId(userId)
  const g = await groupOf(groupId)
  if (!t || g.subjectOfferings[0]?.teacherId !== t.id) throw new OneToOneError('This One-to-One is not yours', 403)
  if (!(await upcomingOf([groupId])).get(groupId)?.some((x) => x.date === day)) throw new OneToOneError('This session is not one of the coming sessions · الحصة دي مش من الحصص الجاية', 409)
  await prisma.$transaction([
    prisma.cancelledSession.upsert({ where: { classSectionId_date: { classSectionId: groupId, date: date(day) } }, create: { classSectionId: groupId, date: date(day), reason: `Instructor apology: ${reason}`.slice(0, 190), cancelledBy: userId }, update: {} }),
    prisma.oneToOneEvent.create({ data: { classSectionId: groupId, date: date(day), kind: 'APOLOGY', state: 'OPEN', note: reason.slice(0, 300), countsAgainstParent: false, createdById: userId } }),
  ])
  await notifyFamilies(g.enrollments.map((e) => e.studentId), 'ONE_TO_ONE_SESSION', (st) => ({ title: 'The instructor cannot come', message: `${st.firstName}: the session of ${day} is cancelled. Choose a substitute or a new date in My Children → One-to-One.`, titleAr: 'المدرب اعتذر', messageAr: `${st.firstName}: حصة ${day} اتلغت. اختار مدرب بديل أو ميعاد جديد من أبنائي ← One-to-One.`, relatedId: groupId }))
  await notifyUsers(await usersWithPermission('one_to_one', 'create', g.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One: instructor apology', message: `${g.className} · ${day}`, titleAr: 'One-to-One: المدرب اعتذر', messageAr: `${g.className} · ${day}`, relatedId: groupId })
}

async function openEvent(id: string) {
  const e = await prisma.oneToOneEvent.findUnique({ where: { id } })
  if (!e) throw new OneToOneError('Not found', 404)
  return e
}

/** Family or staff answer an apology: a new date now (it never counts against the family), or ask the staff for a substitute. */
export async function answerApology(actorId: string, id: string, i: { choice: 'POSTPONE' | 'SUBSTITUTE'; newDate?: string; newTime?: string }) {
  const e = await openEvent(id)
  if (e.kind !== 'APOLOGY' || e.state !== 'OPEN') throw new OneToOneError('This was already answered · ده اترد عليه', 409)
  const g = await groupOf(e.classSectionId)
  if (i.choice === 'SUBSTITUTE') {
    await prisma.oneToOneEvent.update({ where: { id }, data: { state: 'WAITING_SUB', choice: 'SUBSTITUTE' } })
    await notifyUsers(await usersWithPermission('one_to_one', 'create', g.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One needs a substitute', message: `${g.className} · ${ymd(e.date)}`, titleAr: 'One-to-One محتاج مدرب بديل', messageAr: `${g.className} · ${ymd(e.date)}`, relatedId: id })
    return
  }
  await placeNewSession(g, ymd(e.date), i.newDate ?? '', i.newTime ?? '')
  await prisma.$transaction([
    prisma.extraSession.create({ data: { classSectionId: g.id, date: date(i.newDate!), time: i.newTime!, reason: 'Instructor apology', createdById: actorId } }),
    prisma.oneToOneEvent.update({ where: { id }, data: { state: 'DONE', choice: 'POSTPONE', newDate: date(i.newDate!), newTime: i.newTime! } }),
  ])
  await notifyUsers([g.subjectOfferings[0]?.teacher?.userId], 'ONE_TO_ONE_OFFER', { title: 'One-to-One: new date', message: `${g.className}: ${i.newDate} ${i.newTime}`, titleAr: 'One-to-One: ميعاد جديد', messageAr: `${g.className}: ${i.newDate} ${i.newTime}`, relatedId: g.id })
}

/** Staff name the substitute: the session is back on and goes through the normal substitute flow (he must accept). */
export async function assignSubstitute(user: Who, id: string, substituteId: string) {
  const e = await openEvent(id)
  if (e.kind !== 'APOLOGY' || (e.state !== 'OPEN' && e.state !== 'WAITING_SUB')) throw new OneToOneError('This was already answered · ده اترد عليه', 409)
  const g = await groupOf(e.classSectionId)
  if (!allowsCampus(await loadPlaces(user as never), g.campusId)) throw new OneToOneError('This One-to-One is not in your places', 403)
  const original = g.subjectOfferings[0]?.teacherId
  if (!original || original === substituteId) throw new OneToOneError('Choose another instructor · اختار مدرب تاني')
  const sub = await prisma.teacher.findUnique({ where: { id: substituteId }, select: { userId: true } })
  if (!sub) throw new OneToOneError('Instructor not found', 404)
  const slot = cleanSlots(g.scheduleSlots).find((s) => s.dayOfWeek === e.date.getUTCDay())
  if (slot && !(await teacherFreeFor(substituteId, { dayOfWeek: slot.dayOfWeek, time: slot.time, campusId: g.campusId }))) throw new OneToOneError('This instructor is not free then · المدرب ده مش فاضي وقتها', 409, 'TEACHER_PROBLEM')
  await prisma.$transaction(async (tx) => {
    await tx.cancelledSession.deleteMany({ where: { classSectionId: g.id, date: e.date } })
    const absence = await tx.teacherAbsence.create({ data: { teacherId: original, date: e.date, scope: 'SINGLE_SESSION', classSectionId: g.id, reason: e.note || 'One-to-One apology', status: 'APPROVED', respondedBy: user.id, respondedAt: new Date() } })
    await tx.substituteAssignment.create({ data: { teacherAbsenceId: absence.id, classSectionId: g.id, date: e.date, originalTeacherId: original, substituteTeacherId: substituteId, assignedBy: user.id } })
    await tx.oneToOneEvent.update({ where: { id }, data: { state: 'DONE', choice: 'SUBSTITUTE' } })
  })
  await notifyUsers([sub.userId], 'ONE_TO_ONE_OFFER', { title: 'One-to-One: please cover a session', message: `${g.className} · ${ymd(e.date)}. Accept it in My Substitutions.`, titleAr: 'One-to-One: مطلوب تغطية حصة', messageAr: `${g.className} · ${ymd(e.date)}. وافق من البدلاء بتوعي.`, relatedId: g.id })
}

/** Too many no-shows release the fixed time (runs after attendance is saved). The student stays; staff set a new time. */
export async function releaseAfterNoShows(groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, className: true, campusId: true, scheduleSlots: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } })
  if (!g || g.kind !== KIND_ONE_TO_ONE || !cleanSlots(g.scheduleSlots).length) return false
  const settings = await getOneToOneSettings()
  const rows = await prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollment: { classSectionId: groupId } }, select: { attendanceDate: true, status: true } })
  const missed = noShowDays(rows.map((r) => ({ date: ymd(r.attendanceDate), status: r.status })))
  if (missed.size < settings.noShowLimit) return false
  await prisma.$transaction([
    prisma.classSection.update({ where: { id: groupId }, data: { scheduleSlots: Prisma.DbNull } }),
    prisma.oneToOneEvent.create({ data: { classSectionId: groupId, date: date(cairoToday()), kind: 'RELEASE', state: 'OPEN', note: `${missed.size} no-shows`, countsAgainstParent: false } }),
  ])
  await notifyFamilies(g.enrollments.map((e) => e.studentId), 'ONE_TO_ONE_SESSION', (st) => ({ title: 'One-to-One: the fixed time is no longer held', message: `${st.firstName}: after ${missed.size} sessions missed without notice the fixed time was released. Please contact the branch.`, titleAr: 'One-to-One: الميعاد الثابت اتلغى', messageAr: `${st.firstName}: بعد ${missed.size} حصص غياب من غير إبلاغ الميعاد الثابت اتلغى. كلم الفرع.`, relatedId: groupId }))
  await notifyUsers(await usersWithPermission('one_to_one', 'create', g.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One: fixed time released', message: g.className, titleAr: 'One-to-One: الميعاد الثابت اتلغى', messageAr: g.className, relatedId: groupId })
  return true
}

// ── lists for the screens ───────────────────────────────────────────────────────────────────────────────────

export async function familySessions(userId: string, studentId: string) {
  const kids = await getChildrenForGuardianUser(userId)
  if (!kids.some((k) => k.id === studentId)) throw new OneToOneError('This is not your child', 403)
  const groups = await prisma.classSection.findMany({ where: { kind: KIND_ONE_TO_ONE, status: 'ACTIVE', isActive: true, enrollments: { some: { studentId, status: 'ACTIVE' } } }, select: { id: true, className: true, level: { select: { name: true, subject: { select: { name: true } } } } } })
  const up = await upcomingOf(groups.map((g) => g.id))
  const settings = await getOneToOneSettings()
  const today = cairoToday()
  const out = []
  for (const g of groups) {
    const events = await prisma.oneToOneEvent.findMany({ where: { classSectionId: g.id, kind: 'APOLOGY', state: 'OPEN' }, select: { id: true, date: true, note: true } })
    out.push({
      id: g.id, level: g.level ? `${g.level.subject?.name ?? ''} — ${g.level.name}` : g.className, sessions: up.get(g.id) ?? [],
      postponesLeft: Math.max(0, settings.postponesPerMonth - (await usedThisMonth(g.id, today))), postponesPerMonth: settings.postponesPerMonth, cancelHours: settings.cancelHours,
      apologies: events.map((e) => ({ id: e.id, date: ymd(e.date) })),
    })
  }
  return out
}

export async function assertFamilyGroup(userId: string, groupId: string) {
  const kids = await getChildrenForGuardianUser(userId)
  const n = await prisma.studentEnrollment.count({ where: { classSectionId: groupId, status: 'ACTIVE', studentId: { in: kids.map((k) => k.id) } } })
  if (!n) throw new OneToOneError('This is not your child', 403)
}

export async function assertFamilyEvent(userId: string, eventId: string) {
  await assertFamilyGroup(userId, (await openEvent(eventId)).classSectionId)
}

export async function teacherSessions(userId: string) {
  const t = await getTeacherByUserId(userId)
  if (!t) return []
  const groups = await prisma.classSection.findMany({ where: { kind: KIND_ONE_TO_ONE, status: 'ACTIVE', isActive: true, subjectOfferings: { some: { teacherId: t.id } } }, select: { id: true, className: true } })
  const up = await upcomingOf(groups.map((g) => g.id))
  return groups.map((g) => ({ id: g.id, name: g.className, sessions: up.get(g.id) ?? [] }))
}

/** Apologies and released times the staff should look at. */
export async function staffEvents(user: Who, opts: { campusId?: string | null } = {}) {
  const places = await requestPlaces(user as never, opts.campusId ?? null)
  const rows = await prisma.oneToOneEvent.findMany({ where: { state: { in: ['OPEN', 'WAITING_SUB'] } }, orderBy: { createdAt: 'desc' }, take: 200 })
  const out = []
  for (const e of rows) {
    const g = await prisma.classSection.findUnique({ where: { id: e.classSectionId }, select: { id: true, className: true, campusId: true, levelId: true, scheduleSlots: true } })
    if (!g || !(places.all || places.campusIds.includes(g.campusId))) continue
    out.push({ id: e.id, kind: e.kind, state: e.state, date: ymd(e.date), note: e.note, groupId: g.id, name: g.className, campusId: g.campusId, levelId: g.levelId, slots: cleanSlots(g.scheduleSlots).filter((s) => s.dayOfWeek === e.date.getUTCDay()) })
  }
  return out
}

export async function assertStaffEvent(user: Who, id: string) {
  const e = await openEvent(id)
  if (!(await canSeeGroup(user as never, e.classSectionId))) throw new OneToOneError('This One-to-One is not in your places', 403)
}

export async function closeEvent(user: Who, id: string) {
  await assertStaffEvent(user, id)
  await prisma.oneToOneEvent.update({ where: { id }, data: { state: 'DONE' } })
}

/** Change the length of one coming session (the level's and the One-to-One's length stay). */
export async function setSessionLength(actorId: string, groupId: string, day: string, minutes: number | null) {
  await groupOf(groupId)
  await prisma.oneToOneEvent.deleteMany({ where: { classSectionId: groupId, kind: 'MINUTES', date: date(day) } })
  if (minutes) await prisma.oneToOneEvent.create({ data: { classSectionId: groupId, date: date(day), kind: 'MINUTES', state: 'DONE', minutes, createdById: actorId } })
}

/** The family asks for another time or instructor; the staff do it. */
export async function askChange(userId: string, groupId: string, note: string) {
  const g = await groupOf(groupId)
  if (await prisma.oneToOneEvent.count({ where: { classSectionId: groupId, kind: 'CHANGE', state: 'OPEN' } })) throw new OneToOneError('A request is already waiting · فيه طلب مستني', 409, 'ALREADY_ASKED')
  await prisma.oneToOneEvent.create({ data: { classSectionId: groupId, date: date(cairoToday()), kind: 'CHANGE', state: 'OPEN', note: note.slice(0, 300), createdById: userId } })
  await notifyUsers(await usersWithPermission('one_to_one', 'create', g.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One: the family asks for a change', message: `${g.className}: ${note}`.slice(0, 180), titleAr: 'One-to-One: الأهل طالبين تغيير', messageAr: `${g.className}: ${note}`.slice(0, 180), relatedId: groupId })
}

/** A finished cycle nobody renewed gives up its fixed time after the hold days (daily job). */
export async function sweepHolds() {
  const settings = await getOneToOneSettings()
  const today = cairoToday()
  const groups = await prisma.classSection.findMany({ where: { kind: KIND_ONE_TO_ONE, status: 'ACTIVE', isActive: true, NOT: { scheduleSlots: { equals: Prisma.DbNull } } }, select: { id: true, className: true, campusId: true, cycleSessions: true, scheduleSlots: true, level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } }, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } })
  let released = 0
  for (const g of groups) {
    if (!g.level || !cleanSlots(g.scheduleSlots).length) continue
    const held = await prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollment: { classSectionId: g.id } }, select: { attendanceDate: true }, distinct: ['attendanceDate'], orderBy: { attendanceDate: 'desc' } })
    if (held.length < sessionsPerCycle(g.level, g.cycleSessions) || !holdOver(ymd(held[0].attendanceDate), today, settings.holdDays)) continue
    await prisma.$transaction([
      prisma.classSection.update({ where: { id: g.id }, data: { scheduleSlots: Prisma.DbNull } }),
      prisma.oneToOneEvent.create({ data: { classSectionId: g.id, date: date(today), kind: 'RELEASE', state: 'OPEN', note: 'Not renewed in time' } }),
    ])
    await notifyFamilies(g.enrollments.map((e) => e.studentId), 'ONE_TO_ONE_SESSION', (st) => ({ title: 'One-to-One: the fixed time is no longer held', message: `${st.firstName}: the cycle ended and was not renewed in time. Please contact the branch.`, titleAr: 'One-to-One: الميعاد الثابت اتلغى', messageAr: `${st.firstName}: الدورة خلصت وماتجددتش في الوقت. كلم الفرع.`, relatedId: g.id }))
    await notifyUsers(await usersWithPermission('one_to_one', 'create', g.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One: fixed time released', message: g.className, titleAr: 'One-to-One: الميعاد الثابت اتلغى', messageAr: g.className, relatedId: g.id })
    released++
  }
  return released
}

/** The substitute said no: the apology is open again for the staff (never breaks his answer). */
export async function substituteDeclined(groupId: string, day: Date) {
  try {
    const moved = await prisma.oneToOneEvent.updateMany({ where: { classSectionId: groupId, kind: 'APOLOGY', date: day, state: 'DONE', choice: 'SUBSTITUTE' }, data: { state: 'WAITING_SUB' } })
    if (!moved.count) return
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { className: true, campusId: true } })
    await notifyUsers(await usersWithPermission('one_to_one', 'create', g?.campusId), 'ONE_TO_ONE_REQUEST', { title: 'One-to-One: the substitute said no', message: `${g?.className ?? ''} · ${ymd(day)}`, titleAr: 'One-to-One: البديل اعتذر', messageAr: `${g?.className ?? ''} · ${ymd(day)}`, relatedId: groupId })
  } catch (err) {
    console.error('[ONE_TO_ONE_SUB_DECLINED]', err)
  }
}
