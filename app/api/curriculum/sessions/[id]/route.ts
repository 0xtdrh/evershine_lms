/**
 * LMS L1: one curriculum session. GET (?as=STUDENT hides instructor-only content), PATCH fields, POST = duplicate it,
 * DELETE (draft only).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { duplicateSession, getSession, removeSession, updateSession } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ id: string }> }

const text = (max: number) => z.string().max(max).nullish()
const patchSchema = z.object({
  titleEn: z.string().max(200).optional(), titleAr: z.string().max(200).optional(),
  objectivesEn: text(20000), objectivesAr: text(20000), materialsEn: text(20000), materialsAr: text(20000),
  instructorNotes: text(50000), durationMin: z.number().int().min(0).max(600).nullish(), skillIds: z.array(z.string()).max(50).optional(),
})

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const as = request.nextUrl.searchParams.get('as') === 'STUDENT' ? 'STUDENT' : 'INSTRUCTOR'
  const data = await getSession(v!, id, as)
  if (!data) return errors.notFound('Session')
  return successResponse({ ...data, can: { edit: v!.canEdit, approve: v!.canApprove } })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await updateSession(v!, id, parsed.data)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Saved')
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const o = await duplicateSession(v!, id)
  if (!o.ok) return outcomeError(o)
  return createdResponse(o.value, 'Session duplicated')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const o = await removeSession(v!, id)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Session removed')
}
