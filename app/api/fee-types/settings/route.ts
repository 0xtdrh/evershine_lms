/** GET / PUT /api/fee-types/settings { payFirst: FEES | TUITION } — FIN-2: what the wallet pays first. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { successResponse } from '@/lib/api-response'
import { getFeesSettings, saveFeesSettings } from '@/lib/fees-extra/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.object({ payFirst: z.enum(['FEES', 'TUITION']) })

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'fees', 'read')) return errors.forbidden()
  return successResponse(await getFeesSettings())
}

async function PUT_(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveFeesSettings(parsed.data as { payFirst: 'FEES' | 'TUITION' }, session.user.id))
}

// a03: a write into a closed month answers 409 with the reason
export const PUT = withMonthLock(PUT_)
