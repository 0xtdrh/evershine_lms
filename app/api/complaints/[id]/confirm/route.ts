/** POST /api/complaints/[id]/confirm { satisfied, rating? } — phase D: the sender says if it is really solved. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { confirmResolution } from '@/lib/complaints/engine'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ satisfied: z.boolean(), rating: z.number().int().min(1).max(5).optional().nullable() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await confirmResolution({ id, senderUserId: session.user.id, satisfied: parsed.data.satisfied!, rating: parsed.data.rating })
  if (!r.ok) return r.code === 409 ? errors.conflict(r.message!) : errors.notFound('Complaint')
  return successResponse(r, parsed.data.satisfied ? 'Thank you!' : 'Sorry — we will follow up again')
}
