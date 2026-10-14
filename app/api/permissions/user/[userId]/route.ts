/**
 * M1: one staff member's own permissions (win over their place and their role). Super Admin only.
 * GET — the current settings; PUT { items: [{ resource, action, allowed }] } — replaces them (empty list = none).
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { overrideItemsSchema } from '@/lib/partners/validation'
import { saveUserOverrides, userOverrides } from '@/lib/permissions/overrides'

type P = { params: Promise<{ userId: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden('Only Super Admin manages permissions')
  return successResponse(await userOverrides((await params).userId))
}

export async function PUT(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden('Only Super Admin manages permissions')
  const parsed = overrideItemsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const problem = await saveUserOverrides(session.user.id, (await params).userId, parsed.data.items as never)
  if (problem) return errors.badRequest(problem)
  return successResponse({ saved: parsed.data.items.length }, 'Saved')
}
