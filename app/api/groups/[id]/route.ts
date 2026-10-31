/**
 * GET   /api/groups/[id]  — full group detail: course/level/track, campus,
 *                            teacher, dates, schedule, and the student roster.
 * PATCH /api/groups/[id]  — update dates, weekly schedule, status
 *                            (Active/Completed), or which level it belongs to.
 *                            Teacher assignment stays in the existing
 *                            Subject Offerings flow — not duplicated here.
 */

import { cyclePrice } from '@/lib/pricing/group-price'
import { checkPermission } from '@/lib/rbac'
import { canSeeGroup } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveShiftId } from '@/lib/shifts/default-shift'
import { groupSeats, notifySeatFreed } from '@/lib/groups/capacity'
import { prisma } from '@/lib/prisma'
import { estimateGroupEnds } from '@/lib/groups/end-estimates'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { isLevelOfferedIn, levelModes } from '@/lib/delivery/catalog'
import { MODES, MODE_LABEL, modesText } from '@/lib/delivery/modes'
import { firstNotAllowed } from '@/lib/delivery/templates'
import { checkGroupSlots } from '@/lib/rooms/engine'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { Prisma, type Role } from '@prisma/client'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { pickGroupInstructorOffering } from '@/lib/groups/instructor'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({
    where: { id },
    include: {
      campus: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true } },
      level: {
        select: {
          id: true,
          name: true,
          numberOfMonths: true,
          numberOfSessions: true,
          pricingType: true,
          monthlyPrice: true,
          fullLevelPrice: true,
          subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } },
        },
      },
      subjectOfferings: {
        select: {
          subjectId: true,
          academicYearId: true,
          teacherId: true,
          createdAt: true,
          teacher: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true } },
        },
      },
      enrollments: {
        where: { OR: [{ status: 'ACTIVE' }, { withdrawalReason: 'UNPAID_AUTO' }] },
        select: {
          id: true,
          rollNumber: true,
          status: true,
          withdrawalReason: true,
          student: {
            select: {
              id: true, firstName: true, lastName: true, fullNameEn: true, registrationNumber: true,
              campus: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { rollNumber: 'asc' },
      },
    },
  })
  if (!group) return errors.notFound('Group')

  // M0: the group's place (or a single group given to this person)
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()

  // WHY: the page reads `teacher`; this route never returned it, so the
  // instructor dropdown always showed "none" even after a successful save.
  const activeYear = await getActiveAcademicYear()
  const instructorOffering = pickGroupInstructorOffering(group.subjectOfferings, group.level?.subject?.id, activeYear?.id)
  const instructor = instructorOffering?.teacher ?? null
  const { subjectOfferings: _offerings, ...groupFields } = group

  // Phase A: seats + this group's waiting queue, renewal answers, extra sessions.
  const [seats, waitingRows, renewals, extraSessions] = await Promise.all([
    groupSeats(id),
    prisma.waitingListEntry.findMany({
      where: { classSectionId: id, status: 'WAITING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, notes: true, student: { select: { id: true, firstName: true, lastName: true, registrationNumber: true } } },
    }),
    prisma.renewalRequest.findMany({ where: { classSectionId: id }, select: { studentId: true, status: true, reason: true, respondedVia: true, respondedAt: true } }),
    prisma.extraSession.findMany({ where: { classSectionId: id }, orderBy: { date: 'asc' }, select: { id: true, date: true, time: true, reason: true } }),
  ])

  // Partners part 1: the price this group's next invoice will use (group → place → level)
  const effectivePrice = group.level ? await cyclePrice(group.level, group.campusId, group.priceOverride) : null
  // FIN-2: students who cannot move to the next month / level until an unpaid fee is paid
  const { blockedForNext } = await import('@/lib/fees-extra/engine')
  const feeBlocked = await blockedForNext(group.enrollments.filter((e) => e.status === 'ACTIVE').map((e) => e.student.id))
  return successResponse({
    ...groupFields,
    effectivePrice,
    seats,
    waiting: waitingRows.map((w, i) => ({
      id: w.id,
      position: i + 1,
      since: w.createdAt,
      notes: w.notes,
      student: { id: w.student.id, name: `${w.student.firstName} ${w.student.lastName}`, registrationNumber: w.student.registrationNumber },
    })),
    renewals,
    feeBlocked,
    extraSessions: extraSessions.map((x) => ({ ...x, date: x.date.toISOString().slice(0, 10) })),
    teacher: instructor
      ? {
          id: instructor.id,
          name: `${instructor.firstName} ${instructor.lastName}`.trim(),
          phoneNumber: instructor.phoneNumber,
          email: instructor.email,
        }
      : null,
    ends: await estimateGroupEnds(group),
    label: `${group.className} ${group.sectionName}`.trim(),
    course: group.level?.subject ? { id: group.level.subject.id, name: group.level.subject.name } : null,
    track: group.level?.subject?.track ? { id: group.level.subject.track.id, name: group.level.subject.track.name } : null,
    displayStatus: group.status === 'COMPLETED'
      ? 'COMPLETED'
      : !group.startDate || group.startDate.getTime() > Date.now()
        ? 'UPCOMING'
        : 'ACTIVE',
  })
}

const updateGroupSchema = z.object({
  campusId: z.string().min(1).optional(),
  batchId: z.string().min(1).optional(),
  shiftId: z.string().min(1).optional(),
  className: z.string().min(1).max(50).optional(),
  sectionName: z.string().min(1).max(10).optional(),
  levelId: z.string().min(1).optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  expectedEndDate: z.string().datetime().optional().nullable(),
  /** a02: each weekly slot has a way (BRANCH default / ONLINE / RECORDED) */
  scheduleSlots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), time: z.string().min(1), mode: z.enum(MODES).optional(), roomId: z.string().min(1).optional() })).optional().nullable(),
  /** a02 batch 3: a Super Admin may book a room / size against the rules */
  forceRooms: z.boolean().optional(),
  /** a02: the template the slots were filled from (information) */
  deliveryTemplateId: z.string().min(1).nullable().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED']).optional(),
  requireFullPaymentToStart: z.boolean().optional(),
  partialPaymentCounts: z.boolean().optional(),
  installmentsAllowed: z.boolean().optional(),
  /** Phase A: most students allowed (null = no limit) */
  maxStudents: z.number().int().min(1).max(500).nullable().optional(),
  /** Partners part 1: the group's own cycle price (null = place / level price) — needs fees:update */
  priceOverride: z.number().min(0).max(1_000_000).nullable().optional(),
  /** Partners part 1: a class without names (number of children); null = a normal group */
  unnamedHeadcount: z.number().int().min(1).max(500).nullable().optional(),
  /** a02: the group's curriculum — null = automatic (place / way), 'MAIN', or a CurriculumVariant id of its level */
  curriculumVariantId: z.string().min(1).nullable().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied

  const { id } = await params
  const existing = await prisma.classSection.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Group')

  // M0: the group's place (or a single group given to this person)
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = updateGroupSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  // Partners part 1: changing the price is a money decision
  if (parsed.data.priceOverride !== undefined && !checkPermission(role, 'fees', 'update')) return errors.forbidden('Only finance staff may change the group price')

  if (parsed.data.levelId) {
    const level = await prisma.level.findUnique({ where: { id: parsed.data.levelId }, select: { id: true } })
    if (!level) return errors.notFound('Level')
    // a02: a level limited to some places cannot be given to a group elsewhere
    if (parsed.data.levelId !== existing.levelId && !(await isLevelOfferedIn(parsed.data.levelId, existing.campusId))) {
      return errorResponse('NOT_OFFERED', 'This level is not offered in this place (Course Structure → where offered) · المستوى ده مش متاح في المكان ده (هيكل الكورسات ← متاح فين)', 409)
    }
  }

  // a02: the curriculum can change only before the group's first session (owner 2026-10-30), then it keeps its version
  if (parsed.data.curriculumVariantId !== undefined && parsed.data.curriculumVariantId !== existing.curriculumVariantId) {
    if (existing.startDate) return errorResponse('GROUP_STARTED', 'The group has started — it keeps its curriculum · الجروب بدأ — بيفضل على نفس المنهج', 409)
    const v = parsed.data.curriculumVariantId
    const levelId = parsed.data.levelId ?? existing.levelId
    if (v && v !== 'MAIN' && !(await prisma.curriculumVariant.findFirst({ where: { id: v, levelId: levelId ?? '' }, select: { id: true } }))) return errors.badRequest('This curriculum is not of the group level · المنهج ده مش تبع مستوى الجروب')
  }

  // a02: every weekly session must use a way the level allows (Course Structure → ways)
  if (parsed.data.scheduleSlots !== undefined || (parsed.data.levelId && parsed.data.levelId !== existing.levelId)) {
    const lvl = parsed.data.levelId !== undefined ? parsed.data.levelId : existing.levelId
    const slots = cleanSlots(parsed.data.scheduleSlots !== undefined ? parsed.data.scheduleSlots : existing.scheduleSlots)
    if (lvl && slots.length) {
      const allowed = (await levelModes(lvl)).modes
      const bad = firstNotAllowed(slots, allowed)
      if (bad) return errorResponse('MODE_NOT_ALLOWED', `${MODE_LABEL[bad.mode ?? 'BRANCH'].en} sessions are not allowed for this level (allowed: ${modesText(allowed, 'en')}) · طريقة «${MODE_LABEL[bad.mode ?? 'BRANCH'].ar}» مش مسموحة للمستوى ده (المسموح: ${modesText(allowed, 'ar')})`, 409)
    }
  }

  // a02 batch 3: rooms — no room booked twice, no group bigger than its room (Super Admin may force; logged)
  if (parsed.data.scheduleSlots !== undefined || parsed.data.maxStudents !== undefined) {
    const problem = await checkGroupSlots(
      { id, campusId: existing.campusId, maxStudents: parsed.data.maxStudents !== undefined ? parsed.data.maxStudents : existing.maxStudents },
      parsed.data.scheduleSlots !== undefined ? parsed.data.scheduleSlots : existing.scheduleSlots,
    )
    if (problem) {
      if (!(parsed.data.forceRooms && role === 'SUPER_ADMIN')) return errorResponse('ROOM_PROBLEM', problem, 409)
      await prisma.auditLog.create({ data: { userId: session.user.id, action: 'FORCE_ROOMS', entityType: 'ClassSection', entityId: id, changes: { problem } } }).catch(() => undefined)
    }
  }

  // Session shift follows the group's time when the schedule changes (shift is switched off in the UI).
  let autoShiftId: string | undefined
  if (parsed.data.scheduleSlots && parsed.data.shiftId === undefined) {
    autoShiftId = await resolveShiftId(null, parsed.data.scheduleSlots)
    const current = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true, batchId: true, className: true, sectionName: true, shiftId: true } })
    // Never collide with an older group that has the same name in that shift.
    if (current && current.shiftId !== autoShiftId) {
      const taken = await prisma.classSection.findFirst({
        where: { id: { not: id }, campusId: current.campusId, batchId: current.batchId, shiftId: autoShiftId, className: current.className, sectionName: current.sectionName },
        select: { id: true },
      })
      if (taken) autoShiftId = undefined
    }
  }

  const group = await prisma.classSection.update({
    where: { id },
    data: {
      ...(autoShiftId && { shiftId: autoShiftId }),
      ...(parsed.data.campusId !== undefined && { campusId: parsed.data.campusId }),
      ...(parsed.data.batchId !== undefined && { batchId: parsed.data.batchId }),
      ...(parsed.data.shiftId !== undefined && { shiftId: parsed.data.shiftId }),
      ...(parsed.data.className !== undefined && { className: parsed.data.className }),
      ...(parsed.data.sectionName !== undefined && { sectionName: parsed.data.sectionName }),
      ...(parsed.data.levelId !== undefined && { levelId: parsed.data.levelId }),
      // a new curriculum (not started yet) drops any version picked before, so the right one is read
      ...(parsed.data.curriculumVariantId !== undefined && parsed.data.curriculumVariantId !== existing.curriculumVariantId && { curriculumVariantId: parsed.data.curriculumVariantId, curriculumEditionId: null }),
      ...(parsed.data.startDate !== undefined && { startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null }),
      ...(parsed.data.expectedEndDate !== undefined && { expectedEndDate: parsed.data.expectedEndDate ? new Date(parsed.data.expectedEndDate) : null }),
      ...(parsed.data.scheduleSlots !== undefined && { scheduleSlots: parsed.data.scheduleSlots ? (cleanSlots(parsed.data.scheduleSlots) as unknown as Prisma.InputJsonValue) : Prisma.DbNull }),
      ...(parsed.data.deliveryTemplateId !== undefined && { deliveryTemplateId: parsed.data.deliveryTemplateId }),
      ...(parsed.data.status && {
        status: parsed.data.status,
        completedAt: parsed.data.status === 'COMPLETED' ? new Date() : null,
      }),
      ...(parsed.data.requireFullPaymentToStart !== undefined && { requireFullPaymentToStart: parsed.data.requireFullPaymentToStart }),
      ...(parsed.data.maxStudents !== undefined && { maxStudents: parsed.data.maxStudents }),
      ...(parsed.data.priceOverride !== undefined && { priceOverride: parsed.data.priceOverride }),
      ...(parsed.data.unnamedHeadcount !== undefined && { unnamedHeadcount: parsed.data.unnamedHeadcount }),
      ...(parsed.data.partialPaymentCounts !== undefined && { partialPaymentCounts: parsed.data.partialPaymentCounts }),
      ...(parsed.data.installmentsAllowed !== undefined && { installmentsAllowed: parsed.data.installmentsAllowed }),
    },
  })

  if (parsed.data.maxStudents !== undefined) await notifySeatFreed(id)
  return successResponse(group)
}

/**
 * DELETE /api/groups/[id]
 * Soft-delete only (isActive=false) — a ClassSection can be referenced by
 * attendance, grading, timetable and exam records, so it is never hard
 * deleted. Blocked entirely while it still has active students; remove or
 * transfer them first.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'delete')
  if (denied) return denied

  const { id } = await params
  const existing = await prisma.classSection.findUnique({
    where: { id },
    include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  if (!existing) return errors.notFound('Group')

  // M0: the group's place (or a single group given to this person)
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()

  if (existing._count.enrollments > 0) {
    return errors.conflict('This group still has active students — remove or transfer them before deleting it')
  }

  await prisma.classSection.update({ where: { id }, data: { isActive: false } })

  return successResponse({ id, deleted: true })
}
