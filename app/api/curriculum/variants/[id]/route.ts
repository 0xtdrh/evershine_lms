/**
 * PATCH  /api/curriculum/variants/[id] { name?, modes?, campusIds? } — a02: rename a level's curriculum or change for
 *        which ways / places it is used.
 * DELETE — only while it has no version (groups that chose it go back to "automatic"). curriculum:update / delete.
 */

import { NextRequest } from 'next/server'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { curriculumViewer, readJson } from '@/lib/curriculum/api'
import { deleteVariant, updateVariant, variantSchema } from '@/lib/curriculum/variants'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  if (!(await prisma.curriculumVariant.findUnique({ where: { id }, select: { id: true } }))) return errors.notFound('Curriculum')
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = variantSchema.partial().safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await updateVariant(id, parsed.data), 'Saved · اتحفظ')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canDelete) return errors.forbidden()
  if (!(await prisma.curriculumVariant.findUnique({ where: { id }, select: { id: true } }))) return errors.notFound('Curriculum')
  const o = await deleteVariant(id)
  return o.ok ? successResponse(null, 'Removed · اتشال') : errorResponse('IN_USE', o.message ?? 'In use', 409)
}
