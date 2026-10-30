/**
 * GET /api/places/[campusId]/catalog — a02 M1 (2026-10-30): the programmes (tracks → courses → levels, + standalone
 *     courses) as seen from one branch / partner place: offered here or not, and whether that is set for this place or
 *     comes from "everywhere".
 * PUT { kind, id, on } — offer one item here or not (the same "where offered" data as Course Structure; other places kept).
 * Read: class_sections:read + the place. Change: tracks / levels class_sections:update, courses subject_offerings:update.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { placeCatalog, setOfferedHere } from '@/lib/delivery/catalog'
import { CATALOG_KINDS } from '@/lib/delivery/modes'

type Ctx = { params: Promise<{ campusId: string }> }

async function guard(campusId: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { error: error! }
  if (!checkPermission(session.user.role, 'class_sections', 'read')) return { error: errors.forbidden() }
  if (!allowsCampus(await loadPlaces(session.user), campusId)) return { error: errors.forbidden('This place is not yours · المكان ده مش بتاعك') }
  return { session }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { campusId } = await params
  const g = await guard(campusId)
  if ('error' in g) return g.error
  return successResponse(await placeCatalog(campusId))
}

const schema = z.object({ kind: z.enum(CATALOG_KINDS), id: z.string().min(1), on: z.boolean() })

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { campusId } = await params
  const g = await guard(campusId)
  if ('error' in g) return g.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { kind, id, on } = parsed.data
  if (!checkPermission(g.session.user.role, kind === 'COURSE' ? 'subject_offerings' : 'class_sections', 'update')) return errors.forbidden()
  await setOfferedHere(kind, id, campusId, on)
  return successResponse(await placeCatalog(campusId), 'Saved · اتحفظ')
}
