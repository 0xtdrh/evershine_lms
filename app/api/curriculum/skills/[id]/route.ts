/** LMS L1: rename (PATCH) or remove (DELETE) a course skill. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { curriculumViewer, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ nameEn: z.string().trim().min(1).max(80).optional(), nameAr: z.string().trim().max(80).optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const found = await prisma.courseSkill.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Skill')
  await prisma.courseSkill.update({ where: { id }, data: parsed.data })
  return successResponse(null, 'Saved')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canDelete) return errors.forbidden()
  const found = await prisma.courseSkill.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Skill')
  await prisma.courseSkill.delete({ where: { id } })
  return successResponse(null, 'Removed')
}
