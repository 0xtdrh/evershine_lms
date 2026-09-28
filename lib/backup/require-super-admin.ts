import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'

/**
 * Backups contain the whole database, so the role is re-checked against the DB
 * (a JWT issued before a demotion or deactivation must not keep access).
 */
export async function requireSuperAdmin() {
  const session = await auth()
  if (!session?.user?.id) return { error: errors.unauthorized(), userId: null }
  if (session.user.role !== 'SUPER_ADMIN') return { error: errors.forbidden(), userId: null }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true },
  })
  if (!user || !user.isActive || user.role !== 'SUPER_ADMIN') return { error: errors.forbidden(), userId: null }

  return { error: null, userId: session.user.id }
}
