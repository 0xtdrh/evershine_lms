/** R1: session report settings — GET (anyone who reads reports), PUT (session_reports:approve). */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { settingsSchema, type SessionReportSettings } from '@/lib/session-reports/rules'
import { getSessionReportSettings, saveSessionReportSettings } from '@/lib/session-reports/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'session_reports', 'read')) return errors.forbidden()
  return successResponse(await getSessionReportSettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'session_reports', 'approve')) return errors.forbidden()
  const parsed = settingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const ids = parsed.data.phrases.map((p) => p.id)
  if (new Set(ids).size !== ids.length) return errors.badRequest('Two phrases have the same id')
  await saveSessionReportSettings(parsed.data as SessionReportSettings, session.user.id)
  return successResponse(parsed.data)
}
