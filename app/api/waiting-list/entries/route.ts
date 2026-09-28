/**
 * POST /api/waiting-list/entries
 * Body: { studentId, subjectId, levelId?, campusId?, notes? }
 *
 * Records that a student wants a course (and optionally a level) at a
 * branch. Branch defaults to the student's own branch.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  studentId: z.string().min(1),
  subjectId: z.string().min(1),
  levelId: z.string().min(1).nullable().optional(),
  campusId: z.string().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'waiting_list', 'create')
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { studentId, subjectId, levelId, notes } = parsed.data

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, campusId: true } })
  if (!student) return errors.notFound('Student')

  const targetCampusId = parsed.data.campusId ?? student.campusId
  const scoped = campusScope(role, session.user.campusId, null)
  if (scoped && (student.campusId !== scoped || targetCampusId !== scoped)) return errors.forbidden()

  const course = await prisma.academicSubject.findUnique({ where: { id: subjectId }, select: { id: true } })
  if (!course) return errors.notFound('Course')
  if (levelId) {
    const level = await prisma.level.findUnique({ where: { id: levelId }, select: { subjectId: true } })
    if (!level || level.subjectId !== subjectId) return errors.badRequest('This level does not belong to the chosen course')
  }

  const duplicate = await prisma.waitingListEntry.findFirst({
    where: { studentId, subjectId, levelId: levelId ?? null, status: 'WAITING' },
    select: { id: true },
  })
  if (duplicate) return errors.conflict('This student is already on the waiting list for this course/level')

  const entry = await prisma.waitingListEntry.create({
    data: {
      studentId,
      subjectId,
      levelId: levelId ?? null,
      campusId: targetCampusId,
      notes: notes || null,
      createdById: session.user.id,
    },
  })
  return createdResponse(entry, 'Added to the waiting list')
}
