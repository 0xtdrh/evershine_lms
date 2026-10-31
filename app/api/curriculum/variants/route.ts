/**
 * POST /api/curriculum/variants { levelId, name, modes?, campusIds? } — a02 (2026-10-31): another curriculum for a level
 * (same sessions / price, different content) for some ways (branch / online / recorded) and / or places (a partner…).
 * curriculum:update.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors } from '@/lib/api-response'
import { curriculumViewer, readJson } from '@/lib/curriculum/api'
import { createVariant, variantSchema } from '@/lib/curriculum/variants'

export async function POST(request: NextRequest) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const parsed = variantSchema.extend({ levelId: z.string().min(1) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const row = await createVariant(parsed.data.levelId!, { name: parsed.data.name!, modes: parsed.data.modes, campusIds: parsed.data.campusIds })
  return row ? createdResponse(row, 'Curriculum added · المنهج اتضاف') : errors.notFound('Level')
}
