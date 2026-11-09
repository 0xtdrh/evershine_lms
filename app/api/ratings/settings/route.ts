/** GET / PUT /api/ratings/settings — the questions asked after each session and how many per session. Read: ratings:read; change: Super Admin / Admin. */

import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { getFeedbackSettings, saveFeedbackSettings } from '@/lib/ratings/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'ratings', 'read')) return errors.forbidden()
  return successResponse(await getFeedbackSettings())
}

const body = z.object({
  perSession: z.number().int().min(1).max(10).optional(),
  questions: z.array(z.object({ id: z.string().trim().min(1).max(40), en: z.string().trim().max(120), ar: z.string().trim().max(120), about: z.enum(['SESSION', 'INSTRUCTOR']), active: z.boolean() })).min(1).max(30).optional(),
})

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return errors.forbidden()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const next = { ...(await getFeedbackSettings()), ...parsed.data }
  await saveFeedbackSettings(next as Parameters<typeof saveFeedbackSettings>[0], session.user.id)
  return successResponse(await getFeedbackSettings())
}
