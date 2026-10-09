/** LMS L1: skills list of a course. GET ?subjectId=…, POST { subjectId, nameEn, nameAr } (curriculum:update). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { courseSkills } from '@/lib/curriculum/engine'
import { curriculumViewer, readJson } from '@/lib/curriculum/api'

export async function GET(request: NextRequest) {
  const { err } = await curriculumViewer()
  if (err) return err
  const subjectId = request.nextUrl.searchParams.get('subjectId')
  if (!subjectId) return errors.badRequest('subjectId is required')
  return successResponse(await courseSkills(subjectId))
}

export async function POST(request: NextRequest) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ subjectId: z.string().min(1), nameEn: z.string().trim().min(1).max(80), nameAr: z.string().trim().max(80).default('') }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const course = await prisma.academicSubject.findUnique({ where: { id: parsed.data.subjectId }, select: { id: true } })
  if (!course) return errors.notFound('Course')
  const count = await prisma.courseSkill.count({ where: { subjectId: course.id } })
  const skill = await prisma.courseSkill.create({ data: { subjectId: course.id, nameEn: parsed.data.nameEn!, nameAr: parsed.data.nameAr ?? '', order: count + 1 } })
  return createdResponse(skill, 'Skill added')
}
