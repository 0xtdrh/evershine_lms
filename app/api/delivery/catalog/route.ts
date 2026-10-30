/**
 * GET /api/delivery/catalog?kind=TRACK|COURSE|LEVEL&id= — a02 M1: the ways a track / course / level may be attended
 *     (own setting, what it inherits, what applies) and where it is offered.
 * PUT /api/delivery/catalog { kind, id, allowedModes: string[] | null, offeredIn: string[] } — save both.
 * Same permissions as the course structure page: tracks + levels = class_sections, courses = subject_offerings.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { getCatalogDelivery, saveCatalogDelivery } from '@/lib/delivery/catalog'
import { CATALOG_KINDS, MODES, type CatalogKind } from '@/lib/delivery/modes'

const resourceOf = (kind: CatalogKind) => (kind === 'COURSE' ? 'subject_offerings' : 'class_sections') as 'subject_offerings' | 'class_sections'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const sp = request.nextUrl.searchParams
  const kind = sp.get('kind') as CatalogKind
  const id = sp.get('id') ?? ''
  if (!CATALOG_KINDS.includes(kind) || !id) return errors.badRequest('kind and id are required')
  if (!checkPermission(session.user.role, resourceOf(kind), 'read')) return errors.forbidden()
  const out = await getCatalogDelivery(kind, id)
  return out ? successResponse(out) : errors.notFound(kind.toLowerCase())
}

const schema = z.object({
  kind: z.enum(CATALOG_KINDS),
  id: z.string().min(1),
  allowedModes: z.array(z.enum(MODES)).nullable(),
  offeredIn: z.array(z.string().min(1)).max(200),
})

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { kind, id, allowedModes, offeredIn } = parsed.data
  if (!checkPermission(session.user.role, resourceOf(kind), 'update')) return errors.forbidden()
  if (!(await getCatalogDelivery(kind, id))) return errors.notFound(kind.toLowerCase())
  return successResponse(await saveCatalogDelivery(kind, id, { allowedModes, offeredIn }), 'Saved · اتحفظ')
}
