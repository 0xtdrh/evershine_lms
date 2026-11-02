/**
 * a02 M3 One-to-One — price list, who can teach it, booking, the list and what carries into the next cycle. Server-only.
 * Booking applies the same rules as the group screens (where offered, allowed ways, rooms, instructor hours / clashes) and bills
 * through the same invoice path (wallet too); it needs no group permission, so a parent's request or an instructor's accept can
 * finish it. Rules: lib/one-to-one/rules.ts.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { allowsCampus, canSeeGroup, canSeeStudent, groupWhere, loadPlaces, requestPlaces, teachersOfPlaceWhere } from '@/lib/places/server'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { teacherFreeFor } from '@/lib/teachers/availability'
import { checkTeacherForGroup } from '@/lib/teachers/availability'
import { checkGroupSlots } from '@/lib/rooms/engine'
import { isLevelOfferedIn, levelModes } from '@/lib/delivery/catalog'
import { firstNotAllowed } from '@/lib/delivery/templates'
import { MODE_LABEL } from '@/lib/delivery/modes'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { generateMissingCycleInvoices } from '@/lib/groups/generate-invoices'
import { notifyJoinerHolidays } from '@/lib/notifications/session-events'
import { resolveBatchId } from '@/lib/batches/default-batch'
import { resolveShiftId } from '@/lib/shifts/default-shift'
import { executeTransfer, previewTransfer } from '@/lib/groups/transfer'
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
  /** the student moves here from this group: what he has not used becomes credit on the new invoice */
  fromGroupId?: string | null
}

async function freeName(campusId: string, base: string) {
  let name = base
  for (let n = 2; await prisma.classSection.findFirst({ where: { campusId, className: name, sectionName: SECTION_NAME }, select: { id: true } }); n++) name = `${base.slice(0, 45)} #${n}`
  return name
}

/** Two students share a family? (same guardian or parent) */
export async function areSiblings(a: string, b: string) {
  const rows = await prisma.student.findMany({ where: { id: { in: [a, b] } }, select: { guardians: { select: { id: true } }, parents: { select: { id: true } } } })
  if (rows.length !== 2) return false
  const fam = (r: (typeof rows)[number]) => [...r.guardians.map((g) => g.id), ...r.parents.map((p) => p.id)]
  const first = new Set(fam(rows[0]))
  return fam(rows[1]).some((x) => first.has(x))
}

const toSlots = (slots: SlotInput[]) => slots.map((s) => ({ dayOfWeek: s.dayOfWeek, time: s.time, mode: s.mode ?? 'BRANCH', ...(s.roomId && { roomId: s.roomId }) }))

/** A place that keeps rooms: give each branch session the first room that really is free (for requests nobody at the desk placed). */
export async function pickRooms(campusId: string, slots: SlotInput[], seats: number): Promise<SlotInput[]> {
  const campus = await prisma.campus.findUnique({ where: { id: campusId }, select: { roomMode: true, rooms: { where: { isActive: true }, select: { id: true } } } })
  if (campus?.roomMode !== 'FIXED') return slots
  const out = [...slots]
  for (const [i, s] of out.entries()) {
    if (s.roomId || (s.mode ?? 'BRANCH') !== 'BRANCH') continue
    for (const r of campus.rooms) {
      const tryThis = out.slice(0, i + 1).map((x, j) => (j === i ? { ...x, roomId: r.id } : x))
      if (!(await checkGroupSlots({ id: '__new__', campusId, maxStudents: seats }, toSlots(tryThis)))) { out[i] = tryThis[i]; break }
    }
  }
  return out
}

/**
 * Makes the One-to-One: every rule of the group screens first (where offered, allowed ways, rooms, the instructor's hours and clashes),
 * then group + instructor + students + invoices. Nothing is created when a rule refuses. Who may ask is checked by the caller.
 */
export async function createOneToOne(i: BookInput, actorId: string, opts: { sibling: boolean; force: boolean; noStudents?: boolean }) {
  const students = await prisma.student.findMany({ where: { id: { in: i.studentIds } }, select: { id: true, firstName: true, lastName: true } })
  const ordered = i.studentIds.map((id) => students.find((s) => s.id === id)).filter((s): s is (typeof students)[number] => !!s)
  const level = await prisma.level.findUnique({ where: { id: i.levelId }, select: { name: true, subjectId: true } })
  if (!level) throw new OneToOneError('Level not found', 404)
  if (!(await isLevelOfferedIn(i.levelId, i.campusId))) throw new OneToOneError('This level is not offered in this place · المستوى ده مش متاح في المكان ده', 409, 'NOT_OFFERED')
  const priced = pickPrice(await listPrices(i.levelId), i.campusId, i.plan, i.plan === 'SESSION' ? null : i.sessions ?? null)
  if (!priced) throw new OneToOneError('This level has no One-to-One price for this plan yet · المستوى ده مالوش سعر One-to-One للنظام ده', 409, 'NO_PRICE')
  const q = quote(priced, i.sessions ?? null, opts.sibling)
  const slots = toSlots(i.slots)
  const allowed = (await levelModes(i.levelId)).modes
  const bad = firstNotAllowed(cleanSlots(slots), allowed)
  if (bad) throw new OneToOneError(`${MODE_LABEL[bad.mode ?? 'BRANCH'].en} sessions are not allowed for this level · طريقة «${MODE_LABEL[bad.mode ?? 'BRANCH'].ar}» مش مسموحة للمستوى ده`, 409, 'MODE_NOT_ALLOWED')
  const log = (action: string, problem: string) => prisma.auditLog.create({ data: { userId: actorId, action, entityType: 'ClassSection', entityId: 'one-to-one', changes: { problem } } }).catch(() => undefined)
  const roomProblem = await checkGroupSlots({ id: '__new__', campusId: i.campusId, maxStudents: ordered.length }, slots)
  if (roomProblem) {
    if (!opts.force) throw new OneToOneError(roomProblem, 409, 'ROOM_PROBLEM')
    await log('FORCE_ROOMS', roomProblem)
  }
  const className = await freeName(i.campusId, nameFor(ordered, level.name))
  const teacher = await prisma.teacher.findUnique({ where: { id: i.teacherId }, select: { id: true } })
  if (!teacher) throw new OneToOneError('Instructor not found', 404)
  const teacherProblem = await checkTeacherForGroup(i.teacherId, { id: '__new__', className, sectionName: SECTION_NAME, campusId: i.campusId, scheduleSlots: slots })
  if (teacherProblem) {
    if (!opts.force) throw new OneToOneError(teacherProblem, 409, 'TEACHER_PROBLEM')
    await log('FORCE_TEACHER', teacherProblem)
  }
  const activeYear = await getActiveAcademicYear()
  if (!activeYear) throw new OneToOneError('No active academic year is set', 409)

  const group = await prisma.classSection.create({
    data: {
      campusId: i.campusId, batchId: await resolveBatchId(i.campusId, null), shiftId: await resolveShiftId(null, slots),
      className, sectionName: SECTION_NAME, levelId: i.levelId, maxStudents: ordered.length,
      kind: KIND_ONE_TO_ONE, oneToOnePlan: i.plan, cycleSessions: q.sessions, priceOverride: q.amount, sessionMinutes: i.minutes ?? priced.minutes ?? null,
      scheduleSlots: slots as unknown as Prisma.InputJsonValue,
      requireFullPaymentToStart: i.payment !== 'INSTALLMENTS', installmentsAllowed: i.payment === 'INSTALLMENTS',
    },
  })
  await prisma.subjectOffering.create({
    data: { academicYearId: activeYear.id, classSectionId: group.id, subjectId: level.subjectId, teacherId: i.teacherId, ...(i.teacherRate != null && { overrideOneToOnePerSession: i.teacherRate }) },
  })
  for (const s of opts.noStudents ? [] : ordered) {
    await prisma.studentEnrollment.create({ data: { studentId: s.id, academicYearId: activeYear.id, classSectionId: group.id, rollNumber: String(Math.floor(Math.random() * 9000) + 1000) } })
    try { await generateMissingCycleInvoices(group.id, actorId, s.id) } catch (err) { console.error('[ONE_TO_ONE_INVOICE]', err) }
    await notifyJoinerHolidays(s.id, group.id)
  }
  return { groupId: group.id, amountEach: q.amount, sessions: q.sessions, sibling: opts.sibling }
}

/** Staff book a One-to-One: one student, or two siblings in the same level sharing the same session. */
export async function book(user: Who, i: BookInput) {
  const ids = [...new Set(i.studentIds)]
  if (ids.length < 1 || ids.length > 2) throw new OneToOneError('Choose one student, or two siblings for the same session')
  if (!i.slots.length) throw new OneToOneError('Choose the weekly time')
  if (!allowsCampus(await loadPlaces(user as never), i.campusId)) throw new OneToOneError('This place is not yours', 403)
  for (const id of ids) {
    if (!(await prisma.student.findUnique({ where: { id }, select: { id: true } }))) throw new OneToOneError('Student not found', 404)
    if (!(await canSeeStudent(user as never, id))) throw new OneToOneError('This student is not in your places', 403)
  }
  const sibling = ids.length === 2
  if (sibling && !(await areSiblings(ids[0], ids[1]))) throw new OneToOneError('These two students are not siblings. Book them separately. · الاتنين مش إخوات، احجز لكل واحد لوحده', 409, 'NOT_SIBLINGS')
  const force = !!i.force && user.role === 'SUPER_ADMIN'
  if (!i.fromGroupId) return createOneToOne({ ...i, studentIds: ids }, user.id, { sibling, force })
  // from a group: same move as between groups (locks, credit, old invoice, discounts as suggested)
  if (sibling) throw new OneToOneError('Move one student at a time')
  const made = await createOneToOne({ ...i, studentIds: ids }, user.id, { sibling: false, force, noStudents: true })
  const pre = await previewTransfer(ids[0], i.fromGroupId, made.groupId)
  const moved = 'message' in pre ? pre : await executeTransfer({
    studentId: ids[0], fromClassSectionId: i.fromGroupId, toClassSectionId: made.groupId, creditTo: 'NEW_INVOICE', userId: user.id, reason: 'One-to-One',
    discountDecisions: pre.preview.discounts.map((d) => ({ assignmentId: d.assignmentId, action: d.suggested })),
  })
  if (!('ok' in moved) || !moved.ok) {
    await prisma.subjectOffering.deleteMany({ where: { classSectionId: made.groupId } })
    await prisma.classSection.delete({ where: { id: made.groupId } }).catch(() => undefined)
    throw new OneToOneError((moved as { message: string }).message, (moved as { status: number }).status)
  }
  return { ...made, moved: { credit: moved.credit, creditApplied: moved.creditApplied } }
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
