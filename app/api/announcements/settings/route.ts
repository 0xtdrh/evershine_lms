/** GET / PUT /api/announcements/settings — { teachersCanSend, defaultRequireAck } (approval itself = permissions). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { getAnnouncementSettings, saveAnnouncementSettings } from '@/lib/announcements/engine'

const schema = z.object({ teachersCanSend: z.boolean().optional(), defaultRequireAck: z.boolean().optional() })

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'announcements', 'create')) return errors.forbidden()
  return successResponse(await getAnnouncementSettings())
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role) || !checkPermission(session.user.role, 'announcements', 'approve')) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveAnnouncementSettings(parsed.data, session.user.id))
}
