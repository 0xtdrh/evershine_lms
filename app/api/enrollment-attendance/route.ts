import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { markEnrollmentAttendanceSchema } from '@/lib/validation/academic'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { resolveMarkedByTeacherId } from '@/lib/academic/attendance'
import { getTeacherByUserId, getTeacherClassSectionIds, teacherCanAccessClassSection } from '@/lib/academic/teacher-scope'
import type { Role } from '@prisma/client'
import { createStudentAbsenceAssessment } from '@/lib/penalties/assessments'
import { syncGroupProgress } from '@/lib/groups/sync-progress'
import { applyExcuses, afterAttendanceSaved } from '@/lib/attendance/after-save'

const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const

/**
 * A branch-scoped user may only mark attendance in their own branch, and a
 * teacher only in groups they are assigned to.
 */
async function assertCanMarkGroup(
  session: { user: { id: string; role: string; campusId?: string | null } },
  classSectionId: string,
  activeYearId?: string,
  attendanceDate?: string
) {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { campusId: true, status: true, completedAt: true },
  })
  if (!group) return errors.notFound('Group')
  // A closed cycle takes no NEW sessions (corrections of its own past dates are fine).
  if (group.status === 'COMPLETED' && attendanceDate && group.completedAt && new Date(attendanceDate) > group.completedAt) {
    return errors.conflict("This group's cycle is closed. Record attendance in the group of the next cycle.")
  }
  const scoped = campusScope(session.user.role as Role, session.user.campusId, null)
  if (scoped && group.campusId !== scoped) return errors.forbidden()
  if (session.user.role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    const allowed = await teacherCanAccessClassSection(teacher.id, classSectionId, activeYearId)
    if (!allowed) return errors.forbidden('You are not assigned to this section')
  }
  return null
}

/**
 * Group start date / 50% payment warning used to update only when someone
 * opened the group on the Groups page. Refresh right after attendance is saved.
 * Never allowed to break the attendance save.
 */
async function refreshGroupProgress(classSectionId: string, userId: string) {
  try {
    await syncGroupProgress(classSectionId, userId)
  } catch (err) {
    console.error('[ATTENDANCE_SYNC_PROGRESS]', err)
  }
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'attendance', 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const classSectionId = searchParams.get('classSectionId')
  const date = searchParams.get('date')
  const studentEnrollmentId = searchParams.get('studentEnrollmentId')
  const studentId = searchParams.get('studentId')
  const limit = Math.min(Number(searchParams.get('limit') ?? 60), 200)

  // SECURITY: teachers only read their own groups; branch-scoped staff only
  // their branch (this used to return any group's attendance to any teacher).
  const role = session.user.role as Role
  let teacherGroupFilter: { classSectionId: { in: string[] } } | undefined
  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    if (classSectionId && !(await teacherCanAccessClassSection(teacher.id, classSectionId))) {
      return errors.forbidden('You are not assigned to this section')
    }
    if (!classSectionId) teacherGroupFilter = { classSectionId: { in: await getTeacherClassSectionIds(teacher.id) } }
  }
  const scoped = campusScope(role, session.user.campusId, null)

  const records = await prisma.enrollmentAttendanceRecord.findMany({
    where: {
      ...(studentEnrollmentId && { studentEnrollmentId }),
      ...(date && { attendanceDate: new Date(date) }),
      studentEnrollment: {
        ...(studentId && { studentId }),
        ...(classSectionId && { classSectionId }),
        ...(teacherGroupFilter ?? {}),
        ...(scoped && { classSection: { campusId: scoped } }),
      },
    },
    include: {
      studentEnrollment: {
        include: {
          student: { select: { firstName: true, lastName: true, rollNumber: true } },
        },
      },
    },
    orderBy: { attendanceDate: 'desc' },
    take: limit,
  })

  return successResponse(records)
}

/** Mark attendance for a class section on a given date (bulk-friendly single POST). */
export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'attendance', 'create')
  if (denied) return denied

  let body: any
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }

  // Bulk: { classSectionId, attendanceDate, records: [{ studentEnrollmentId, status, remarks? }] }
  if (Array.isArray(body.records)) {
    const classSectionId = body.classSectionId as string
    const attendanceDate = body.attendanceDate as string
    if (!classSectionId || !attendanceDate) {
      return errors.validation({
        errors: [{ path: ['classSectionId'], message: 'classSectionId and attendanceDate required' }],
      } as never)
    }

    const activeYear = await getActiveAcademicYear()
    if (activeYear?.isLocked) return errors.forbidden('Academic year is locked')

    const deniedGroup = await assertCanMarkGroup(session, classSectionId, activeYear?.id, attendanceDate)
    if (deniedGroup) return deniedGroup

    // SECURITY: every record must belong to THIS group (a teacher allowed on
    // group X could otherwise write attendance for any enrollment), and the
    // status must be a real one (bad values used to fail with a 500).
    const submitted = body.records as { studentEnrollmentId: string; status: string; remarks?: string }[]
    if (submitted.some((r) => !ATTENDANCE_STATUSES.includes(r.status as (typeof ATTENDANCE_STATUSES)[number]))) {
      return errors.badRequest(`Status must be one of ${ATTENDANCE_STATUSES.join(', ')}`)
    }
    const ids = [...new Set(submitted.map((r) => r.studentEnrollmentId))]
    const inGroup = await prisma.studentEnrollment.count({ where: { id: { in: ids }, classSectionId } })
    if (inGroup !== ids.length) return errors.forbidden('Some students are not in this group')

    const markedBy = await resolveMarkedByTeacherId(session.user.id)
    // Phase C: an approved parent excuse turns ABSENT into EXCUSED; remember the
    // old statuses so parents are only notified about real changes.
    const records = await applyExcuses(classSectionId, attendanceDate, submitted as {
      studentEnrollmentId: string
      status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
      remarks?: string
    }[])
    const before = new Map(
      (await prisma.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollmentId: { in: ids }, attendanceDate: new Date(attendanceDate) },
        select: { studentEnrollmentId: true, status: true },
      })).map((r) => [r.studentEnrollmentId, r.status as string])
    )

    const results = await prisma.$transaction(async (tx) => {
      const out = []
      for (const rec of records) {
        const row = await tx.enrollmentAttendanceRecord.upsert({
          where: {
            studentEnrollmentId_attendanceDate: {
              studentEnrollmentId: rec.studentEnrollmentId,
              attendanceDate: new Date(attendanceDate),
            },
          },
          create: {
            studentEnrollmentId: rec.studentEnrollmentId,
            attendanceDate: new Date(attendanceDate),
            status: rec.status,
            markedByTeacherId: markedBy,
            remarks: rec.remarks,
          },
          update: {
            status: rec.status,
            markedByTeacherId: markedBy,
            remarks: rec.remarks,
          },
        })
        out.push(row)
        await createStudentAbsenceAssessment(tx, {
          attendanceRecordId: row.id,
          attendanceDate: new Date(attendanceDate),
          markedByUserId: session.user.id,
        })
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'CREATE',
          entityType: 'EnrollmentAttendance',
          entityId: classSectionId,
          changes: { date: attendanceDate, count: out.length },
        },
      })
      return out
    })

    await refreshGroupProgress(classSectionId, session.user.id)
    await afterAttendanceSaved({ classSectionId, date: attendanceDate, before, after: records })
    return createdResponse(results, 'Attendance saved')
  }

  const parsed = markEnrollmentAttendanceSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  // SECURITY: the single-record path had no group/branch/teacher check at all.
  const target = await prisma.studentEnrollment.findUnique({
    where: { id: parsed.data.studentEnrollmentId! },
    select: { classSectionId: true },
  })
  if (!target) return errors.notFound('Enrollment')
  const activeYearSingle = await getActiveAcademicYear()
  if (activeYearSingle?.isLocked) return errors.forbidden('Academic year is locked')
  const deniedSingle = await assertCanMarkGroup(session, target.classSectionId, activeYearSingle?.id, parsed.data.attendanceDate)
  if (deniedSingle) return deniedSingle

  const markedBy = await resolveMarkedByTeacherId(session.user.id)
  const [single] = await applyExcuses(target.classSectionId, parsed.data.attendanceDate!, [
    { studentEnrollmentId: parsed.data.studentEnrollmentId!, status: parsed.data.status!, remarks: parsed.data.remarks ?? undefined },
  ])
  const previous = await prisma.enrollmentAttendanceRecord.findUnique({
    where: { studentEnrollmentId_attendanceDate: { studentEnrollmentId: parsed.data.studentEnrollmentId!, attendanceDate: new Date(parsed.data.attendanceDate!) } },
    select: { status: true },
  })

  const record = await prisma.$transaction(async (tx) => {
    const row = await tx.enrollmentAttendanceRecord.upsert({
      where: {
        studentEnrollmentId_attendanceDate: {
          studentEnrollmentId: parsed.data.studentEnrollmentId!,
          attendanceDate: new Date(parsed.data.attendanceDate!),
        },
      },
      create: {
        studentEnrollmentId: parsed.data.studentEnrollmentId!,
        attendanceDate: new Date(parsed.data.attendanceDate!),
        status: single.status,
        remarks: single.remarks,
        markedByTeacherId: markedBy,
      },
      update: {
        status: single.status,
        remarks: single.remarks,
        markedByTeacherId: markedBy,
      },
    })
    await createStudentAbsenceAssessment(tx, {
      attendanceRecordId: row.id,
      attendanceDate: new Date(parsed.data.attendanceDate!),
      markedByUserId: session.user.id,
    })
    return row
  })

  await refreshGroupProgress(target.classSectionId, session.user.id)
  await afterAttendanceSaved({
    classSectionId: target.classSectionId,
    date: parsed.data.attendanceDate!,
    before: new Map(previous ? [[parsed.data.studentEnrollmentId!, previous.status as string]] : []),
    after: [single],
  })
  return createdResponse(record)
}
