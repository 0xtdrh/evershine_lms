/**
 * POST /api/delivery/copy — a02 (2026-10-31) "Copy for a partner": a copy of a level (own sessions / months / price) or
 * of a whole course, with its curriculum, offered only in the chosen places; optionally the original is closed there.
 * Needs class_sections:create (+ subject_offerings:create for a course) and the chosen places.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors } from '@/lib/api-response'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { copyForPlaces } from '@/lib/delivery/copy'

const schema = z.object({
  kind: z.enum(['LEVEL', 'COURSE']),
  id: z.string().min(1),
  campusIds: z.array(z.string().min(1)).min(1).max(50),
  name: z.string().trim().max(120).nullish(),
  numberOfSessions: z.number().int().min(1).max(500).nullish(),
  numberOfMonths: z.number().int().min(1).max(60).nullish(),
  price: z.number().min(0).max(1_000_000).nullish(),
  closeOriginalThere: z.boolean().default(true),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const role = session.user.role
  if (!checkPermission(role, 'class_sections', 'create') || (d.kind === 'COURSE' && !checkPermission(role, 'subject_offerings', 'create'))) return errors.forbidden()
  const places = await loadPlaces(session.user)
  if (d.campusIds!.some((c) => !allowsCampus(places, c))) return errors.forbidden('One of these places is not yours · مكان من دول مش بتاعك')
  const out = await copyForPlaces({
    kind: d.kind!, id: d.id!, campusIds: d.campusIds!, name: d.name, numberOfSessions: d.numberOfSessions, numberOfMonths: d.numberOfMonths,
    price: d.price, closeOriginalThere: d.closeOriginalThere ?? true, userId: session.user.id,
  })
  if (!out.ok) return errors.badRequest((out as { message: string }).message)
  return createdResponse(out, 'Copy made · النسخة اتعملت')
}
