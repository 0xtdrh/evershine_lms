/** Six phases 1-A: the signed-in family account (parent portal APIs). */

import { auth } from '@/lib/auth'
import { errors } from '@/lib/api-response'
import { guardianOfUser } from './engine'

export async function familySession() {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() } as const
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return { error: errors.forbidden() } as const
  const guardian = await guardianOfUser(session.user.id)
  if (!guardian) return { error: errors.forbidden('No family account · مفيش حساب عيلة') } as const
  return { error: null, session, guardian } as const
}
