/** LMS L1: add a content block to a session (POST) or save a new order of its blocks (PUT { ids }). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { addBlock, reorderBlocks } from '@/lib/curriculum/engine'
import { AUDIENCES, BLOCK_TYPES } from '@/lib/curriculum/blocks'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({
    type: z.enum(BLOCK_TYPES), audience: z.enum(AUDIENCES).default('BOTH'),
    titleEn: z.string().max(200).nullish(), titleAr: z.string().max(200).nullish(), data: z.unknown(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await addBlock(v!, id, parsed.data)
  if (!o.ok) return outcomeError(o)
  return createdResponse(o.value, 'Content added')
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = z.object({ ids: z.array(z.string()).max(200) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await reorderBlocks(v!, id, parsed.data.ids!)
  if (!o.ok) return outcomeError(o)
  return successResponse(null, 'Saved')
}
