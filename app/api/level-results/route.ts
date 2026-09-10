import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import { getTeacherByUserId, teacherCanAccessClassSection } from '@/lib/academic/teacher-scope'
import { resolveGradingConfig, computeFinalScore } from '@/lib/grading/compute-score'
import { generateCertificateNumber } from '@/lib/certificates/generate-number'
import type { Role } from '@prisma/client'
import QRCode from 'qrcode'

/**
 * GET /api/level-results?classSectionId=xxx&subjectId=xxx
 * Lists every student enrolled in the given section with their current
 * (possibly partial) component scores for the given course, so a teacher
 * can see the whole roster on one screen.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role

  const classSectionId = request.nextUrl.searchParams.get('classSectionId')
  const subjectId = request.nextUrl.searchParams.get('subjectId')
  if (!classSectionId || !subjectId) {
    return errors.validation({ errors: [{ path: ['classSectionId'], message: 'classSectionId and subjectId are required' }] } as never)
  }

  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    const allowed = await teacherCanAccessClassSection(teacher.id, classSectionId)
    if (!allowed) return errors.forbidden('Not assigned to this class section')
  } else if (!checkPermission(role, 'grading_engine', 'read')) {
    return errors.forbidden()
  }

  const enrollments = await prisma.studentEnrollment.findMany({
    where: { classSectionId, status: 'ACTIVE' },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, fullNameAr: true, profilePicture: true } },
      levelResults: { where: { subjectId } },
    },
    orderBy: { student: { firstName: 'asc' } },
  })

  const config = await resolveGradingConfig(subjectId)

  const rows = enrollments.map((e) => {
    const result = e.levelResults[0] ?? null
    return {
      studentEnrollmentId: e.id,
      student: e.student,
      result: result ? {
        id: result.id,
        homeworkScore: result.homeworkScore,
        taskScore: result.taskScore,
        instructorScore: result.instructorScore,
        projectScore: result.projectScore,
        mcqScore: result.mcqScore,
        finalScore: result.finalScore,
        passed: result.passed,
        instructorFeedback: result.instructorFeedback,
      } : null,
    }
  })

  return successResponse({ rows, config })
}

const scoreSchema = z.object({
  studentEnrollmentId: z.string(),
  subjectId: z.string(),
  homeworkScore: z.number().min(0).max(100).nullable().optional(),
  taskScore: z.number().min(0).max(100).nullable().optional(),
  instructorScore: z.number().min(0).max(100).nullable().optional(),
  projectScore: z.number().min(0).max(100).nullable().optional(),
  mcqScore: z.number().min(0).max(100).nullable().optional(),
  instructorFeedback: z.string().optional(),
})

/**
 * POST /api/level-results — upsert one student's component scores for a
 * course. Recomputes the weighted final score every time; if all five
 * components are present and the score clears the course's pass threshold,
 * automatically issues a (hidden/blurred) certificate — unless one already
 * exists for this result.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = scoreSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  const enrollment = await prisma.studentEnrollment.findUnique({
    where: { id: data.studentEnrollmentId },
    select: { id: true, studentId: true, classSectionId: true },
  })
  if (!enrollment) return errors.notFound('Student enrollment')

  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()
    const allowed = await teacherCanAccessClassSection(teacher.id, enrollment.classSectionId)
    if (!allowed) return errors.forbidden('Not assigned to this class section')
  } else if (!checkPermission(role, 'grading_engine', 'update')) {
    return errors.forbidden()
  }

  const config = await resolveGradingConfig(data.subjectId)

  const existing = await prisma.studentLevelResult.findUnique({
    where: { studentEnrollmentId_subjectId: { studentEnrollmentId: data.studentEnrollmentId, subjectId: data.subjectId } },
  })

  const merged = {
    homeworkScore: data.homeworkScore ?? existing?.homeworkScore ?? null,
    taskScore: data.taskScore ?? existing?.taskScore ?? null,
    instructorScore: data.instructorScore ?? existing?.instructorScore ?? null,
    projectScore: data.projectScore ?? existing?.projectScore ?? null,
    mcqScore: data.mcqScore ?? existing?.mcqScore ?? null,
  }

  const finalScore = computeFinalScore(merged, config)
  const passed = finalScore != null ? finalScore >= config.passThreshold : null

  const result = await prisma.studentLevelResult.upsert({
    where: { studentEnrollmentId_subjectId: { studentEnrollmentId: data.studentEnrollmentId, subjectId: data.subjectId } },
    create: {
      studentEnrollmentId: data.studentEnrollmentId,
      subjectId: data.subjectId,
      ...merged,
      instructorFeedback: data.instructorFeedback ?? null,
      finalScore,
      passed,
      computedAt: finalScore != null ? new Date() : null,
    },
    update: {
      ...merged,
      instructorFeedback: data.instructorFeedback ?? existing?.instructorFeedback ?? null,
      finalScore,
      passed,
      computedAt: finalScore != null ? new Date() : null,
    },
  })

  // ── Auto-issue a certificate on first pass ───────────────────────────────
  let certificateIssued = false
  if (passed && result.instructorFeedback) {
    const alreadyHasCertificate = await prisma.certificate.findUnique({ where: { levelResultId: result.id } })
    if (!alreadyHasCertificate) {
      const subject = await prisma.academicSubject.findUnique({ where: { id: data.subjectId }, select: { name: true } })
      const certificateNumber = await generateCertificateNumber()
      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://evershine-lms-technova.vercel.app'
      const qrCodeUrl = await QRCode.toDataURL(`${base}/verify/${certificateNumber}`, {
        errorCorrectionLevel: 'H', type: 'image/png', width: 300, margin: 2,
      })
      const defaultTemplate = await prisma.certificateTemplate.findFirst({ where: { isDefault: true } })

      await prisma.certificate.create({
        data: {
          studentId: enrollment.studentId,
          type: 'COMPLETION',
          title: `${subject?.name ?? 'Course'} — Level Completion`,
          issuedBy: session.user.id,
          certificateNumber,
          qrCodeUrl,
          subjectId: data.subjectId,
          levelResultId: result.id,
          templateId: defaultTemplate?.id,
          isRevealed: false, // Hidden until the reveal ceremony
        },
      })
      certificateIssued = true
    }
  }

  return successResponse({ result, certificateIssued })
}
