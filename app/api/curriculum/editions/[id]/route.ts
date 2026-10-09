/**
 * LMS L1: one curriculum version. GET = sessions list; PATCH { action: submit | reject | publish | archive };
 * POST = add a session at the end (draft only); DELETE = delete a draft.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { addSession, changeEditionStatus, deleteDraft, getEdition } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const data = await getEdition(v!, id)
  if (!data) return errors.notFound('Version')
  return successResponse(data)
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ action: z.enum(['submit', 'reject', 'publish', 'archive']) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await changeEditionStatus(v!, id, parsed.data.action!)
  if (!o.ok) return outcomeError(o)
  return successResponse(o.value, 'Saved')
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const o = await addSession(v!, id)
  if (!o.ok) return outcomeError(o)
  return createdResponse(o.value, 'Session added')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const o = await deleteDraft(v!, id)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Draft deleted')
}
