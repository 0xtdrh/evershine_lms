/**
 * GET  /api/groups  — list groups with full context (course, level, track,
 *                      campus, teacher, student count, dates, schedule).
 *                      Campus-scoped: BRANCH_MANAGER/SECRETARY only see their
 *                      own campus; SUPER_ADMIN/ADMIN see all or filter via
 *                      ?campusId=.
 * POST /api/groups  — create a group under a specific level.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

function computeDisplayStatus(status: string, startDate: Date | null): 'COMPLETED' | 'UPCOMING' | 'ACTIVE' {
  if (status === 'COMPLETED') return 'COMPLETED'
  if (startDate && startDate.getTime() > Date.now()) return 'UPCOMING'
  return 'ACTIVE'
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const requestedCampusId = searchParams.get('campusId')
  const campusId = campusScope(role, session.user.campusId, requestedCampusId)
  const activeYear = await getActiveAcademicYear()

  const groups = await prisma.classSection.findMany({
    where: { isActive: true, ...(campusId && { campusId }) },
    orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
    include: {
      campus: { select: { id: true, name: true } },
      level: {
        select: {
          id: true,
          name: true,
          numberOfMonths: true,
          numberOfSessions: true,
          subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } },
        },
      },
      subjectOfferings: {
        where: activeYear ? { academicYearId: activeYear.id } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { teacher: { select: { id: true, firstName: true, lastName: true } } },
      },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  })

  const shaped = groups.map((g) => ({
    id: g.id,
    label: `${g.className} ${g.sectionName}`.trim(),
    campus: g.campus,
    course: g.level?.subject ? { id: g.level.subject.id, name: g.level.subject.name } : null,
    track: g.level?.subject.track ?? null,
    level: g.level ? { id: g.level.id, name: g.level.name, numberOfMonths: g.level.numberOfMonths, numberOfSessions: g.level.numberOfSessions } : null,
    teacher: g.subjectOfferings[0]?.teacher
      ? { id: g.subjectOfferings[0].teacher.id, name: `${g.subjectOfferings[0].teacher.firstName} ${g.subjectOfferings[0].teacher.lastName}` }
      : null,
    studentCount: g._count.enrollments,
    startDate: g.startDate,
    expectedEndDate: g.expectedEndDate,
    scheduleSlots: g.scheduleSlots,
    status: g.status,
    displayStatus: computeDisplayStatus(g.status, g.startDate),
  }))

  return successResponse(shaped)
}

const createGroupSchema = z.object({
  campusId: z.string().min(1),
  batchId: z.string().min(1),
  shiftId: z.string().min(1),
  className: z.string().min(1).max(50),
  sectionName: z.string().min(1).max(10),
  levelId: z.string().min(1).optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  requireFullPaymentToStart: z.boolean().optional(),
  partialPaymentCounts: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'create')
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = createGroupSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  // Branch-scoped roles can only create groups in their own campus, no matter
  // what campusId the client sent — this mirrors the read-side scoping.
  const scopedCampusId = campusScope(role, session.user.campusId, parsed.data.campusId)
  if (role !== 'SUPER_ADMIN') {
    if (!session.user.campusId) return errors.conflict('Your account has no campus assigned')
    if (parsed.data.campusId !== session.user.campusId) {
      return errors.forbidden('You can only create groups in your own campus')
    }
  }
  const effectiveCampusId = scopedCampusId ?? parsed.data.campusId

  let expectedEndDate: Date | null = null
  if (parsed.data.levelId && parsed.data.startDate) {
    const level = await prisma.level.findUnique({ where: { id: parsed.data.levelId }, select: { numberOfMonths: true } })
    if (level) {
      const start = new Date(parsed.data.startDate)
      expectedEndDate = new Date(start)
      expectedEndDate.setMonth(expectedEndDate.getMonth() + level.numberOfMonths)
    }
  }

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return errors.conflict('No active academic year is set')

  const group = await prisma.classSection.create({
    data: {
      campusId: effectiveCampusId,
      batchId: parsed.data.batchId,
      shiftId: parsed.data.shiftId,
      className: parsed.data.className,
      sectionName: parsed.data.sectionName,
      levelId: parsed.data.levelId ?? null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      expectedEndDate,
      requireFullPaymentToStart: parsed.data.requireFullPaymentToStart ?? false,
      partialPaymentCounts: parsed.data.partialPaymentCounts ?? false,
    },
  })

  return createdResponse(group, 'Group created successfully')
}
