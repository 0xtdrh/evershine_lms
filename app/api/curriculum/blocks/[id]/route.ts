/** LMS L1: change (PATCH) or remove (DELETE) one content block of a draft curriculum. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { deleteBlock, updateBlock } from '@/lib/curriculum/engine'
import { AUDIENCES } from '@/lib/curriculum/blocks'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ audience: z.enum(AUDIENCES).optional(), titleEn: z.string().max(200).nullish(), titleAr: z.string().max(200).nullish(), data: z.unknown().optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await updateBlock(v!, id, parsed.data)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Saved')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const o = await deleteBlock(v!, id)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Removed')
}
