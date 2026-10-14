/**
 * M1: permissions for the staff of one place (their primary place), per role or ALL roles. Super Admin only.
 * GET — every setting of the place; PUT { role, items: [{ resource, action, allowed }] } — replaces that role's settings.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { overrideItemsSchema } from '@/lib/partners/validation'
import { PLACE_ROLE_CHOICES, placeOverrides, savePlaceOverrides } from '@/lib/permissions/overrides'

type P = { params: Promise<{ campusId: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden('Only Super Admin manages permissions')
  return successResponse({ roles: PLACE_ROLE_CHOICES, items: await placeOverrides((await params).campusId) })
}

export async function PUT(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden('Only Super Admin manages permissions')
  const parsed = overrideItemsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const problem = await savePlaceOverrides(session.user.id, (await params).campusId, parsed.data.role ?? 'ALL', parsed.data.items as never)
  if (problem) return errors.badRequest(problem)
  return successResponse({ saved: parsed.data.items.length }, 'Saved')
}
