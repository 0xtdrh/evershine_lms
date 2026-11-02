/**
 * a02 M3 batch 2 — parent requests for a One-to-One and the offers to instructors. Server-only. Rules: request-rules.ts.
 * The parent's child and the instructor's own offer are checked here; staff use their places.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { loadPlaces, requestPlaces, allowsCampus } from '@/lib/places/server'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { isLevelOfferedIn } from '@/lib/delivery/catalog'
import { notifyFamilies, notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { ageOn, cairoYmd } from '@/lib/dates/cairo'
import { OneToOneError, areSiblings, createOneToOne, instructorsFor, listPrices, pickRooms, type SlotInput } from './engine'
import { pickPrice, type Plan } from './rules'
import { cleanOneToOneSettings, DEFAULT_ONE_TO_ONE_SETTINGS, nextCandidate, type OneToOneSettings } from './request-rules'

type Who = { id: string; role: string; campusId?: string | null }
const KEY = 'oneToOne.settings'

export const getOneToOneSettings = async () => cleanOneToOneSettings(await getSetting<Partial<OneToOneSettings>>(KEY, DEFAULT_ONE_TO_ONE_SETTINGS))
export async function saveOneToOneSettings(v: Partial<OneToOneSettings>, userId: string) {
  const next = cleanOneToOneSettings({ ...(await getOneToOneSettings()), ...v })
  await setSetting(KEY, next, userId)
  return next
}

const triedOf = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const slotsOf = (v: unknown): SlotInput[] => (Array.isArray(v) ? (v as SlotInput[]) : [])
const WHEN = (slots: SlotInput[]) => slots.map((s) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek]} ${s.time}`).join(', ')
const WHEN_AR = (slots: SlotInput[]) => slots.map((s) => `${['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'][s.dayOfWeek]} ${s.time}`).join('، ')

async function studentIdsOf(r: { studentId: string; siblingId: string | null }) { return [r.studentId, ...(r.siblingId ? [r.siblingId] : [])] }

async function levelLabel(levelId: string) {
  const l = await prisma.level.findUnique({ where: { id: levelId }, select: { name: true, subject: { select: { name: true } } } })
  return l ? `${l.subject?.name ?? ''} — ${l.name}` : ''
}

// ── the parent ──────────────────────────────────────────────────────────────────────────────────────────────

async function assertChild(userId: string, studentId: string) {
  const kids = await getChildrenForGuardianUser(userId)
  if (!kids.some((k) => k.id === studentId)) throw new OneToOneError('This is not your child', 403)
  return kids
}

/** What a parent may ask for: levels of the child's place with a One-to-One price, siblings, own requests. */
export async function portalOptions(userId: string, studentId: string) {
  const kids = await assertChild(userId, studentId)
  const settings = await getOneToOneSettings()
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true, dateOfBirth: true } })
  if (!student) throw new OneToOneError('Student not found', 404)
  const prices = await listPrices()
  const here = prices.filter((p) => p.scopeKey === student.campusId || p.scopeKey === 'ALL')
  const levelIds = [...new Set(here.map((p) => p.levelId))]
  const levels = await prisma.level.findMany({ where: { id: { in: levelIds }, isActive: true }, select: { id: true, name: true, order: true, subject: { select: { name: true } } }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] })
  const offered = []
  for (const l of levels) {
    if (!(await isLevelOfferedIn(l.id, student.campusId))) continue
    const rows = here.filter((p) => p.levelId === l.id)
    // the place's row wins for the same plan + size
    const key = (p: (typeof rows)[number]) => `${p.plan}|${p.plan === 'SESSION' ? 1 : p.sessions}`
    const own = new Set(rows.filter((p) => p.scopeKey !== 'ALL').map(key))
    const plans = rows.filter((p) => p.scopeKey !== 'ALL' || !own.has(key(p))).map((p) => ({ plan: p.plan, sessions: p.sessions, price: p.price, siblingPrice: p.siblingPrice, minutes: p.minutes }))
    offered.push({ id: l.id, name: l.name, course: l.subject?.name ?? '', plans })
  }
  const dob = student.dateOfBirth
  const age = dob ? ageOn(dob, cairoYmd()) : null
  return {
    open: settings.portalOpen, parentPicksInstructor: settings.parentPicksInstructor, parentPresentUnderAge: settings.parentPresentUnderAge,
    age, levels: offered,
    siblings: kids.filter((k) => k.id !== studentId).map((k) => ({ id: k.id, name: `${k.firstName} ${k.lastName}`.trim() })),
    requests: await parentRequests(userId),
  }
}

/** Can this time be served? How many instructors are free (names only if the setting allows). */
export async function portalCheck(userId: string, i: { studentId: string; levelId: string; slots: SlotInput[] }) {
  await assertChild(userId, i.studentId)
  const student = await prisma.student.findUnique({ where: { id: i.studentId }, select: { campusId: true } })
  const free = student ? await instructorsFor({ campusId: student.campusId, levelId: i.levelId, slots: i.slots }) : []
  const s = await getOneToOneSettings()
  return { available: free.length, teachers: s.parentPicksInstructor ? free : [] }
}

export async function parentRequests(userId: string) {
  const kids = await getChildrenForGuardianUser(userId)
  const ids = kids.map((k) => k.id)
  if (!ids.length) return []
  const rows = await prisma.oneToOneRequest.findMany({ where: { studentId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 30 })
  const name = new Map(kids.map((k) => [k.id, `${k.firstName} ${k.lastName}`.trim()]))
  const out = []
  for (const r of rows) {
    out.push({
      id: r.id, state: r.state, plan: r.plan, sessions: r.sessions, slots: r.slots, level: await levelLabel(r.levelId), createdAt: r.createdAt,
      students: [name.get(r.studentId) ?? '', ...(r.siblingId ? [name.get(r.siblingId) ?? ''] : [])],
    })
  }
  return out
}

export interface RequestInput { studentId: string; siblingId?: string | null; levelId: string; plan: Plan; sessions?: number | null; slots: SlotInput[]; preferredTeacherId?: string | null; note?: string | null }

/** A parent asks for a One-to-One: refused at once when no instructor is free then. */
export async function createRequest(userId: string, i: RequestInput) {
  const settings = await getOneToOneSettings()
  if (!settings.portalOpen) throw new OneToOneError('Booking from the portal is closed. Please call the branch. · الحجز من البوابة مقفول، كلم الفرع.', 409, 'PORTAL_CLOSED')
  const kids = await assertChild(userId, i.studentId)
  if (i.siblingId) {
    if (!kids.some((k) => k.id === i.siblingId) || i.siblingId === i.studentId || !(await areSiblings(i.studentId, i.siblingId))) throw new OneToOneError('These two are not siblings', 409, 'NOT_SIBLINGS')
  }
  if (!i.slots.length) throw new OneToOneError('Choose the weekly time')
  const student = await prisma.student.findUnique({ where: { id: i.studentId }, select: { campusId: true } })
  if (!student) throw new OneToOneError('Student not found', 404)
  if (!pickPrice(await listPrices(i.levelId), student.campusId, i.plan, i.plan === 'SESSION' ? null : i.sessions ?? null)) throw new OneToOneError('This level has no One-to-One price for this plan · المستوى ده مالوش سعر للنظام ده', 409, 'NO_PRICE')
  const open = await prisma.oneToOneRequest.count({ where: { studentId: i.studentId, levelId: i.levelId, state: { in: ['OFFERED', 'NO_TEACHER'] } } })
  if (open) throw new OneToOneError('A request for this level is already waiting · فيه طلب للمستوى ده مستني', 409, 'ALREADY_ASKED')
  const free = await instructorsFor({ campusId: student.campusId, levelId: i.levelId, slots: i.slots })
  if (!free.length) throw new OneToOneError('No instructor is free at this time. Please choose another time. · مفيش مدرب فاضي في الميعاد ده، اختار ميعاد تاني.', 409, 'NO_TEACHER')
  const r = await prisma.oneToOneRequest.create({
    data: {
      studentId: i.studentId, siblingId: i.siblingId || null, campusId: student.campusId, levelId: i.levelId, plan: i.plan, sessions: i.sessions ?? null,
      slots: i.slots as unknown as Prisma.InputJsonValue, preferredTeacherId: settings.parentPicksInstructor ? i.preferredTeacherId || null : null, note: i.note?.slice(0, 300) || null, requestedById: userId,
    },
  })
  await advance(r.id, settings)
  return prisma.oneToOneRequest.findUniqueOrThrow({ where: { id: r.id }, select: { id: true, state: true, groupId: true } })
}

export async function cancelByParent(userId: string, id: string) {
  const r = await prisma.oneToOneRequest.findUnique({ where: { id } })
  if (!r) throw new OneToOneError('Request not found', 404)
  await assertChild(userId, r.studentId)
  const done = await prisma.oneToOneRequest.updateMany({ where: { id, state: { in: ['OFFERED', 'NO_TEACHER'] } }, data: { state: 'CANCELLED', teacherId: null, expiresAt: null } })
  if (!done.count) throw new OneToOneError('This request cannot be cancelled now', 409)
}

// ── the chain ───────────────────────────────────────────────────────────────────────────────────────────────

/** Ask the next instructor; with "assign without asking" book at once; nobody left → the staff place it. */
async function advance(id: string, settings?: OneToOneSettings) {
  const s = settings ?? (await getOneToOneSettings())
  const r = await prisma.oneToOneRequest.findUnique({ where: { id } })
  if (!r || (r.state !== 'OFFERED' && r.state !== 'NO_TEACHER')) return
  const slots = slotsOf(r.slots)
  const free = (await instructorsFor({ campusId: r.campusId, levelId: r.levelId, slots })).map((t) => t.id)
  const tried = triedOf(r.tried)
  const next = nextCandidate(free, tried, r.preferredTeacherId)
  if (!next) {
    await prisma.oneToOneRequest.update({ where: { id }, data: { state: 'NO_TEACHER', teacherId: null, expiresAt: null } })
    const staff = await usersWithPermission('one_to_one', 'create', r.campusId)
    await notifyUsers(staff, 'ONE_TO_ONE_REQUEST', { title: 'One-to-One request needs an instructor', message: `${await levelLabel(r.levelId)} · ${WHEN(slots)}`, titleAr: 'طلب One-to-One محتاج مدرب', messageAr: `${await levelLabel(r.levelId)} · ${WHEN_AR(slots)}`, relatedId: id })
    return
  }
  if (s.assignWithoutAsking) {
    try { await finish(id, next, r.requestedById) } catch (e) {
      if (!(e instanceof OneToOneError)) throw e
      await prisma.oneToOneRequest.update({ where: { id }, data: { tried: [...tried, next] } })
      await advance(id, s)
    }
    return
  }
  const expiresAt = new Date(Date.now() + s.replyHours * 3_600_000)
  await prisma.oneToOneRequest.update({ where: { id }, data: { state: 'OFFERED', teacherId: next, expiresAt } })
  const t = await prisma.teacher.findUnique({ where: { id: next }, select: { userId: true } })
  await notifyUsers([t?.userId], 'ONE_TO_ONE_OFFER', {
    title: 'New One-to-One request', message: `${await levelLabel(r.levelId)} · ${WHEN(slots)}. Please answer within ${s.replyHours} hours.`,
    titleAr: 'طلب One-to-One جديد', messageAr: `${await levelLabel(r.levelId)} · ${WHEN_AR(slots)}. رد في خلال ${s.replyHours} ساعة.`, relatedId: id,
  })
}

/** Book it with this instructor and tell the family. */
async function finish(id: string, teacherId: string, actorId: string, opts: { force?: boolean; teacherRate?: number | null } = {}) {
  const r = await prisma.oneToOneRequest.findUniqueOrThrow({ where: { id } })
  const ids = await studentIdsOf(r)
  const made = await createOneToOne({
    studentIds: ids, campusId: r.campusId, levelId: r.levelId, plan: r.plan as Plan, sessions: r.sessions, teacherId, teacherRate: opts.teacherRate,
    slots: await pickRooms(r.campusId, slotsOf(r.slots), ids.length),
  }, actorId, { sibling: ids.length === 2, force: !!opts.force })
  await prisma.oneToOneRequest.update({ where: { id }, data: { state: 'BOOKED', teacherId, expiresAt: null, groupId: made.groupId } })
  const t = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { firstName: true, lastName: true } })
  const who = `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim()
  const slots = slotsOf(r.slots)
  await notifyFamilies(ids, 'ONE_TO_ONE_BOOKED', (s) => ({
    title: 'One-to-One booked', message: `${s.firstName}: ${WHEN(slots)} with ${who}. The invoice is in your account.`,
    titleAr: 'One-to-One اتحجز', messageAr: `${s.firstName}: ${WHEN_AR(slots)} مع ${who}. الفاتورة في حسابك.`, relatedId: id,
  }))
  return made
}

/** Offers nobody answered in time go to the next instructor (runs from the badge poll and the daily job). */
export async function sweepOffers() {
  const late = await prisma.oneToOneRequest.findMany({ where: { state: 'OFFERED', expiresAt: { lt: new Date() } }, select: { id: true, teacherId: true, tried: true }, take: 50 })
  for (const r of late) {
    const moved = await prisma.oneToOneRequest.updateMany({
      where: { id: r.id, state: 'OFFERED', teacherId: r.teacherId, expiresAt: { lt: new Date() } },
      data: { tried: [...triedOf(r.tried), ...(r.teacherId ? [r.teacherId] : [])], teacherId: null, expiresAt: null },
    })
    if (moved.count) await advance(r.id)
  }
  return late.length
}

// ── the instructor ──────────────────────────────────────────────────────────────────────────────────────────

export async function myOffers(userId: string) {
  await sweepOffers()
  const t = await getTeacherByUserId(userId)
  if (!t) return []
  const rows = await prisma.oneToOneRequest.findMany({ where: { teacherId: t.id, state: 'OFFERED' }, orderBy: { expiresAt: 'asc' } })
  const out = []
  for (const r of rows) {
    const c = await prisma.campus.findUnique({ where: { id: r.campusId }, select: { name: true } })
    // first name only: the instructor sees who, not the family's details
    const kids = await prisma.student.findMany({ where: { id: { in: await studentIdsOf(r) } }, select: { firstName: true } })
    out.push({ id: r.id, level: await levelLabel(r.levelId), place: c?.name ?? '', slots: r.slots, plan: r.plan, sessions: r.sessions, expiresAt: r.expiresAt, students: kids.map((k) => k.firstName) })
  }
  return out
}

export async function answerOffer(userId: string, id: string, accept: boolean) {
  const t = await getTeacherByUserId(userId)
  const r = await prisma.oneToOneRequest.findUnique({ where: { id } })
  if (!t || !r || r.teacherId !== t.id || r.state !== 'OFFERED') throw new OneToOneError('This offer is no longer yours · العرض ده مبقاش ليك', 409, 'OFFER_GONE')
  if (r.expiresAt && r.expiresAt < new Date()) { await sweepOffers(); throw new OneToOneError('The time to answer has passed · وقت الرد عدّى', 409, 'OFFER_GONE') }
  if (accept) {
    try { await finish(id, t.id, userId); return { booked: true } } catch (e) {
      if (!(e instanceof OneToOneError)) throw e
      // he is no longer free, or the room went: pass it on and say why
      await prisma.oneToOneRequest.update({ where: { id }, data: { tried: [...triedOf(r.tried), t.id], teacherId: null, expiresAt: null } })
      await advance(id)
      throw e
    }
  }
  const moved = await prisma.oneToOneRequest.updateMany({ where: { id, state: 'OFFERED', teacherId: t.id }, data: { tried: [...triedOf(r.tried), t.id], teacherId: null, expiresAt: null } })
  if (moved.count) await advance(id)
  return { booked: false }
}

// ── the staff ───────────────────────────────────────────────────────────────────────────────────────────────

export async function staffRequests(user: Who, opts: { campusId?: string | null; all?: boolean }) {
  await sweepOffers()
  const places = await requestPlaces(user as never, opts.campusId ?? null)
  const scope = places.all ? {} : { campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }
  const rows = await prisma.oneToOneRequest.findMany({ where: { ...scope, ...(opts.all ? {} : { state: { in: ['OFFERED', 'NO_TEACHER'] } }) }, orderBy: { createdAt: 'desc' }, take: 200 })
  const out = []
  for (const r of rows) {
    const [kids, campus, teacher] = await Promise.all([
      prisma.student.findMany({ where: { id: { in: await studentIdsOf(r) } }, select: { id: true, firstName: true, lastName: true } }),
      prisma.campus.findUnique({ where: { id: r.campusId }, select: { name: true } }),
      r.teacherId ? prisma.teacher.findUnique({ where: { id: r.teacherId }, select: { firstName: true, lastName: true } }) : null,
    ])
    out.push({
      id: r.id, state: r.state, plan: r.plan, sessions: r.sessions, slots: r.slots, note: r.note, expiresAt: r.expiresAt, createdAt: r.createdAt, campusId: r.campusId, levelId: r.levelId, groupId: r.groupId,
      level: await levelLabel(r.levelId), place: campus?.name ?? '', teacher: teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : null, triedCount: triedOf(r.tried).length,
      students: kids.map((k) => ({ id: k.id, name: `${k.firstName} ${k.lastName}`.trim() })),
    })
  }
  return out
}

async function assertStaffRequest(user: Who, id: string) {
  const r = await prisma.oneToOneRequest.findUnique({ where: { id } })
  if (!r) throw new OneToOneError('Request not found', 404)
  if (!allowsCampus(await loadPlaces(user as never), r.campusId)) throw new OneToOneError('This request is not in your places', 403)
  if (r.state !== 'OFFERED' && r.state !== 'NO_TEACHER') throw new OneToOneError('This request is closed', 409)
  return r
}

/** Staff choose the instructor themselves (no asking). */
export async function staffAssign(user: Who, id: string, teacherId: string, opts: { force?: boolean; teacherRate?: number | null }) {
  await assertStaffRequest(user, id)
  return finish(id, teacherId, user.id, { force: !!opts.force && user.role === 'SUPER_ADMIN', teacherRate: opts.teacherRate })
}

export async function staffCancel(user: Who, id: string) {
  const r = await assertStaffRequest(user, id)
  await prisma.oneToOneRequest.update({ where: { id }, data: { state: 'CANCELLED', teacherId: null, expiresAt: null } })
  await notifyFamilies(await studentIdsOf(r), 'ONE_TO_ONE_BOOKED', (s) => ({
    title: 'One-to-One request closed', message: `${s.firstName}: the request was closed. Please call the branch.`, titleAr: 'طلب One-to-One اتقفل', messageAr: `${s.firstName}: الطلب اتقفل، كلم الفرع.`, relatedId: id,
  }))
}
