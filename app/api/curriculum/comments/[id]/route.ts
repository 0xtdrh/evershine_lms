/** LMS L1: mark a review comment solved / open again. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { setCommentResolved } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ resolved: z.boolean() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await setCommentResolved(v!, id, parsed.data.resolved!)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Saved')
}
