/**
 * Phase C: a parent's absence excuses.
 * GET  ?studentId= — sessions that can be excused + the excuses already sent
 * POST { studentId, classSectionId, sessionDate, reason }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { excusableSessions, submitExcuse } from '@/lib/excuses/engine'

export const dynamic = 'force-dynamic'

async function guard(studentId: string | null) {
  const session = await auth()
  if (!session?.user) return { err: errors.unauthorized() }
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return { err: errors.forbidden() }
  if (!studentId || !(await assertGuardianAccessToStudent(session.user.id, studentId))) return { err: errors.forbidden('You can only manage your own children') }
  return { session }
}

export async function GET(request: NextRequest) {
  const studentId = new URL(request.url).searchParams.get('studentId')
  const g = await guard(studentId)
  if (g.err) return g.err
  const [sessions, excuses] = await Promise.all([
    excusableSessions(studentId!),
    prisma.absenceExcuse.findMany({ where: { studentId: studentId! }, orderBy: { sessionDate: 'desc' }, take: 50 }),
  ])
  const groups = await prisma.classSection.findMany({ where: { id: { in: [...new Set(excuses.map((e) => e.classSectionId))] } }, select: { id: true, className: true, sectionName: true } })
  const label = new Map(groups.map((x) => [x.id, `${x.className} ${x.sectionName}`.trim()]))
  return successResponse({
    sessions,
    excuses: excuses.map((e) => ({
      id: e.id, classSectionId: e.classSectionId, group: label.get(e.classSectionId) ?? '—', sessionDate: e.sessionDate.toISOString().slice(0, 10),
      reason: e.reason, status: e.status, decisionNote: e.decisionNote, createdAt: e.createdAt,
    })),
  })
}

const bodySchema = z.object({
  studentId: z.string().min(1),
  classSectionId: z.string().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(500),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const g = await guard(parsed.data.studentId)
  if (g.err) return g.err
  const r = await submitExcuse({ ...(parsed.data as Required<typeof parsed.data>), userId: g.session!.user.id })
  if (!r.ok) return r.code === 404 ? errors.notFound('Enrollment') : r.code === 400 ? errors.badRequest(r.message) : errors.conflict(r.message)
  return createdResponse(r, r.status === 'APPROVED' ? 'Excuse accepted' : 'Excuse sent — waiting for approval')
}
