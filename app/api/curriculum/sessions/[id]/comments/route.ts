/** LMS L1: review comment on a curriculum session (authors and approvers). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors } from '@/lib/api-response'
import { addComment } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await addComment(v!, id, parsed.data.body!)
  if (!o.ok) return outcomeError(o)
  return createdResponse(null, 'Comment added')
}
