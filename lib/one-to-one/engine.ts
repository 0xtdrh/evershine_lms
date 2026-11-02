/**
 * a02 M3 One-to-One — price list, who can teach it, booking, the list and what carries into the next cycle. Server-only.
 * Booking calls the SAME group routes the screens use (create, schedule, instructor, add student), so every rule applies:
 * where offered, allowed ways, rooms, instructor hours / clashes, invoices, wallet. Rules: lib/one-to-one/rules.ts.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { allowsCampus, canSeeGroup, canSeeStudent, groupWhere, loadPlaces, requestPlaces, teachersOfPlaceWhere } from '@/lib/places/server'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { teacherFreeFor } from '@/lib/teachers/availability'
import { callRoute } from '@/lib/api/call-route'
import { POST as createGroup } from '@/app/api/groups/route'
import { PATCH as patchGroup } from '@/app/api/groups/[id]/route'
import { POST as setInstructor } from '@/app/api/groups/[id]/instructor/route'
import { POST as addStudent } from '@/app/api/groups/[id]/students/route'
import { KIND_ONE_TO_ONE, SECTION_NAME, levelFinished, nameFor, pickPrice, quote, type Plan, type PriceRow } from './rules'
import type { Mode } from '@/lib/delivery/modes'

type Who = { id: string; role: string; campusId?: string | null }
export class OneToOneError extends Error {
  constructor(message: string, public status = 400, public code: string | null = null) { super(message) }
}

const num = (v: unknown) => (v != null ? Number(v) : null)
const row = (r: { id: string; levelId: string; scopeKey: string; plan: string; sessions: number; price: unknown; siblingPrice: unknown; minutes: number | null }): PriceRow => ({ ...r, price: Number(r.price), siblingPrice: num(r.siblingPrice) })

// ── price list ──────────────────────────────────────────────────────────────────────────────────────────────

export async function listPrices(levelId?: string | null) {
  const rows = await prisma.oneToOnePrice.findMany({
    where: { isActive: true, ...(levelId && { levelId }) }, orderBy: [{ levelId: 'asc' }, { plan: 'asc' }, { sessions: 'asc' }],
  })
  return rows.map(row)
}

export interface PriceInput { levelId: string; campusId?: string | null; plan: Plan; sessions?: number | null; price: number; siblingPrice?: number | null; minutes?: number | null }

export async function savePrice(user: Who, i: PriceInput) {
  const places = await loadPlaces(user as never)
  if (i.campusId ? !allowsCampus(places, i.campusId) : !places.all) throw new OneToOneError('Choose one of your places (a price for everywhere needs every place)', 403)
  const level = await prisma.level.findUnique({ where: { id: i.levelId }, select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } })
  if (!level) throw new OneToOneError('Level not found', 404)
  // MONTH = the level's sessions of a month unless given; SESSION = one session; PACKAGE needs its size
  const sessions = i.plan === 'SESSION' ? 1 : i.plan === 'MONTH' ? (i.sessions || sessionsPerCycle(level)) : i.sessions
  if (!sessions || sessions < 1) throw new OneToOneError('Write how many sessions the package has')
  const scopeKey = i.campusId || 'ALL'
  const data = { price: i.price, siblingPrice: i.siblingPrice ?? null, minutes: i.minutes ?? null, isActive: true }
  return row(await prisma.oneToOnePrice.upsert({
    where: { levelId_scopeKey_plan_sessions: { levelId: i.levelId, scopeKey, plan: i.plan, sessions } },
    create: { levelId: i.levelId, scopeKey, plan: i.plan, sessions, ...data }, update: data,
  }))
}

export async function removePrice(user: Who, id: string) {
  const r = await prisma.oneToOnePrice.findUnique({ where: { id } })
  if (!r) throw new OneToOneError('Price not found', 404)
  const places = await loadPlaces(user as never)
  if (r.scopeKey === 'ALL' ? !places.all : !allowsCampus(places, r.scopeKey)) throw new OneToOneError('This price is not in your places', 403)
  await prisma.oneToOnePrice.delete({ where: { id } })
}

// ── who can teach it ────────────────────────────────────────────────────────────────────────────────────────

export interface SlotInput { dayOfWeek: number; time: string; mode?: Mode; roomId?: string | null }

/** Instructors of this place, qualified for the level (track, course or level) and free at every chosen time. */
export async function instructorsFor(i: { campusId: string; levelId: string; slots: SlotInput[] }) {
  const level = await prisma.level.findUnique({ where: { id: i.levelId }, select: { subjectId: true, subject: { select: { trackId: true } } } })
  if (!level) return []
  const qualified = await prisma.teacherQualifiedSubject.findMany({
    where: { OR: [{ levelId: i.levelId }, { subjectId: level.subjectId }, ...(level.subject.trackId ? [{ trackId: level.subject.trackId }] : [])] },
    select: { teacherId: true },
  })
  const teachers = await prisma.teacher.findMany({
    where: { AND: [teachersOfPlaceWhere(i.campusId), { id: { in: [...new Set(qualified.map((q) => q.teacherId))] }, isActive: true }] },
    select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' },
  })
  const out = []
  for (const t of teachers) {
    let free = true
    for (const s of i.slots) {
      if (!(await teacherFreeFor(t.id, { dayOfWeek: s.dayOfWeek, time: s.time, campusId: i.campusId, mode: s.mode }))) { free = false; break }
    }
    if (free) out.push({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim() })
  }
  return out
}

// ── booking ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface BookInput {
  studentIds: string[]; campusId: string; levelId: string; plan: Plan; sessions?: number | null
  slots: SlotInput[]; teacherId: string; payment?: 'FULL' | 'INSTALLMENTS'; teacherRate?: number | null; minutes?: number | null; force?: boolean
}
export interface HttpCtx { origin: string; cookie: string }

async function freeName(campusId: string, base: string) {
  let name = base
  for (let n = 2; await prisma.classSection.findFirst({ where: { campusId, className: name, sectionName: SECTION_NAME }, select: { id: true } }); n++) name = `${base.slice(0, 45)} #${n}`
  return name
}

/** Book a One-to-One: one student, or two siblings in the same level sharing the same session. */
export async function book(user: Who, ctx: HttpCtx, i: BookInput) {
  const ids = [...new Set(i.studentIds)]
  if (ids.length < 1 || ids.length > 2) throw new OneToOneError('Choose one student, or two siblings for the same session')
  if (!i.slots.length) throw new OneToOneError('Choose the weekly time')
  const students = await prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, guardians: { select: { id: true } }, parents: { select: { id: true } } } })
  if (students.length !== ids.length) throw new OneToOneError('Student not found', 404)
  for (const s of students) if (!(await canSeeStudent(user as never, s.id))) throw new OneToOneError('This student is not in your places', 403)
  const sibling = students.length === 2
  if (sibling) {
    const fam = (s: (typeof students)[number]) => new Set([...s.guardians.map((g) => g.id), ...s.parents.map((p) => p.id)])
    const a = fam(students[0])
    if (![...fam(students[1])].some((x) => a.has(x))) throw new OneToOneError('These two students are not siblings. Book them separately.', 409, 'NOT_SIBLINGS')
  }
  const level = await prisma.level.findUnique({ where: { id: i.levelId }, select: { name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true } })
  if (!level) throw new OneToOneError('Level not found', 404)
  const priced = pickPrice(await listPrices(i.levelId), i.campusId, i.plan, i.plan === 'SESSION' ? null : i.sessions ?? null)
  if (!priced) throw new OneToOneError('This level has no One-to-One price for this plan yet (One-to-One → Prices)', 409, 'NO_PRICE')
  const q = quote(priced, i.sessions ?? null, sibling)

  const call = (h: unknown, path: string, method: string, body: unknown, params?: Record<string, string>) => callRoute(h as never, ctx.origin, ctx.cookie, path, method, body, params)
  const made = await call(createGroup, '/api/groups', 'POST', {
    campusId: i.campusId, levelId: i.levelId, className: await freeName(i.campusId, nameFor(students, level.name)), sectionName: SECTION_NAME, maxStudents: students.length,
    requireFullPaymentToStart: i.payment !== 'INSTALLMENTS', installmentsAllowed: i.payment === 'INSTALLMENTS',
  })
  if (!made.ok || !made.data) throw new OneToOneError(made.message, made.status, made.code)
  const groupId = String(made.data.id)
  try {
    // before students join: their invoices read this price
    await prisma.classSection.update({
      where: { id: groupId },
      data: { kind: KIND_ONE_TO_ONE, oneToOnePlan: i.plan, cycleSessions: q.sessions, priceOverride: q.amount, sessionMinutes: i.minutes ?? priced.minutes ?? null },
    })
    const sch = await call(patchGroup, `/api/groups/${groupId}`, 'PATCH', { scheduleSlots: i.slots.map((s) => ({ dayOfWeek: s.dayOfWeek, time: s.time, mode: s.mode ?? 'BRANCH', ...(s.roomId && { roomId: s.roomId }) })), ...(i.force && { forceRooms: true }) }, { id: groupId })
    if (!sch.ok) throw new OneToOneError(sch.message, sch.status, sch.code)
    const tch = await call(setInstructor, `/api/groups/${groupId}/instructor`, 'POST', { teacherId: i.teacherId, ...(i.force && { force: true }) }, { id: groupId })
    if (!tch.ok) throw new OneToOneError(tch.message, tch.status, tch.code)
    if (i.teacherRate != null) await prisma.subjectOffering.updateMany({ where: { classSectionId: groupId, teacherId: i.teacherId }, data: { overrideOneToOnePerSession: i.teacherRate } })
  } catch (e) {
    // nothing half-made stays behind (no student joined yet, so no invoice exists)
    await prisma.subjectOffering.deleteMany({ where: { classSectionId: groupId } }).catch(() => {})
    await prisma.classSection.delete({ where: { id: groupId } }).catch(() => {})
    throw e
  }
  for (const s of students) {
    const added = await call(addStudent, `/api/groups/${groupId}/students`, 'POST', { studentId: s.id }, { id: groupId })
    if (!added.ok) throw new OneToOneError(`${s.firstName}: ${added.message}`, added.status, added.code)
  }
  return { groupId, amountEach: q.amount, sessions: q.sessions, sibling }
}

// ── the list ────────────────────────────────────────────────────────────────────────────────────────────────

export async function listOneToOne(user: Who, opts: { campusId?: string | null; status?: string | null }) {
  const places = await requestPlaces(user as never, opts.campusId ?? null)
  const groups = await prisma.classSection.findMany({
    where: { kind: KIND_ONE_TO_ONE, isActive: true, ...(opts.status === 'ALL' ? {} : { status: 'ACTIVE' as const }), ...groupWhere(places) },
    orderBy: { createdAt: 'desc' }, take: 500,
    select: {
      id: true, className: true, sectionName: true, status: true, scheduleSlots: true, oneToOnePlan: true, cycleSessions: true, priceOverride: true, sessionMinutes: true, currentCycleNumber: true,
      startDate: true, currentCycleStartDate: true, campus: { select: { id: true, name: true } },
      level: { select: { id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true } } } },
      enrollments: { where: { status: 'ACTIVE' }, select: { student: { select: { id: true, firstName: true, lastName: true } } } },
      subjectOfferings: { where: { teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })
  const held = groups.length ? await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId: { in: groups.map((g) => g.id) } } },
    select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true } } }, distinct: ['attendanceDate', 'studentEnrollmentId'],
  }) : []
  const heldBy = new Map<string, Set<string>>()
  for (const r of held) {
    const k = r.studentEnrollment.classSectionId
    if (!k) continue
    if (!heldBy.has(k)) heldBy.set(k, new Set())
    heldBy.get(k)!.add(r.attendanceDate.toISOString().slice(0, 10))
  }
  return groups.map((g) => {
    const t = g.subjectOfferings[0]?.teacher
    const total = g.level ? sessionsPerCycle(g.level, g.cycleSessions) : (g.cycleSessions ?? 0)
    const done = heldBy.get(g.id)?.size ?? 0
    return {
      id: g.id, status: g.status, plan: g.oneToOnePlan, price: num(g.priceOverride), minutes: g.sessionMinutes, slots: g.scheduleSlots,
      campus: g.campus, level: g.level ? { id: g.level.id, name: g.level.name, course: g.level.subject?.name ?? '' } : null,
      students: g.enrollments.map((e) => ({ id: e.student.id, name: `${e.student.firstName} ${e.student.lastName}`.trim() })),
      teacher: t ? { id: t.id, name: `${t.firstName} ${t.lastName}`.trim() } : null,
      sessionsDone: done, sessionsTotal: total, sessionsLeft: Math.max(0, total - done), finished: total > 0 && done >= total,
    }
  })
}

export async function assertOneToOne(user: Who, id: string) {
  const g = await prisma.classSection.findUnique({ where: { id }, select: { kind: true } })
  if (!g || g.kind !== KIND_ONE_TO_ONE) throw new OneToOneError('One-to-One not found', 404)
  if (!(await canSeeGroup(user as never, id))) throw new OneToOneError('This One-to-One is not in your places', 403)
}

// ── next cycle ──────────────────────────────────────────────────────────────────────────────────────────────

type Carrying = { id: string; campusId: string; levelId: string | null; className: string; oneToOnePlan: string | null; cycleSessions: number | null; sessionMinutes: number | null; maxStudents: number | null; priceOverride: unknown; currentCycleNumber: number }

/** Has this One-to-One finished its level? (sessions, not months) */
export function oneToOneLevelDone(g: Pick<Carrying, 'cycleSessions' | 'currentCycleNumber'>, level: { numberOfSessions: number; numberOfMonths: number; pricingType: string }) {
  return levelFinished(g.currentCycleNumber, sessionsPerCycle(level, g.cycleSessions), level.numberOfSessions)
}

/** What the next cycle of a One-to-One keeps: same plan and people; a new level reads its own price list (no price = the level's price). */
export async function oneToOneCarry(g: Carrying, nextLevel: { id: string; name: string; numberOfSessions: number; numberOfMonths: number; pricingType: string }): Promise<Prisma.ClassSectionUncheckedCreateInput | Record<string, unknown>> {
  const base = { kind: KIND_ONE_TO_ONE, oneToOnePlan: g.oneToOnePlan, sessionMinutes: g.sessionMinutes, maxStudents: g.maxStudents, cycleSessions: g.cycleSessions }
  if (nextLevel.id === g.levelId) return base
  const plan = (g.oneToOnePlan ?? 'MONTH') as Plan
  const priced = pickPrice(await listPrices(nextLevel.id), g.campusId, plan, plan === 'PACKAGE' ? g.cycleSessions : null)
  if (!priced) return { ...base, cycleSessions: plan === 'MONTH' ? null : g.cycleSessions, priceOverride: null }
  const q = quote(priced, g.cycleSessions, (g.maxStudents ?? 1) > 1)
  return { ...base, cycleSessions: q.sessions, priceOverride: q.amount, sessionMinutes: priced.minutes ?? g.sessionMinutes }
}

/** The new name when the level changes ("Ahmed Ali — Arduino 2"). */
export async function oneToOneNextName(groupId: string, levelName: string, fallback: string) {
  const rows = await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'ACTIVE' }, select: { student: { select: { firstName: true, lastName: true } } } })
  return rows.length ? nameFor(rows.map((r) => r.student), levelName) : fallback.replace(/ #\d+$/, '')
}
