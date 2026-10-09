/** LMS L1: versions of one level (GET) and a new version — blank or copied from another (POST { copyFromId?, notes? }). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { courseSkills, createEdition, levelEditions } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ levelId: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { levelId } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const data = await levelEditions(v!, levelId)
  if (!data) return errors.notFound('Level')
  return successResponse({ ...data, skills: await courseSkills(data.level.subject.id), can: { edit: v!.canEdit, approve: v!.canApprove, delete: v!.canDelete } })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { levelId } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ copyFromId: z.string().nullish(), notes: z.string().max(2000).nullish() }).safeParse(body ?? {})
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await createEdition(v!, levelId, parsed.data.copyFromId, parsed.data.notes)
  if (!o.ok) return outcomeError(o)
  return createdResponse(o.value, 'New version created')
}
