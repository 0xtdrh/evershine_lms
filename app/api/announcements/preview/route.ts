/** POST /api/announcements/preview { audiences[], scopeType, scopeIds[] } — how many people it would reach (+ why not). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { AUDIENCES, SCOPES } from '@/lib/announcements/rules'
import { previewCount, type AnnouncementInput } from '@/lib/announcements/engine'

const schema = z.object({ audiences: z.array(z.enum(AUDIENCES)), scopeType: z.enum(SCOPES), scopeIds: z.array(z.string()).max(2000).default([]) })

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'announcements', 'create')) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await previewCount({ id: session.user.id, role: session.user.role }, parsed.data as AnnouncementInput))
}
