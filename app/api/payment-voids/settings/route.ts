/** GET / PUT /api/payment-voids/settings — cancelling payments on / off and how many days after recording (default 7). Read: payment_voids:read; change: payment_voids:approve. */

import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { getVoidSettings, saveVoidSettings } from '@/lib/payments/void'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'payment_voids', 'read')) return errors.forbidden()
  return successResponse(await getVoidSettings())
}

const body = z.object({ enabled: z.boolean().optional(), maxDays: z.number().int().min(1).max(60).optional() })

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'payment_voids', 'approve')) return errors.forbidden()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveVoidSettings(parsed.data, session.user.id))
}
