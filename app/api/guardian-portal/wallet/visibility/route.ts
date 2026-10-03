/** PATCH /api/guardian-portal/wallet/visibility { studentId, visible } — does the child see the wallet in their portal? (phase B) */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'

export async function PATCH(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ studentId: z.string().min(1), visible: z.boolean() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const mine = (await getChildrenForGuardianUser(session.user.id)).some((c) => c.id === parsed.data.studentId)
  if (!mine) return errors.forbidden()
  await prisma.student.update({ where: { id: parsed.data.studentId! }, data: { walletVisibleToStudent: !!parsed.data.visible } })
  return successResponse({ visible: !!parsed.data.visible }, 'Saved')
}
