import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import type { Role } from '@prisma/client'

const configSchema = z.object({
  subjectId: z.string().nullable().optional(), // null/omitted = the global default row
  homeworkWeight: z.number().min(0).max(100),
  taskWeight: z.number().min(0).max(100),
  instructorWeight: z.number().min(0).max(100),
  projectWeight: z.number().min(0).max(100),
  mcqWeight: z.number().min(0).max(100),
  passThreshold: z.number().min(0).max(100),
}).refine(
  (d) => Math.abs(d.homeworkWeight + d.taskWeight + d.instructorWeight + d.projectWeight + d.mcqWeight - 100) < 0.01,
  { message: 'The five component weights must add up to exactly 100%.', path: ['homeworkWeight'] }
)

/** GET /api/grading-config — list the global default plus every per-course override. */
export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'grading_engine', 'read')) return errors.forbidden()

  const configs = await prisma.courseGradingConfig.findMany({
    include: { subject: { select: { id: true, name: true, code: true } } },
    orderBy: [{ subjectId: 'asc' }],
  })

  // Ensure a global default always exists so the UI has something to show/edit.
  let globalDefault = configs.find((c) => c.subjectId === null)
  if (!globalDefault) {
    globalDefault = await prisma.courseGradingConfig.create({
      data: { subjectId: null },
      include: { subject: { select: { id: true, name: true, code: true } } },
    })
    configs.unshift(globalDefault)
  }

  return successResponse({
    globalDefault,
    overrides: configs.filter((c) => c.subjectId !== null),
  })
}

/**
 * POST /api/grading-config — create or update the weight config for a course,
 * or (when subjectId is omitted/null) the global default template.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'grading_engine', 'update')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }

  const parsed = configSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data
  const subjectId = data.subjectId || null

  if (subjectId) {
    const subject = await prisma.academicSubject.findUnique({ where: { id: subjectId }, select: { id: true } })
    if (!subject) return errors.notFound('Course')
  }

  const existingConfig = await prisma.courseGradingConfig.findFirst({ where: { subjectId } })
  const payload = {
    homeworkWeight: data.homeworkWeight,
    taskWeight: data.taskWeight,
    instructorWeight: data.instructorWeight,
    projectWeight: data.projectWeight,
    mcqWeight: data.mcqWeight,
    passThreshold: data.passThreshold,
  }
  const config = existingConfig
    ? await prisma.courseGradingConfig.update({ where: { id: existingConfig.id }, data: payload })
    : await prisma.courseGradingConfig.create({ data: { subjectId, ...payload } })

  return successResponse(config, { message: 'Grading configuration saved' })
}

/** DELETE /api/grading-config?subjectId=xxx — remove a per-course override (falls back to global default). */
export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'grading_engine', 'delete')) return errors.forbidden()

  const subjectId = request.nextUrl.searchParams.get('subjectId')
  if (!subjectId) return errors.validation({ errors: [{ path: ['subjectId'], message: 'subjectId is required' }] } as never)

  const existing = await prisma.courseGradingConfig.findFirst({ where: { subjectId } })
  if (!existing) return errors.notFound('Override')

  await prisma.courseGradingConfig.delete({ where: { id: existing.id } })
  return successResponse({ deleted: true })
}
