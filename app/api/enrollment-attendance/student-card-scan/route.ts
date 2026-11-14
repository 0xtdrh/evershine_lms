import { NextRequest } from 'next/server'
import { normalizeCardCode } from '@/lib/cards/rules'
import { prisma } from '@/lib/prisma'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { resolveMarkedByTeacherId } from '@/lib/academic/attendance'
import { cycleFullRefusal, groupAttendanceAccess } from '@/lib/attendance/access'
import type { Role } from '@prisma/client'

function parseAttendanceDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * POST /api/enrollment-attendance/student-card-scan
 *
 * Marks one enrolled student present from their student-card attendance
 * credential. The credential is resolved inside the selected class section
 * and the caller's teacher assignment is checked server-side before writing.
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!

  const denied = requirePermission(session.user.role as Role, 'attendance', 'create')
  if (denied) return denied

  try {
    const body = await request.json()
    const classSectionId = typeof body.classSectionId === 'string' ? body.classSectionId.trim() : ''
    const studentQrCode = typeof body.studentQrCode === 'string' ? normalizeCardCode(body.studentQrCode) : '' // raw code or the /card/<code> link on new cards
    const attendanceDate = parseAttendanceDate(body.attendanceDate)

    if (!classSectionId || !studentQrCode || !attendanceDate) {
      return errors.validation({
        errors: [{ path: ['classSectionId', 'studentQrCode', 'attendanceDate'], message: 'A class section, student card QR, and valid date are required' }],
      } as never)
    }

    // Student cards use an attendance-only credential. Accept TN-QR (current)
    // and legacy ESA-QR cards while preventing arbitrary registration values from being
    // submitted to this endpoint.
    if (!/^(tn|esa)-qr-/i.test(studentQrCode)) {
      return errors.validation({
        errors: [{ path: ['studentQrCode'], message: 'This QR code is not a student attendance credential' }],
      } as never)
    }

    const activeYear = await getActiveAcademicYear()
    if (!activeYear) return errors.notFound('No active academic year')
    if (activeYear.isLocked) return errors.forbidden('Academic year is locked')

    // J02 (final test): staff only their places, instructors their groups (lib/attendance/access.ts)
    const noAccess = await groupAttendanceAccess(session.user, classSectionId, attendanceDate.toISOString().slice(0, 10), activeYear.id)
    if (noAccess) return noAccess
    const blocked = await (await import('@/lib/groups/start')).attendanceBlock(classSectionId)
    if (blocked) return errorResponse('GROUP_NOT_READY', blocked, 409)
    const full = await cycleFullRefusal(classSectionId, attendanceDate.toISOString().slice(0, 10))
    if (full) return full

    const enrollment = await prisma.studentEnrollment.findFirst({
      where: {
        classSectionId,
        academicYearId: activeYear.id,
        status: 'ACTIVE',
        student: { isActive: true, idCardQRCode: studentQrCode },
      },
      select: {
        id: true,
        rollNumber: true,
        student: { select: { firstName: true, lastName: true, registrationNumber: true } },
      },
    })

    if (!enrollment) {
      return errors.notFound('Student card is not active in this class section')
    }

    const markedByTeacherId = await resolveMarkedByTeacherId(session.user.id)

    const existing = await prisma.enrollmentAttendanceRecord.findUnique({
      where: {
        studentEnrollmentId_attendanceDate: {
          studentEnrollmentId: enrollment.id,
          attendanceDate,
        },
      },
      select: { id: true, status: true },
    })

    if (existing) {
      return successResponse({
        success: true,
        alreadyMarked: true,
        attendanceId: existing.id,
        status: existing.status,
        studentEnrollmentId: enrollment.id,
        student: enrollment.student,
      })
    }

    const record = await prisma.enrollmentAttendanceRecord.create({
      data: {
        studentEnrollmentId: enrollment.id,
        attendanceDate,
        status: 'PRESENT',
        markedByTeacherId,
      },
      select: { id: true, status: true },
    })

    return successResponse({
      success: true,
      alreadyMarked: false,
      attendanceId: record.id,
      status: record.status,
      studentEnrollmentId: enrollment.id,
      student: enrollment.student,
      rollNumber: enrollment.rollNumber,
    })
  } catch (err) {
    console.error('Student card attendance scan error:', err)
    return errors.internal()
  }
}
